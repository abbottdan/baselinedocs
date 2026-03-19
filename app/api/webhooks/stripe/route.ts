/**
 * Stripe Webhook Handler - FIXED for Stripe v20
 * File: app/api/webhooks/stripe/route.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { createPlatformClient } from '@/lib/supabase/platform'
import { createSharedClient } from '@/lib/supabase/server'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM_BILLING_EMAIL = process.env.FROM_BILLING_EMAIL || 'billing@baselinedocs.com'
const OWNER_EMAIL = process.env.FEEDBACK_EMAIL || 'abbott.dan@gmail.com'

const PLAN_NAMES: Record<string, string> = {
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
  trial: 'Trial',
}

const PLAN_PRICES: Record<string, number> = {
  starter: 29,
  professional: 99,
  enterprise: 299,
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-01-28.clover',
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  console.log('🟣 [Webhook] === WEBHOOK FUNCTION CALLED ===')
  console.log('🟣 [Webhook] Timestamp:', new Date().toISOString())

  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  console.log('🔵 [Webhook] Request details:', {
    hasBody: !!body,
    bodyLength: body.length,
    hasSignature: !!signature,
    hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
    secretPrefix: process.env.STRIPE_WEBHOOK_SECRET?.substring(0, 10)
  })

  if (!signature) {
    console.error('🔴 [Webhook] No signature in request')
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    console.log('🔵 [Webhook] Attempting to construct event...')
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
    console.log('🟢 [Webhook] Event constructed successfully')
  } catch (err: any) {
    console.error('🔴 [Webhook] Invalid signature:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  console.log(`🔵 [Webhook] Received event: ${event.type}`, {
    eventId: event.id,
    created: new Date(event.created * 1000).toISOString()
  })

  await logEvent(event)

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        console.log('🟢 [Webhook] Processing checkout.session.completed')
        await handleCheckoutSessionCompleted(event.data.object)
        break
      case 'customer.subscription.created':
        console.log('🟢 [Webhook] Processing subscription.created')
        await handleSubscription(event.data.object as Stripe.Subscription)
        break
      case 'customer.subscription.updated':
        console.log('🟢 [Webhook] Processing subscription.updated')
        await handleSubscription(event.data.object as Stripe.Subscription)
        break
      case 'customer.subscription.deleted':
        console.log('🟢 [Webhook] Processing subscription.deleted')
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break
      case 'invoice.paid':
        console.log('🟢 [Webhook] Processing invoice.paid')
        await handleInvoicePaid(event.data.object as Stripe.Invoice)
        break
      case 'invoice.payment_failed':
        console.log('🟢 [Webhook] Processing invoice.payment_failed')
        await handlePaymentFailed(event.data.object as Stripe.Invoice)
        break
      case 'payment_method.attached':
        console.log('🟢 [Webhook] Processing payment_method.attached')
        await handlePaymentMethod(event.data.object as Stripe.PaymentMethod)
        break
      default:
        console.log('⚠️ [Webhook] Unhandled event type:', event.type)
    }

    await markProcessed(event.id)
    console.log('✅ [Webhook] Event processed successfully:', event.type)
    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('🔴 [Webhook] Processing error:', {
      eventType: event.type,
      eventId: event.id,
      error: error.message,
      stack: error.stack
    })
    await logError(event.id, error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

async function logEvent(event: Stripe.Event) {
  await supabase.from('stripe_events').insert({
    stripe_event_id: event.id,
    event_type: event.type,
    data: event.data.object,
    processed: false,
  })
}

async function markProcessed(eventId: string) {
  await supabase.from('stripe_events').update({ processed: true }).eq('stripe_event_id', eventId)
}

async function logError(eventId: string, error: string) {
  await supabase.from('stripe_events').update({ error }).eq('stripe_event_id', eventId)
}


function buildPaymentConfirmationEmail(params: {
  companyName: string
  plan: string
  amount: number
  invoiceNumber: string
  paidDate: string
  invoiceUrl: string | null
  receiptUrl: string | null
}) {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 0;">
      <div style="max-width: 560px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="background: #1e40af; padding: 32px 40px;">
          <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">BaselineDocs</h1>
          <p style="color: #bfdbfe; margin: 8px 0 0; font-size: 14px;">Document Control System</p>
        </div>
        <div style="padding: 40px;">
          <div style="background: #dcfce7; border: 2px solid #86efac; border-radius: 8px; padding: 16px; margin-bottom: 24px; text-align: center;">
            <h2 style="color: #166534; margin: 0; font-size: 18px;">✓ Payment Received</h2>
          </div>
          <p style="color: #6b7280; margin: 0 0 24px; font-size: 15px;">
            Hi <strong>${params.companyName}</strong>, your payment has been processed successfully.
          </p>
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <table style="width: 100%;">
              <tr>
                <td style="padding: 8px 0;">
                  <p style="margin: 0; font-size: 13px; color: #6b7280;">Plan</p>
                  <p style="margin: 4px 0 0; font-size: 16px; color: #111827; font-weight: 600;">${params.plan}</p>
                </td>
                <td style="padding: 8px 0; text-align: right;">
                  <p style="margin: 0; font-size: 13px; color: #6b7280;">Amount Paid</p>
                  <p style="margin: 4px 0 0; font-size: 18px; color: #059669; font-weight: 700;">$${params.amount.toFixed(2)}</p>
                </td>
              </tr>
            </table>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;">
            <p style="margin: 0; font-size: 14px; color: #374151;">
              <strong>Invoice:</strong> ${params.invoiceNumber}<br>
              <strong>Paid on:</strong> ${params.paidDate}
            </p>
          </div>
          ${params.invoiceUrl || params.receiptUrl ? `
          <div style="text-align: center; margin: 24px 0;">
            ${params.invoiceUrl ? `<a href="${params.invoiceUrl}" style="display: inline-block; background: #1e40af; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; margin: 0 8px;">View Invoice</a>` : ''}
            ${params.receiptUrl ? `<a href="${params.receiptUrl}" style="display: inline-block; background: #6b7280; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px; margin: 0 8px;">Download Receipt</a>` : ''}
          </div>
          ` : ''}
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
          <p style="color: #6b7280; font-size: 13px; margin: 0;">
            Questions about your billing? Visit your 
            <a href="https://app.baselinedocs.com/admin/billing" style="color: #1e40af;">billing dashboard</a> 
            or reply to this email.
          </p>
        </div>
        <div style="background: #f9fafb; padding: 24px 40px; border-top: 1px solid #e5e7eb;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">
            BaselineDocs · Document Control System<br>
            This is a payment confirmation for your subscription.
          </p>
        </div>
      </div>
    </body>
    </html>
  `
}

async function getTenantId(customerId: string) {
  const { data } = await createPlatformClient().schema('platform').from('product_subscriptions').select('tenant_id').eq('stripe_customer_id', customerId).eq('product', 'baselinedocs').single()
  if (!data) { console.error('🔴 [Webhook] No tenant found for customer:', customerId); throw new Error(`No tenant for customer ${customerId}`) }
  return data.tenant_id
}

async function handleCheckoutSessionCompleted(session: any) {
  console.log('🔵 [Webhook] handleCheckoutSessionCompleted called', {
    sessionId: session.id,
    customerId: session.customer,
    subscriptionId: session.subscription,
    paymentStatus: session.payment_status
  })

  if (!session.subscription) {
    console.log('⚠️ [Webhook] No subscription in session (one-time payment), skipping')
    return
  }

  // Retrieve the full subscription
  const sub: any = await stripe.subscriptions.retrieve(session.subscription, {
    expand: ['default_payment_method']
  })

  console.log('🟢 [Webhook] Subscription retrieved from checkout:', {
    subscriptionId: sub.id,
    status: sub.status,
    customerId: sub.customer
  })

  // Process using the same subscription handler
  await handleSubscription(sub)
}

async function handleSubscription(sub: Stripe.Subscription) {
  console.log('🔵 [Webhook] handleSubscription called', {
    subscriptionId: sub.id,
    customerId: sub.customer,
    status: sub.status
  })

  const tenantId = await getTenantId(sub.customer as string)
  console.log('🟢 [Webhook] Tenant ID resolved:', tenantId)

  let pm = null
  if (sub.default_payment_method) {
    // default_payment_method may already be expanded (object) or just an ID (string)
    if (typeof sub.default_payment_method === 'string') {
      pm = await stripe.paymentMethods.retrieve(sub.default_payment_method)
    } else {
      pm = sub.default_payment_method as Stripe.PaymentMethod
    }
    console.log('🟢 [Webhook] Payment method retrieved:', {
      type: pm.type,
      brand: pm.card?.brand,
      last4: pm.card?.last4
    })
  }

  const priceId = sub.items.data[0]?.price?.id
  let plan = 'trial'
  if (priceId === process.env.STRIPE_PRICE_STARTER) plan = 'starter'
  else if (priceId === process.env.STRIPE_PRICE_PROFESSIONAL) plan = 'professional'
  else if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) plan = 'enterprise'

  console.log('🟢 [Webhook] Plan determined:', { priceId, plan })

  // Stripe v20 changed: use billing_cycle_anchor as fallback for current_period_start
  const subAny = sub as any
  const currentPeriodStart = subAny.billing_cycle_anchor || Math.floor(Date.now() / 1000)
  // Estimate end (30 days for monthly, will be corrected by invoice events)
  const currentPeriodEnd = subAny.cancel_at || (currentPeriodStart + 2592000)

  const billingUpdate = {
    tenant_id: tenantId,
    stripe_customer_id: sub.customer as string,
    stripe_subscription_id: sub.id,
    plan,
    user_limit: plan === 'starter' ? 25 : 
                plan === 'professional' ? 100 : 
                plan === 'enterprise' ? 999999 : 5,
    document_limit: plan === 'starter' ? 3000 : 
                    plan === 'professional' ? 25000 : 
                    plan === 'enterprise' ? 999999 : 150,
    storage_limit_gb: plan === 'starter' ? 10 : 
                      plan === 'professional' ? 100 : 
                      plan === 'enterprise' ? 1000 : 1,


    status: sub.status,
    billing_cycle: sub.items.data[0]?.price?.recurring?.interval || 'month',
    current_period_start: new Date(currentPeriodStart * 1000).toISOString(),
    current_period_end: new Date(currentPeriodEnd * 1000).toISOString(),
    trial_ends_at: subAny.trial_end ? new Date(subAny.trial_end * 1000).toISOString() : null,
    cancelled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
    payment_method_type: pm?.type || null,
    payment_method_last4: pm?.card?.last4 || null,
    payment_method_brand: pm?.card?.brand || null,
  }

  console.log('🔵 [Webhook] Upserting tenant_billing:', billingUpdate)

  // Try update first, then insert if no row exists
  const { data: existing } = await createPlatformClient()
      .schema('platform').from('product_subscriptions')
    .select('id')
    .eq('tenant_id', tenantId)
    .single()

  const { error } = existing
    ? await createPlatformClient().schema('platform').from('product_subscriptions').update(billingUpdate).eq('tenant_id', tenantId)
    : await createPlatformClient().schema('platform').from('product_subscriptions').insert(billingUpdate)

  if (error) {
    console.error('🔴 [Webhook] Failed to update tenant_billing:', error)
    throw error
  }

  console.log('✅ [Webhook] Subscription processed successfully:', {
    tenantId,
    plan,
    status: sub.status
  })

  // Send upgrade confirmation email via webhook (covers Checkout path)
  // Only send on active subscriptions, not cancellations
  if (sub.status === 'active' && plan !== 'trial') {
    try {
      // Get tenant admin email
      const { data: tenantData } = await createPlatformClient()
          .schema('platform')
          .from('tenants')
        .select('name, subdomain')
        .eq('id', tenantId)
        .single()

      const { data: adminData } = await createSharedClient()
          .schema('shared')
          .from('users')
          .select('email')
          .eq('tenant_id', tenantId)
          .eq('is_master_admin', false)
          .eq('is_active', true)
          .limit(1)
          .single()

      if (adminData?.email) {
        const subAny = sub as any
        const nextBillingDate = subAny.billing_cycle_anchor
          ? new Date((subAny.billing_cycle_anchor + 2592000) * 1000).toISOString()
          : null

        const html = buildUpgradeEmailHtml({
          companyName: tenantData?.name || tenantData?.subdomain || 'your company',
          previousPlan: 'trial',
          newPlan: plan,
          subscriptionId: sub.id,
          nextBillingDate,
          nextBillingAmount: (PLAN_PRICES[plan] || 0) * 100,
        })

        await resend.emails.send({
          from: FROM_BILLING_EMAIL,
          to: adminData.email,
          bcc: OWNER_EMAIL,
          subject: `Your BaselineDocs plan has been upgraded to ${PLAN_NAMES[plan] || plan}`,
          html,
        })
        console.log('🟢 [Webhook] Upgrade email sent to:', adminData.email)
      }
    } catch (emailErr) {
      console.log('🟡 [Webhook] Email send failed (non-fatal):', emailErr)
    }
  }

  console.log(`[Webhook] Subscription synced: ${tenantId}`)
}

function buildUpgradeEmailHtml(params: {
  companyName: string
  previousPlan: string
  newPlan: string
  subscriptionId: string
  nextBillingDate?: string | null
  nextBillingAmount?: number | null
  immediateCharge?: number | null
}) {
  const planName = PLAN_NAMES[params.newPlan] || params.newPlan
  const prevPlanName = PLAN_NAMES[params.previousPlan] || params.previousPlan
  const monthlyPrice = PLAN_PRICES[params.newPlan] || 0
  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return 'N/A'
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  }
  const formatCurrency = (cents: number) => `$${(cents / 100).toFixed(2)}`

  const proratedRow = params.immediateCharge != null
    ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">Prorated charge today</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;font-weight:600;">${formatCurrency(params.immediateCharge)}</td></tr>`
    : ''

  const nextBillingRows = params.nextBillingDate && params.nextBillingAmount != null
    ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">Next billing date</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;">${formatDate(params.nextBillingDate)}</td></tr>
       <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">Next billing amount</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;font-weight:600;">${formatCurrency(params.nextBillingAmount)}</td></tr>`
    : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:0;">
  <div style="max-width:560px;margin:40px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#1e40af;padding:32px 40px;">
      <h1 style="color:white;margin:0;font-size:24px;font-weight:700;">BaselineDocs</h1>
      <p style="color:#bfdbfe;margin:8px 0 0;font-size:14px;">Document Control System</p>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#111827;margin:0 0 8px;font-size:20px;">Your plan has been upgraded ✓</h2>
      <p style="color:#6b7280;margin:0 0 32px;font-size:15px;">
        Thank you for upgrading, <strong>${params.companyName}</strong>! Your account has been updated and new features are available immediately.
      </p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;margin-bottom:24px;">
        <table style="width:100%;"><tr>
          <td><p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;">Previous Plan</p><p style="margin:4px 0 0;font-size:16px;color:#374151;font-weight:500;">${prevPlanName}</p></td>
          <td style="text-align:center;color:#9ca3af;font-size:20px;">→</td>
          <td style="text-align:right;"><p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;">New Plan</p><p style="margin:4px 0 0;font-size:18px;color:#15803d;font-weight:700;">${planName}</p></td>
        </tr></table>
      </div>
      <h3 style="color:#374151;font-size:15px;font-weight:600;margin:0 0 12px;">Billing Summary</h3>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #e5e7eb;">
        <tbody>
          <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">New monthly rate</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;">$${monthlyPrice}/month</td></tr>
          ${proratedRow}
          ${nextBillingRows}
        </tbody>
      </table>
      <p style="color:#9ca3af;font-size:12px;margin:24px 0 0;">Subscription ID: <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">${params.subscriptionId}</code></p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p style="color:#6b7280;font-size:13px;margin:0;">Questions? Reply to this email or visit your <a href="https://app.baselinedocs.com/admin/billing" style="color:#1e40af;">billing dashboard</a>.</p>
    </div>
    <div style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:12px;margin:0;">BaselineDocs · Document Control System<br>This is a transactional email regarding your account.</p>
    </div>
  </div></body></html>`
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const tenantId = await getTenantId(sub.customer as string)
  await createPlatformClient().schema('platform').from('product_subscriptions').update({
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
  }).eq('tenant_id', tenantId)
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  if (!invoice.customer) return
  const tenantId = await getTenantId(invoice.customer as string)

  // Stripe v20: subscription might be string or object
  const invoiceAny = invoice as any
  const subscriptionId = typeof invoiceAny.subscription === 'string'
    ? invoiceAny.subscription
    : invoiceAny.subscription?.id || null

  await supabase.from('invoices').upsert({
    tenant_id: tenantId,
    stripe_invoice_id: invoice.id,
    invoice_number: invoice.number || null,
    stripe_subscription_id: subscriptionId,
    amount_due: (invoice.amount_due || 0) / 100,
    amount_paid: (invoice.amount_paid || 0) / 100,
    currency: invoice.currency,
    status: 'paid',
    invoice_date: new Date(invoice.created * 1000).toISOString(),
    paid_at: new Date().toISOString(),
    hosted_invoice_url: invoice.hosted_invoice_url || null,
    invoice_pdf_url: invoice.invoice_pdf || null,
  }, { onConflict: 'stripe_invoice_id' })

  await createPlatformClient().schema('platform').from('product_subscriptions')
    .update({
      status: 'active'
    })
    .eq('tenant_id', tenantId)
    .eq('status', 'past_due')

  console.log(`[Webhook] Invoice paid: ${tenantId}`)

  // Send payment confirmation email
  sendPaymentConfirmation(tenantId, invoice).catch(err => {
    console.error('[Webhook] Email error:', err.message)
  })
}

async function sendPaymentConfirmation(tenantId: string, invoice: Stripe.Invoice) {
  const { sendPaymentConfirmationEmail } = await import('@/lib/billing-emails')
  const { createServiceRoleClient } = await import('@/lib/supabase/server')
  const adminClient = createServiceRoleClient()

  const { data: tenant } = await createPlatformClient()
      .schema('platform')
      .from('tenants')
    .select('company_name, subdomain')
    .eq('id', tenantId)
    .single()

  const { data: billing } = await adminClient
    .schema('platform').from('product_subscriptions')
    .select('plan')
    .eq('tenant_id', tenantId)
    .single()

  const { data: adminUsers } = await createSharedClient()
      .schema('shared')
      .from('users')
      .select('email')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .limit(1)

  const adminEmail = adminUsers?.[0]?.email

  if (adminEmail && tenant && billing) {
    await sendPaymentConfirmationEmail({
      toEmail: adminEmail,
      companyName: tenant.company_name || tenant.subdomain,
      plan: billing.plan,
      amount: (invoice.amount_paid || 0) / 100,
      invoiceNumber: invoice.number || invoice.id,
      paidDate: new Date(invoice.status_transitions?.paid_at ? invoice.status_transitions.paid_at * 1000 : Date.now()).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      invoiceUrl: invoice.hosted_invoice_url || null,
      receiptUrl: invoice.invoice_pdf || null
    })
    console.log(`[Webhook] Payment confirmation sent to: ${adminEmail}`)
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  if (!invoice.customer) return
  const tenantId = await getTenantId(invoice.customer as string)
  await createPlatformClient().schema('platform').from('product_subscriptions').update({ status: 'past_due' }).eq('tenant_id', tenantId)
  console.log(`[Webhook] Payment failed: ${tenantId}`)
}

async function handlePaymentMethod(pm: Stripe.PaymentMethod) {
  if (!pm.customer) return
  const tenantId = await getTenantId(pm.customer as string)
  await createPlatformClient().schema('platform').from('product_subscriptions').update({
    payment_method_type: pm.type,
    payment_method_last4: pm.card?.last4 || null,
    payment_method_brand: pm.card?.brand || null,
  }).eq('tenant_id', tenantId)
}
