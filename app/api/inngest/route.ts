import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { sendInvoiceReminders } from '@/lib/inngest/functions/invoice-reminders'
import { digestSchedule, digestSend } from '@/lib/inngest/functions/send-digest'

/**
 * Inngest API endpoint
 *
 * This endpoint is called by Inngest to:
 * 1. Register functions (on deploy/sync)
 * 2. Execute functions (when events are sent)
 *
 * URL: https://your-domain.vercel.app/api/inngest
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    sendInvoiceReminders,  // Send invoice reminders 5 days before billing
    digestSchedule,        // Daily fan-out: fires one digest/send event per user
    digestSend,            // Per-user: sends digest email, retries independently
  ],
  servePath: '/api/inngest',
})
