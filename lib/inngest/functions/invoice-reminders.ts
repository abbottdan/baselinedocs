import { inngest } from '../client'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { stripe } from '@/lib/stripe/client'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM_BILLING_EMAIL = process.env.FROM_BILLING_EMAIL || 'billing@baselinedocs.com'
const OWNER_EMAIL = process.env.FEEDBACK_EMAIL || 'abbott.dan@gmail.com'

const PLAN_NAMES: Record<string, string> = {
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
}

/**
 * Inngest cron function: Send invoice reminders 5 days before billing
 * 
 * Runs daily at 9am UTC
 * Checks all active subscriptions and sends reminders for upcoming charges
 */
export const sendInvoiceReminders = inngest.createFunction(
  {
    id: 'send-invoice-reminders',
    name: 'Send Invoice Reminders (5 Days Before Billing)',
    retries: 2,
  },
  { cron: '0 9 * * *' }, // Daily at 9am UTC
  async ({ step }: { step: any }) => {
    console.log('[Inngest] Starting invoice reminder check')

    // Step 1: Get all active subscriptions
    const activeSubscriptions = await step.run('get-active-subscriptions', async () => {
      const supabase = createServiceRoleClient()
      
      const { data: tenants, error } = await createPlatformClient()
          .schema('platform').from('product_subscriptions')
        .select(`
          tenant_id,
          stripe_customer_id,
          stripe_subscription_id,
          plan,
          tenants!inner(
            company_name,
            subdomain,
            created_at
          ),
          users!inner(
            email,
            role
          )
        `)
        .eq('status', 'active')
        .not('stripe_subscription_id', 'is', null)

      if (error) {
        console.error('[Inngest] Error fetching subscriptions:', error)
        return []
      }

      console.log(`[Inngest] Found ${tenants?.length || 0} active subscriptions`)
      return tenants || []
    })

    if (activeSubscriptions.length === 0) {
      console.log('[Inngest] No active subscriptions to check')
      return { sent: 0, skipped: 0 }
    }

    // Step 2: Process each subscription
    let sent = 0
    let skipped = 0

    for (const tenant of activeSubscriptions) {
      const result = await step.run(`check-subscription-${tenant.tenant_id}`, async () => {
        try {
          // Get subscription details from Stripe
          const subscription = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id) as any
          
          const currentPeriodEnd = new Date(subscription.current_period_end * 1000)
          const now = new Date()
          const daysUntilBilling = Math.floor((currentPeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

          console.log(`[Inngest] Subscription ${subscription.id}: ${daysUntilBilling} days until billing`)

          // Skip if not exactly 5 days away
          if (daysUntilBilling !== 5) {
            return { action: 'skipped', reason: 'not-5-days' }
          }

          // Skip if subscription is new (created within last 7 days) - this is their first charge
          const subscriptionAge = Math.floor((now.getTime() - (subscription.created * 1000)) / (1000 * 60 * 60 * 24))
          if (subscriptionAge < 7) {
            console.log(`[Inngest] Skipping new subscription (${subscriptionAge} days old)`)
            return { action: 'skipped', reason: 'first-billing' }
          }

          // Get upcoming invoice from Stripe
          const upcomingInvoice = await (stripe.invoices as any).upcoming({
            customer: tenant.stripe_customer_id,
            subscription: subscription.id,
          })

          // Create pending invoice record in database
          const supabase = createServiceRoleClient()
          await supabase.from('invoices').upsert({
            tenant_id: tenant.tenant_id,
            stripe_invoice_id: upcomingInvoice.id,
            stripe_subscription_id: subscription.id,
            amount_due: (upcomingInvoice.amount_due || 0) / 100,
            amount_paid: 0,
            currency: upcomingInvoice.currency,
            status: 'pending',
            invoice_date: new Date(upcomingInvoice.created * 1000).toISOString(),
            paid_at: null,
            hosted_invoice_url: upcomingInvoice.hosted_invoice_url || null,
            invoice_pdf_url: upcomingInvoice.invoice_pdf || null,
          }, {
            onConflict: 'stripe_invoice_id',
            ignoreDuplicates: false
          })

          // Get admin email
          // Fetch tenant admin email from shared.users
    const { createSharedClient } = await import('@/lib/supabase/server')
    const { data: adminUsers } = await createSharedClient()
      .schema('shared')
      .from('users')
      .select('email')
      .eq('tenant_id', tenant.id)
      .eq('is_master_admin', false)
      .eq('is_active', true)
      .limit(1)
    const adminEmail = adminUsers?.[0]?.email
          if (!adminEmail) {
            console.log(`[Inngest] No admin email found for tenant ${tenant.tenant_id}`)
            return { action: 'skipped', reason: 'no-email' }
          }

          // Send reminder email
          await sendReminderEmail({
            toEmail: adminEmail,
            companyName: (tenant as any).tenants?.company_name || (tenant as any).tenants?.subdomain || 'your company',
            plan: tenant.plan,
            amount: (upcomingInvoice.amount_due || 0) / 100,
            billingDate: currentPeriodEnd.toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            }),
            invoiceUrl: upcomingInvoice.hosted_invoice_url,
          })

          console.log(`[Inngest] Sent reminder to ${adminEmail} for ${tenant.plan} plan`)
          return { action: 'sent', email: adminEmail }

        } catch (error) {
          console.error(`[Inngest] Error processing tenant ${tenant.tenant_id}:`, error)
          return { action: 'error', error: String(error) }
        }
      })

      if (result.action === 'sent') sent++
      else skipped++
    }

    console.log(`[Inngest] Invoice reminders complete: ${sent} sent, ${skipped} skipped`)
    return { sent, skipped }
  }
)

async function sendReminderEmail(params: {
  toEmail: string
  companyName: string
  plan: string
  amount: number
  billingDate: string
  invoiceUrl: string | null
}) {
  const planName = PLAN_NAMES[params.plan] || params.plan

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 0;">
      <div style="max-width: 560px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        
        <!-- Header -->
        <div style="background: #1e40af; padding: 32px 40px;">
          <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">BaselineDocs</h1>
          <p style="color: #bfdbfe; margin: 8px 0 0; font-size: 14px;">Document Control System</p>
        </div>

        <!-- Body -->
        <div style="padding: 40px;">
          <h2 style="color: #111827; margin: 0 0 8px; font-size: 20px;">📅 Upcoming payment reminder</h2>
          <p style="color: #6b7280; margin: 0 0 24px; font-size: 15px;">
            Hi <strong>${params.companyName}</strong>, this is a friendly reminder that your BaselineDocs subscription will renew soon.
          </p>

          <!-- Payment Details -->
          <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <table style="width: 100%;">
              <tr>
                <td style="padding: 8px 0;">
                  <p style="margin: 0; font-size: 13px; color: #6b7280;">Plan</p>
                  <p style="margin: 4px 0 0; font-size: 16px; color: #111827; font-weight: 600;">${planName}</p>
                </td>
                <td style="padding: 8px 0; text-align: right;">
                  <p style="margin: 0; font-size: 13px; color: #6b7280;">Amount</p>
                  <p style="margin: 4px 0 0; font-size: 18px; color: #0369a1; font-weight: 700;">$${params.amount.toFixed(2)}</p>
                </td>
              </tr>
            </table>
            <hr style="border: none; border-top: 1px solid #e0f2fe; margin: 16px 0;">
            <p style="margin: 0; font-size: 14px; color: #374151;">
              <strong>Billing date:</strong> ${params.billingDate}
            </p>
          </div>

          <p style="color: #6b7280; font-size: 14px; margin: 0 0 16px;">
            Your payment method will be charged automatically on this date. No action is needed from you.
          </p>

          ${params.invoiceUrl ? `
          <div style="text-align: center; margin: 24px 0;">
            <a href="${params.invoiceUrl}" 
               style="display: inline-block; background: #1e40af; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px;">
              View Invoice
            </a>
          </div>
          ` : ''}

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

          <p style="color: #6b7280; font-size: 13px; margin: 0;">
            Questions about your billing? Visit your 
            <a href="https://app.baselinedocs.com/admin/billing" style="color: #1e40af;">billing dashboard</a> 
            or reply to this email.
          </p>
        </div>

        <!-- Footer -->
        <div style="background: #f9fafb; padding: 24px 40px; border-top: 1px solid #e5e7eb;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">
            BaselineDocs · Document Control System<br>
            This is a billing reminder for your account.
          </p>
        </div>
      </div>
    </body>
    </html>
  `

  try {
    await resend.emails.send({
      from: FROM_BILLING_EMAIL,
      to: params.toEmail,
      bcc: OWNER_EMAIL,
      subject: `Upcoming charge: $${params.amount.toFixed(2)} on ${params.billingDate}`,
      html,
    })
  } catch (error) {
    console.error('[Inngest] Failed to send reminder email:', error)
    throw error
  }
}
