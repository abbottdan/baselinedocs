'use server'

import { createClient , createSharedClient} from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { logger } from '@/lib/logger'
import { Resend } from 'resend'
import {
  stripe,
  STRIPE_PRICES,
  getOrCreateStripeCustomer,
  createCheckoutSession,
  createBillingPortalSession
} from '@/lib/stripe/client'
import { getCurrentSubdomain, getSubdomainTenantId } from '@/lib/tenant'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM_BILLING_EMAIL = process.env.FROM_BILLING_EMAIL || 'billing@baselinedocs.com'
const OWNER_EMAIL = process.env.FEEDBACK_EMAIL || 'abbott.dan@gmail.com'

const PLAN_NAMES: Record<string, string> = {
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
}

const PLAN_PRICES: Record<string, number> = {
  starter: 29,
  professional: 99,
  enterprise: 299,
}

/**
 * Send upgrade confirmation email to tenant admin + owner BCC
 */
async function sendUpgradeConfirmation(params: {
  toEmail: string
  companyName: string
  previousPlan: string
  newPlan: string
  subscriptionId: string
  immediateCharge?: number | null  // proration amount in cents, null for new subscriptions
  nextBillingDate?: string | null
  nextBillingAmount?: number | null
}) {
  const planName = PLAN_NAMES[params.newPlan] || params.newPlan
  const prevPlanName = PLAN_NAMES[params.previousPlan] || params.previousPlan
  const monthlyPrice = PLAN_PRICES[params.newPlan] || 0

  const formatCurrency = (cents: number) => `$${(cents / 100).toFixed(2)}`
  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return 'N/A'
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    })
  }

  const proratedSection = params.immediateCharge != null
    ? `
      <tr>
        <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Prorated charge today</td>
        <td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: right; font-weight: 600;">${formatCurrency(params.immediateCharge)}</td>
      </tr>`
    : ''

  const nextBillingSection = params.nextBillingDate && params.nextBillingAmount != null
    ? `
      <tr>
        <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Next billing date</td>
        <td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: right;">${formatDate(params.nextBillingDate)}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Next billing amount</td>
        <td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: right; font-weight: 600;">${formatCurrency(params.nextBillingAmount)}</td>
      </tr>`
    : ''

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
          <h2 style="color: #111827; margin: 0 0 8px; font-size: 20px;">Your plan has been upgraded ✓</h2>
          <p style="color: #6b7280; margin: 0 0 32px; font-size: 15px;">
            Thank you for upgrading, <strong>${params.companyName}</strong>! Your account has been updated and the new features are available immediately.
          </p>

          <!-- Plan Change -->
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="flex: 1;">
                <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">Previous Plan</p>
                <p style="margin: 4px 0 0; font-size: 16px; color: #374151; font-weight: 500;">${prevPlanName}</p>
              </div>
              <div style="color: #9ca3af; font-size: 20px;">→</div>
              <div style="flex: 1; text-align: right;">
                <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em;">New Plan</p>
                <p style="margin: 4px 0 0; font-size: 18px; color: #15803d; font-weight: 700;">${planName}</p>
              </div>
            </div>
          </div>

          <!-- Billing Summary -->
          <h3 style="color: #374151; font-size: 15px; font-weight: 600; margin: 0 0 12px;">Billing Summary</h3>
          <table style="width: 100%; border-collapse: collapse; border-top: 1px solid #e5e7eb;">
            <tbody>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">New monthly rate</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px; text-align: right;">$${monthlyPrice}/month</td>
              </tr>
              ${proratedSection}
              ${nextBillingSection}
            </tbody>
          </table>

          <!-- Subscription ID -->
          <p style="color: #9ca3af; font-size: 12px; margin: 24px 0 0;">
            Subscription ID: <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">${params.subscriptionId}</code>
          </p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

          <p style="color: #6b7280; font-size: 13px; margin: 0;">
            Questions about your billing? Reply to this email or visit your 
            <a href="https://app.baselinedocs.com/admin/billing" style="color: #1e40af;">billing dashboard</a>.
          </p>
        </div>

        <!-- Footer -->
        <div style="background: #f9fafb; padding: 24px 40px; border-top: 1px solid #e5e7eb;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">
            BaselineDocs · Document Control System<br>
            This is a transactional email regarding your account.
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
      subject: `Your BaselineDocs plan has been upgraded to ${planName}`,
      html,
    })
    logger.info('🟢 [Billing] Upgrade confirmation email sent', {
      to: params.toEmail,
      plan: params.newPlan
    })
  } catch (err) {
    // Non-fatal - log but don't fail the upgrade
    logger.error('🟡 [Billing] Failed to send upgrade email (non-fatal)', { error: err })
  }
}

/**
 * Upgrade tenant plan (tenant admin action)
 */
export async function upgradeTenantPlan(data: {
  tenantId: string
  newPlan: string
  forceCheckout?: boolean
}) {
  const supabase = await createClient()

  logger.info('🔵 [Billing] upgradeTenantPlan called', {
    tenantId: data.tenantId,
    newPlan: data.newPlan
  })

  try {
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      logger.error('🔴 [Billing] User authentication failed', { error: userError })
      return { success: false, error: 'You must be logged in' }
    }

    logger.info('🟢 [Billing] User authenticated', { userId: user.id, email: user.email })

    // Validate plan
    const validPlans = ['starter', 'professional', 'enterprise'] as const
    if (!validPlans.includes(data.newPlan as any)) {
      logger.error('🔴 [Billing] Invalid plan', { plan: data.newPlan })
      return { success: false, error: 'Invalid plan selected' }
    }

    // Get subdomain to verify tenant context
    // Get subdomain and tenant ID
    const subdomain = await getCurrentSubdomain()
    const subdomainTenantId = await getSubdomainTenantId()

    if (!subdomainTenantId || !subdomain) {
      logger.error('🔴 [Billing] Tenant not found for subdomain')
      return { success: false, error: 'Tenant context not found' }
    }

        logger.info('🟢 [Billing] Subdomain tenant found', { subdomainTenantId })

    // Verify the request's tenantId matches the subdomain tenant (security check)
    if (data.tenantId !== subdomainTenantId) {
      logger.error('🔴 [Billing] Tenant mismatch', {
        subdomainTenantId,
        requestedTenant: data.tenantId
      })
      return { success: false, error: 'Tenant mismatch' }
    }

    // Fetch full tenant data (including company_name)
    const { data: tenantData } = await createPlatformClient()
        .schema('platform')
        .from('tenants')
        .select('id, subdomain, company_name')
        .eq('id', subdomainTenantId)
        .single()

    if (!tenantData) {
      logger.error('🔴 [Billing] Failed to fetch tenant data', { subdomainTenantId })
      return { success: false, error: 'Tenant data not found' }
    }

    logger.info('🟢 [Billing] Tenant verified', {
      tenantId: tenantData.id,
      companyName: tenantData.company_name
    })

    // Continue using tenantData.company_name...

    // Check admin status
    const sharedClient = createSharedClient()
      const { data: _su } = await sharedClient
        .schema('shared').from('users')
        .select('is_master_admin, tenant_id, email')
        .eq('id', user.id).single()
      let _billingIsAdmin = _su?.is_master_admin ?? false
      if (_su && !_su.is_master_admin) {
        const { data: rr } = await supabase.schema('docs').from('user_roles')
          .select('role').eq('user_id', user.id).eq('tenant_id', _su.tenant_id).single()
        _billingIsAdmin = ['tenant_admin','master_admin'].includes(rr?.role ?? '')
      }
      const userData = { is_admin: _billingIsAdmin, tenant_id: _su?.tenant_id, email: _su?.email ?? user.email }

    if (!userData?.is_admin || userData.tenant_id !== data.tenantId) {
      logger.error('🔴 [Billing] Permission denied', {
        isAdmin: userData?.is_admin,
        userTenant: userData?.tenant_id,
        requestedTenant: data.tenantId
      })
      return { success: false, error: 'Only tenant administrators can upgrade plans' }
    }

    logger.info('🟢 [Billing] Admin permissions verified')

    // Get current billing info
    const { data: currentBilling } = await createPlatformClient()
        .schema('platform')
        .from('product_subscriptions')
        .select('plan, status, stripe_customer_id, stripe_subscription_id')
        .eq('tenant_id', data.tenantId)
        .eq('product', 'baselinedocs')
        .single()

    logger.info('🟢 [Billing] Current billing retrieved', {
      currentPlan: currentBilling?.plan,
      stripeCustomerId: currentBilling?.stripe_customer_id,
      stripeSubscriptionId: currentBilling?.stripe_subscription_id
    })

    // Validate upgrade (can only go up, not down)
    const planOrder = ['trial', 'starter', 'professional', 'enterprise']
    const currentIndex = planOrder.indexOf(currentBilling?.plan || 'trial')
    const newIndex = planOrder.indexOf(data.newPlan)

    if (newIndex <= currentIndex) {
      logger.error('🔴 [Billing] Cannot downgrade', {
        currentPlan: currentBilling?.plan,
        newPlan: data.newPlan
      })
      return {
        success: false,
        error: 'You can only upgrade to a higher plan. Contact support for downgrades.'
      }
    }

    logger.info('🟢 [Billing] Upgrade validation passed', {
      from: currentBilling?.plan,
      to: data.newPlan
    })

    // Get or create Stripe customer
    logger.info('🔵 [Billing] Getting/creating Stripe customer...')

    const customerId = await getOrCreateStripeCustomer({
      tenantId: data.tenantId,
      email: userData.email || '',
      companyName: tenantData.company_name || tenantData.subdomain,
      existingCustomerId: currentBilling?.stripe_customer_id,
    })

    logger.info('🟢 [Billing] Stripe customer ready', { customerId })

    // Get price ID for the new plan
    const priceId = STRIPE_PRICES[data.newPlan as keyof typeof STRIPE_PRICES]

    if (!priceId) {
      logger.error('🔴 [Billing] Price ID not configured', { plan: data.newPlan })
      return { success: false, error: 'Invalid plan configuration' }
    }

    logger.info('🟢 [Billing] Price ID found', { plan: data.newPlan, priceId })

    // Check if they have an existing active subscription
    if (currentBilling?.stripe_subscription_id && !data.forceCheckout) {
      logger.info('🔵 [Billing] Existing subscription found - checking status...', {
        subscriptionId: currentBilling.stripe_subscription_id
      })

      // Retrieve and check subscription status before updating
      const subscription = await stripe.subscriptions.retrieve(
        currentBilling.stripe_subscription_id
      )

      if (subscription.status === 'canceled') {
        logger.info('🟡 [Billing] Subscription is cancelled - will create new checkout session', {
          subscriptionId: currentBilling.stripe_subscription_id,
          status: subscription.status
        })
        // Clear the cancelled subscription ID from database so we create a fresh one
        await createPlatformClient()
            .schema('platform')
            .from('product_subscriptions')
            .update({ stripe_subscription_id: null })
            .eq('tenant_id', data.tenantId)
            .eq('product', 'baselinedocs')
        // Fall through to checkout session creation below
      } else {
        logger.info('🔵 [Billing] Updating active subscription...', {
          subscriptionId: currentBilling.stripe_subscription_id,
          status: subscription.status
        })

        await stripe.subscriptions.update(currentBilling.stripe_subscription_id, {
          items: [{
            id: subscription.items.data[0].id,
            price: priceId,
          }],
          proration_behavior: 'create_prorations',
          metadata: {
            tenant_id: data.tenantId,
            plan: data.newPlan,
          },
        })

        logger.info('🟢 [Billing] Subscription updated in Stripe', {
          subscriptionId: currentBilling.stripe_subscription_id,
          newPlan: data.newPlan
        })

        // Update billing record
        await createPlatformClient()
            .schema('platform')
            .from('product_subscriptions')
            .update({
            plan: data.newPlan,
            stripe_price_id: priceId,
            updated_at: new Date().toISOString(),
          })
            .eq('tenant_id', data.tenantId)
            .eq('product', 'baselinedocs')

        logger.info('🟢 [Billing] Database updated')

        // Log to billing history
        await supabase
          .from('billing_history')
          .insert({
            tenant_id: data.tenantId,
            action: 'plan_upgrade',
            previous_plan: currentBilling?.plan || 'trial',
            new_plan: data.newPlan,
            reason: 'Tenant admin upgrade via billing page',
            performed_by: user.id,
            performed_by_email: user.email || '',
          })

        logger.info('🟢 [Billing] Billing history logged')

        // Fetch upcoming invoice for proration details (optional for email)
        let immediateCharge: number | null = null
        let nextBillingDate: string | null = null
        let nextBillingAmount: number | null = null
        try {
          // Try to get upcoming invoice - method name varies by Stripe version
          const upcoming = await (stripe.invoices as any).retrieveUpcoming?.({ customer: customerId })
            || await (stripe.invoices as any).upcoming?.({ customer: customerId })

          if (upcoming) {
            const prorationLines = upcoming.lines?.data?.filter((l: any) => l.proration) || []
            const prorationTotal = prorationLines.reduce((sum: number, l: any) => sum + l.amount, 0)
            immediateCharge = prorationTotal > 0 ? prorationTotal : null
            nextBillingDate = upcoming.next_payment_attempt
              ? new Date(upcoming.next_payment_attempt * 1000).toISOString()
              : null
            nextBillingAmount = upcoming.amount_due
          }
        } catch (e) {
          // Non-fatal - email will just not have proration details
          logger.info('🟡 [Billing] Could not fetch upcoming invoice (non-fatal)', { error: String(e) })
        }

        // Send confirmation email
        await sendUpgradeConfirmation({
          toEmail: user.email!,
          companyName: tenantData?.company_name || tenantData?.subdomain,
          previousPlan: currentBilling?.plan || 'trial',
          newPlan: data.newPlan,
          subscriptionId: currentBilling.stripe_subscription_id,
          immediateCharge,
          nextBillingDate,
          nextBillingAmount,
        })

        revalidatePath('/admin/billing')

        return {
          success: true,
          message: 'Plan upgraded successfully!'
        }
      } // end else (active subscription)
    }

    // No existing subscription (or cancelled) - check for saved payment method first
    logger.info('🔵 [Billing] No active subscription - checking for saved payment method...')

    // Check if the Stripe customer has a payment method saved
    const stripeCustomer = await stripe.customers.retrieve(customerId, {
      expand: ['invoice_settings.default_payment_method']
    }) as any

    let paymentMethodId: string | null = null

    // First check invoice_settings.default_payment_method
    if (stripeCustomer.invoice_settings?.default_payment_method) {
      const pm = stripeCustomer.invoice_settings.default_payment_method
      paymentMethodId = typeof pm === 'string' ? pm : pm.id
      logger.info('🔵 [Billing] Found default payment method', { paymentMethodId })
    }

    // If no default, check if customer has any payment methods attached
    if (!paymentMethodId) {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
        limit: 1
      })
      if (paymentMethods.data.length > 0) {
        paymentMethodId = paymentMethods.data[0].id
        logger.info('🔵 [Billing] Found attached payment method (not set as default)', { paymentMethodId })
      }
    }

    if (paymentMethodId && !data.forceCheckout) {
      // Customer has a saved card - create subscription directly, no Checkout needed
      logger.info('🔵 [Billing] Saved payment method found - creating subscription directly', {
        customerId,
        paymentMethod: paymentMethodId
      })

      const newSubscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        default_payment_method: paymentMethodId,
        metadata: {
          tenant_id: data.tenantId,
          plan: data.newPlan,
        },
      })

      logger.info('🟢 [Billing] Subscription created directly', {
        subscriptionId: newSubscription.id,
        status: newSubscription.status
      })

      // Update billing record immediately
      await createPlatformClient()
      .schema('platform')
      .from('product_subscriptions')
      .upsert({
        tenant_id: data.tenantId,
        product: 'baselinedocs',
        stripe_customer_id: customerId,
        stripe_subscription_id: newSubscription.id,
        plan: data.newPlan,
        status: newSubscription.status,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,product' })

      logger.info('🟢 [Billing] Database updated after direct subscription creation')

      // Fetch next billing info for email
      let nextBillingDate: string | null = null
      let nextBillingAmount: number | null = null
      try {
        const subAny = newSubscription as any
        nextBillingDate = subAny.billing_cycle_anchor
          ? new Date((subAny.billing_cycle_anchor + 2592000) * 1000).toISOString()
          : null
        nextBillingAmount = (PLAN_PRICES[data.newPlan] || 0) * 100
      } catch (e) { }

      // Send confirmation email
      await sendUpgradeConfirmation({
        toEmail: user.email!,
        companyName: tenantData?.company_name || tenantData?.subdomain,
        previousPlan: currentBilling?.plan || 'trial',
        newPlan: data.newPlan,
        subscriptionId: newSubscription.id,
        immediateCharge: null,  // New subscription, first full charge
        nextBillingDate,
        nextBillingAmount,
      })

      revalidatePath('/admin/billing')

      return {
        success: true,
        message: 'Plan upgraded successfully!'
      }
    }

    // No saved payment method (or forceCheckout) - redirect to Stripe Checkout
    logger.info('🔵 [Billing] No saved payment method - creating checkout session...')

    const session = await createCheckoutSession({
      customerId,
      priceId,
      tenantId: data.tenantId,
      successUrl: `https://${subdomain}.baselinedocs.com/admin/billing?success=true`,
      cancelUrl: `https://${subdomain}.baselinedocs.com/admin/billing?canceled=true`,
    })

    logger.info('🟢 [Billing] Checkout session created', {
      sessionId: session.id,
      url: session.url,
      successUrl: `https://${subdomain}.baselinedocs.com/admin/billing?success=true`
    })

    // Update customer ID in database
    await createPlatformClient()
        .schema('platform')
        .from('product_subscriptions')
        .update({
        stripe_customer_id: customerId,
        updated_at: new Date().toISOString(),
      })
        .eq('tenant_id', data.tenantId)
        .eq('product', 'baselinedocs')

    logger.info('🟢 [Billing] Customer ID saved to database')

    // Return checkout URL for redirect
    return {
      success: true,
      checkoutUrl: session.url,
    }
  } catch (error: any) {
    logger.error('🔴 [Billing] FATAL ERROR', {
      error: error.message,
      stack: error.stack,
      tenantId: data.tenantId
    })
    return {
      success: false,
      error: error.message || 'Failed to upgrade plan'
    }
  }
}
