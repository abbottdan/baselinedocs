/**
 * Inngest Functions: Daily Digest Emails
 *
 * Architecture:
 *  1. digest-schedule  — daily cron at midnight UTC. Queries all digest-mode users
 *     and fires one `digest/send` event per user. Lightweight fan-out.
 *
 *  2. digest-send      — triggered by the `digest/send` event. Checks whether
 *     it's within the user's preferred send window, fetches pending emails,
 *     and sends the digest. Retries independently per user.
 *
 * Stored digest_time values are UTC hour strings: "15:00:00", "17:00:00", etc.
 * The fan-out fires at midnight; each user's function checks whether the
 * current UTC hour matches their preference before sending.
 */

import { inngest } from '../client'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { generateDigestHTML, generateDigestSubject } from '@/lib/email-digest'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM_EMAIL = process.env.EMAIL_FROM || 'notifications@baselinedocs.com'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DigestSendEvent {
  data: {
    userId: string
    email: string
    fullName: string | null
    digestTimeUtc: string // "HH:00:00"
  }
}

// ── 1. Daily fan-out cron ─────────────────────────────────────────────────────

export const digestSchedule = inngest.createFunction(
  {
    id: 'digest-schedule',
    name: 'Daily Digest: Fan-Out Scheduler',
    retries: 1,
  },
  { cron: '0 * * * *' }, // Top of every hour — each user function decides if it's their time
  async ({ step, logger }) => {
    const now = new Date()
    const currentHour = now.getUTCHours()
    const currentTimeStr = `${String(currentHour).padStart(2, '0')}:00:00`

    logger.info(`Digest fan-out: checking UTC ${currentTimeStr}`)

    // Find digest-mode users whose preferred send time matches this hour
    const users = await step.run('fetch-users-for-this-hour', async () => {
      const supabase = createServiceRoleClient()

      const { data, error } = await supabase
        .from('user_notification_preferences')
        .select(`
          user_id,
          digest_time,
          users!inner (
            id,
            email,
            full_name
          )
        `)
        .eq('delivery_mode', 'digest')
        .eq('digest_time', currentTimeStr)

      if (error) {
        logger.error('Failed to fetch digest users', { error: error.message })
        return []
      }

      return (data ?? []).map(row => {
        const user = Array.isArray(row.users) ? row.users[0] : row.users
        return {
          userId: row.user_id,
          email: user?.email ?? '',
          fullName: user?.full_name ?? null,
          digestTimeUtc: row.digest_time,
        }
      }).filter(u => u.email)
    })

    if (users.length === 0) {
      logger.info(`No digest users for UTC ${currentTimeStr}`)
      return { firedEvents: 0, hour: currentTimeStr }
    }

    logger.info(`Firing ${users.length} digest events for UTC ${currentTimeStr}`)

    // Fan out — one event per user, processed independently
    await step.sendEvent(
      'fan-out-digest-events',
      users.map(u => ({
        name: 'digest/send' as const,
        data: u,
      }))
    )

    return { firedEvents: users.length, hour: currentTimeStr }
  }
)

// ── 2. Per-user digest sender ─────────────────────────────────────────────────

export const digestSend = inngest.createFunction(
  {
    id: 'digest-send',
    name: 'Daily Digest: Send to User',
    retries: 3,
  },
  { event: 'digest/send' },
  async ({ event, step, logger }: { event: DigestSendEvent; step: any; logger: any }) => {
    const { userId, email, fullName, digestTimeUtc } = event.data

    logger.info('Processing digest', { userId, email, digestTimeUtc })

    // Fetch pending email_queue entries for this user
    const pendingEmails = await step.run('fetch-pending-emails', async () => {
      const supabase = createServiceRoleClient()

      const { data, error } = await supabase
        .from('email_queue')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })

      if (error) {
        logger.error('Failed to fetch email queue', { userId, error: error.message })
        throw new Error(`Queue fetch failed: ${error.message}`)
      }

      return data ?? []
    })

    if (pendingEmails.length === 0) {
      logger.info('No pending emails — skipping digest', { userId })
      return { sent: false, reason: 'no-pending-emails' }
    }

    logger.info(`Sending digest with ${pendingEmails.length} notifications`, { userId, email })

    // Send the digest email
    await step.run('send-digest-email', async () => {
      const digestDate = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })

      const userName = fullName || email.split('@')[0]
      const subject = generateDigestSubject(pendingEmails.length, digestDate)
      const html = generateDigestHTML(userName, pendingEmails, digestDate)

      const result = await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject,
        html,
      })

      if (!result.data?.id) {
        throw new Error('Resend returned no email ID')
      }

      logger.info('Digest email sent', { userId, email, resendId: result.data.id })
      return result.data.id
    })

    // Mark queue entries as sent
    await step.run('mark-emails-sent', async () => {
      const supabase = createServiceRoleClient()
      const ids = pendingEmails.map((e: any) => e.id)

      const { error } = await supabase
        .from('email_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .in('id', ids)

      if (error) {
        // Non-fatal: email was sent, just log the update failure
        logger.warn('Failed to mark emails as sent', { userId, error: error.message })
      }
    })

    return { sent: true, notificationCount: pendingEmails.length }
  }
)
