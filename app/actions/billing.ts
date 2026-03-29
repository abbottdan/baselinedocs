'use server'

/**
 * app/actions/billing.ts — ClearStride Billing Server Actions
 *
 * Async server actions only. Pure constants/sync helpers are in
 * lib/billing/constants.ts (cannot be here due to 'use server' restrictions).
 *
 * Actions:
 *   changePlan    — upgrade or downgrade this product's plan
 *   upgradeSuite  — upgrade all products simultaneously (suite tenants)
 *   adjustSeats   — add/remove seats (delta-based, period-end billing)
 *   adjustStorage — add/remove 10GB storage blocks (Docs only, period-end)
 */

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { getCurrentSubdomain, getSubdomainTenantId } from '@/lib/tenant'
import { requireAdmin } from '@/lib/auth/require-admin'
import { revalidatePath } from 'next/cache'
import { stripe, getOrCreateStripeCustomer as stripeGetOrCreateCustomer } from '@/lib/stripe/client'
import {
  PLAN_ORDER, PLAN_INCLUDED_USERS, PLAN_INCLUDED_STORAGE_GB,
  SEAT_ADDON_PRICE, STORAGE_BLOCK_GB, PLAN_NAMES,
  type Plan, type Product,
} from '@/lib/billing/constants'

// Re-export types so pages/components can import from one place
export type { Plan, Product }

// ─── Types ────────────────────────────────────────────────────────────────────

export type BillingActionResult =
  | { success: true;  message: string; checkoutUrl?: string }
  | { success: false; error: string }

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getProduct(): Product {
  const p = process.env.CLEARSTRIDE_PRODUCT
  if (!p) throw new Error('CLEARSTRIDE_PRODUCT env var not set')
  return p as Product
}

function getPlanPriceId(plan: Plan, toolPosition: 1 | 2 | 3 = 1): string | undefined {
  if (plan === 'trial') return undefined
  if (plan === 'starter') {
    if (toolPosition === 2) return process.env.STRIPE_PRICE_STARTER_2ND
    if (toolPosition === 3) return process.env.STRIPE_PRICE_STARTER_3RD
    return process.env.STRIPE_PRICE_STARTER
  }
  if (plan === 'pro') {
    if (toolPosition === 2) return process.env.STRIPE_PRICE_PRO_2ND
    if (toolPosition === 3) return process.env.STRIPE_PRICE_PRO_3RD
    return process.env.STRIPE_PRICE_PRO
  }
  return undefined
}

function getSeatPriceId(plan: Plan): string | undefined {
  if (plan === 'starter') return process.env.STRIPE_PRICE_SEAT_STARTER
  if (plan === 'pro')     return process.env.STRIPE_PRICE_SEAT_PRO
  return undefined
}

async function getAdminContext() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: 'Not authenticated' } as const
  const { isAdmin } = await requireAdmin(user.id, supabase)
  if (!isAdmin) return { error: 'Admin access required' } as const
  const tenantId = await getSubdomainTenantId()
  if (!tenantId) return { error: 'Tenant not found' } as const
  return { user, tenantId }
}

async function getActiveToolCount(
  tenantId: string,
  platform: ReturnType<typeof createPlatformClient>
): Promise<number> {
  const { data } = await platform
    .schema('platform')
    .from('product_subscriptions')
    .select('product')
    .eq('tenant_id', tenantId)
    .in('status', ['active', 'trialing'])
  return data?.length ?? 1
}

async function getOrCreateStripeCustomer(opts: {
  tenantId: string
  email: string
  companyName: string
  existingCustomerId: string | null
}): Promise<string> {
  return stripeGetOrCreateCustomer({
    tenantId: opts.tenantId,
    email: opts.email,
    companyName: opts.companyName,
    existingCustomerId: opts.existingCustomerId ?? undefined,
  })
}

// ─── changePlan ───────────────────────────────────────────────────────────────

export async function changePlan(
  newPlan: Plan,
  forceCheckout = false
): Promise<BillingActionResult> {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { success: false, error: ctx.error ?? 'Unknown error' }
  const { user, tenantId } = ctx

  const platform = createPlatformClient()
  const product  = getProduct()

  const { data: sub } = await platform
    .schema('platform')
    .from('product_subscriptions')
    .select('plan, user_limit, stripe_subscription_id')
    .eq('tenant_id', tenantId)
    .eq('product', product)
    .single()

  const currentPlan = (sub?.plan ?? 'trial') as Plan
  const isDowngrade = PLAN_ORDER.indexOf(newPlan) < PLAN_ORDER.indexOf(currentPlan)

  // Block downgrade if active users exceed new plan's limit
  if (isDowngrade) {
    const admin = createServiceRoleClient()
    const { count } = await admin
      .schema('docs')
      .from('user_roles')
      .select('user_id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
    const newIncluded = PLAN_INCLUDED_USERS[newPlan]
    if ((count ?? 0) > newIncluded) {
      return {
        success: false,
        error: `You have ${count} active users but ${PLAN_NAMES[newPlan]} includes only ${newIncluded}. Deactivate users first.`,
      }
    }
  }

  // DB: update immediately — cap user_limit on downgrade
  const newIncluded  = PLAN_INCLUDED_USERS[newPlan]
  const newUserLimit = isDowngrade
    ? Math.min(sub?.user_limit ?? newIncluded, newIncluded)
    : (sub?.user_limit ?? PLAN_INCLUDED_USERS[currentPlan])

  await platform
    .schema('platform')
    .from('product_subscriptions')
    .update({ plan: newPlan, user_limit: newUserLimit })
    .eq('tenant_id', tenantId)
    .eq('product', product)

  // Stripe: schedule at period end
  const toolCount = await getActiveToolCount(tenantId, platform)
  const position  = Math.min(toolCount, 3) as 1 | 2 | 3
  const priceId   = getPlanPriceId(newPlan, position)

  if (!priceId) {
    // Trial plan or no Stripe price — DB update is sufficient
    revalidatePath('/admin/billing')
    return { success: true, message: `Plan changed to ${PLAN_NAMES[newPlan]}.` }
  }

  const { data: tenantData } = await platform
    .schema('platform')
    .from('tenants')
    .select('id, subdomain, company_name, stripe_customer_id')
    .eq('id', tenantId)
    .single()
  if (!tenantData) return { success: false, error: 'Tenant not found' }

  const subdomain  = await getCurrentSubdomain()
  const appDomain  = process.env.NEXT_PUBLIC_APP_DOMAIN ?? 'baselinedocs.com'
  const customerId = await getOrCreateStripeCustomer({
    tenantId,
    email:              user.email ?? '',
    companyName:        tenantData.company_name ?? tenantData.subdomain,
    existingCustomerId: tenantData.stripe_customer_id,
  })

  // Try to update existing subscription at period end
  if (sub?.stripe_subscription_id && !forceCheckout) {
    try {
      const existing = await stripe.subscriptions.retrieve(sub.stripe_subscription_id)
      if (existing.status !== 'canceled') {
        await stripe.subscriptions.update(sub.stripe_subscription_id, {
          items: [{ id: existing.items.data[0].id, price: priceId }],
          proration_behavior: 'none',
          billing_cycle_anchor: 'unchanged',
          metadata: { tenant_id: tenantId, plan: newPlan, product },
        })
        await platform
          .schema('platform')
          .from('tenants')
          .update({ stripe_customer_id: customerId })
          .eq('id', tenantId)
        revalidatePath('/admin/billing')
        return {
          success: true,
          message: `Plan ${isDowngrade ? 'downgraded' : 'upgraded'} to ${PLAN_NAMES[newPlan]}. Billing change at next renewal.`,
        }
      }
    } catch {
      // Subscription not found in Stripe — fall through to checkout
    }
  }

  // No active subscription or forceCheckout — go to Stripe Checkout
  const baseUrl = `https://${subdomain}.${appDomain}`
  const session = await stripe.checkout.sessions.create({
    customer:   customerId,
    mode:       'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/admin/billing?success=true`,
    cancel_url:  `${baseUrl}/admin/billing?canceled=true`,
    metadata:    { tenant_id: tenantId, plan: newPlan, product },
  })

  return { success: true, message: 'Redirecting to checkout…', checkoutUrl: session.url ?? undefined }
}

// ─── upgradeSuite ─────────────────────────────────────────────────────────────

export async function upgradeSuite(
  newPlan: 'starter' | 'pro',
  _confirmed = true
): Promise<BillingActionResult> {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { success: false, error: ctx.error ?? 'Unknown error' }
  const { tenantId } = ctx

  const platform = createPlatformClient()

  const { data: allSubs } = await platform
    .schema('platform')
    .from('product_subscriptions')
    .select('product, plan, stripe_subscription_id, user_limit')
    .eq('tenant_id', tenantId)
    .in('status', ['active', 'trialing'])

  if (!allSubs?.length) return { success: false, error: 'No active subscriptions found' }

  const isDowngrade = allSubs.some(
    s => PLAN_ORDER.indexOf(s.plan as Plan) > PLAN_ORDER.indexOf(newPlan)
  )

  // Block downgrade if users exceed new plan limit
  if (isDowngrade) {
    const admin = createServiceRoleClient()
    const { count } = await admin
      .schema('shared')
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_master_admin', false)
    const newIncluded = PLAN_INCLUDED_USERS[newPlan]
    if ((count ?? 0) > newIncluded) {
      return {
        success: false,
        error: `You have ${count} active users but ${PLAN_NAMES[newPlan]} includes only ${newIncluded}. Deactivate users first.`,
      }
    }
  }

  // Update all products in DB immediately
  for (const s of allSubs) {
    const newIncluded  = PLAN_INCLUDED_USERS[newPlan]
    const newUserLimit = isDowngrade
      ? Math.min(s.user_limit ?? newIncluded, newIncluded)
      : (s.user_limit ?? PLAN_INCLUDED_USERS[newPlan])

    await platform
      .schema('platform')
      .from('product_subscriptions')
      .update({ plan: newPlan, user_limit: newUserLimit })
      .eq('tenant_id', tenantId)
      .eq('product', s.product)
  }

  // Update Stripe subscriptions at period end
  for (let i = 0; i < allSubs.length; i++) {
    const s        = allSubs[i]
    const position = Math.min(i + 1, 3) as 1 | 2 | 3
    const priceId  = getPlanPriceId(newPlan, position)
    if (!s.stripe_subscription_id || !priceId) continue
    try {
      const existing = await stripe.subscriptions.retrieve(s.stripe_subscription_id)
      if (existing.status !== 'canceled') {
        await stripe.subscriptions.update(s.stripe_subscription_id, {
          items: [{ id: existing.items.data[0].id, price: priceId }],
          proration_behavior: 'none',
          billing_cycle_anchor: 'unchanged',
          metadata: { tenant_id: tenantId, plan: newPlan, product: s.product },
        })
      }
    } catch {
      // Non-fatal — DB already updated
    }
  }

  revalidatePath('/admin/billing')
  return {
    success: true,
    message: `All tools ${isDowngrade ? 'downgraded' : 'upgraded'} to ${PLAN_NAMES[newPlan]}. Billing changes at next renewal.`,
  }
}

// ─── adjustSeats ──────────────────────────────────────────────────────────────

export async function adjustSeats(delta: number): Promise<BillingActionResult> {
  if (delta === 0) return { success: false, error: 'No change requested' }

  const ctx = await getAdminContext()
  if ('error' in ctx) return { success: false, error: ctx.error ?? 'Unknown error' }
  const { tenantId } = ctx

  const platform = createPlatformClient()
  const product  = getProduct()

  const { data: sub } = await platform
    .schema('platform')
    .from('product_subscriptions')
    .select('plan, user_limit, stripe_subscription_id')
    .eq('tenant_id', tenantId)
    .eq('product', product)
    .single()

  const currentPlan  = (sub?.plan ?? 'starter') as Plan
  const currentLimit = sub?.user_limit ?? PLAN_INCLUDED_USERS[currentPlan]
  const newLimit     = currentLimit + delta

  if (newLimit < 1) return { success: false, error: 'Seat limit cannot go below 1' }
  if (newLimit > 200) return { success: false, error: 'Seat counts above 200 require a custom contract. Contact sales.' }

  // Block removal if it would put limit below active user count
  if (delta < 0) {
    const admin = createServiceRoleClient()
    // Count from product-specific user_roles table (not shared.users)
    const schemaName = product === 'baselinedocs' ? 'docs' : product === 'baselinereqs' ? 'reqs' : 'inventory'
    const { count } = await admin
      .schema(schemaName)
      .from('user_roles')
      .select('user_id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
    if ((count ?? 0) > newLimit) {
      return {
        success: false,
        error: `Cannot reduce to ${newLimit} seats — you have ${count} active users. Deactivate users first.`,
      }
    }
  }

  // DB: immediate
  await platform
    .schema('platform')
    .from('product_subscriptions')
    .update({ user_limit: newLimit })
    .eq('tenant_id', tenantId)
    .eq('product', product)

  // Stripe: period end
  const seatPriceId = getSeatPriceId(currentPlan)
  if (sub?.stripe_subscription_id && seatPriceId) {
    try {
      const existing = await stripe.subscriptions.retrieve(sub.stripe_subscription_id)
      if (existing.status !== 'canceled') {
        const includedSeats = PLAN_INCLUDED_USERS[currentPlan]
        const addonSeats    = Math.max(newLimit - includedSeats, 0)
        const seatItem      = existing.items.data.find(i => i.price.id === seatPriceId)
        const params = addonSeats > 0
          ? {
              items: seatItem
                ? [{ id: seatItem.id, quantity: addonSeats }]
                : [{ price: seatPriceId, quantity: addonSeats }],
              proration_behavior: 'none' as const,
              billing_cycle_anchor: 'unchanged' as const,
            }
          : seatItem
            ? {
                items: [{ id: seatItem.id, deleted: true }],
                proration_behavior: 'none' as const,
                billing_cycle_anchor: 'unchanged' as const,
              }
            : null
        if (params) await stripe.subscriptions.update(sub.stripe_subscription_id, params)
      }
    } catch (err) {
      console.error('[adjustSeats] Stripe update failed — DB already updated:', err)
    }
  }

  revalidatePath('/admin/billing')
  const seatPrice = SEAT_ADDON_PRICE[currentPlan]
  const dir = delta > 0
    ? `Added ${delta} seat${delta > 1 ? 's' : ''}`
    : `Removed ${Math.abs(delta)} seat${Math.abs(delta) > 1 ? 's' : ''}`
  return {
    success: true,
    message: `${dir}. New limit: ${newLimit}. Billing change at next renewal ($${seatPrice}/seat/mo above ${PLAN_INCLUDED_USERS[currentPlan]} included).`,
  }
}

// ─── adjustStorage ────────────────────────────────────────────────────────────

export async function adjustStorage(deltaBlocks: number): Promise<BillingActionResult> {
  if (deltaBlocks === 0) return { success: false, error: 'No change requested' }

  const product = getProduct()
  if (product !== 'baselinedocs') {
    return { success: false, error: 'Storage add-ons are available for BaselineDocs only' }
  }

  const ctx = await getAdminContext()
  if ('error' in ctx) return { success: false, error: ctx.error ?? 'Unknown error' }
  const { tenantId } = ctx

  const platform = createPlatformClient()

  const { data: sub } = await platform
    .schema('platform')
    .from('product_subscriptions')
    .select('plan, storage_limit_gb, stripe_subscription_id')
    .eq('tenant_id', tenantId)
    .eq('product', product)
    .single()

  const currentPlan = (sub?.plan ?? 'starter') as Plan
  const currentGB   = sub?.storage_limit_gb ?? PLAN_INCLUDED_STORAGE_GB[currentPlan]
  const newGB       = Number(currentGB) + (deltaBlocks * STORAGE_BLOCK_GB)

  if (newGB < STORAGE_BLOCK_GB) return { success: false, error: `Minimum storage is ${STORAGE_BLOCK_GB}GB` }

  // DB: immediate
  await platform
    .schema('platform')
    .from('product_subscriptions')
    .update({ storage_limit_gb: newGB })
    .eq('tenant_id', tenantId)
    .eq('product', product)

  // Stripe: period end — only bill blocks above plan-included amount
  const storagePriceId = process.env.STRIPE_PRICE_STORAGE_10GB
  if (sub?.stripe_subscription_id && storagePriceId) {
    const includedGB    = PLAN_INCLUDED_STORAGE_GB[currentPlan]
    const addonBlocks   = Math.max(Math.floor((newGB - includedGB) / STORAGE_BLOCK_GB), 0)
    try {
      const existing    = await stripe.subscriptions.retrieve(sub.stripe_subscription_id)
      if (existing.status !== 'canceled') {
        const storageItem = existing.items.data.find(i => i.price.id === storagePriceId)
        const params = addonBlocks > 0
          ? {
              items: storageItem
                ? [{ id: storageItem.id, quantity: addonBlocks }]
                : [{ price: storagePriceId, quantity: addonBlocks }],
              proration_behavior: 'none' as const,
              billing_cycle_anchor: 'unchanged' as const,
            }
          : storageItem
            ? {
                items: [{ id: storageItem.id, deleted: true }],
                proration_behavior: 'none' as const,
                billing_cycle_anchor: 'unchanged' as const,
              }
            : null
        if (params) await stripe.subscriptions.update(sub.stripe_subscription_id, params)
      }
    } catch (err) {
      console.error('[adjustStorage] Stripe update failed — DB already updated:', err)
    }
  }

  revalidatePath('/admin/billing')
  const dir = deltaBlocks > 0
    ? `Added ${deltaBlocks * STORAGE_BLOCK_GB}GB`
    : `Removed ${Math.abs(deltaBlocks * STORAGE_BLOCK_GB)}GB`
  return {
    success: true,
    message: `${dir}. New limit: ${newGB}GB. Billing change at next renewal.`,
  }
}

// Backwards-compat adapter for UpgradePlanDialog which calls upgradeTenantPlan({ tenantId, newPlan })
// Our new changePlan signature is changePlan(newPlan: Plan, forceCheckout?)
export async function upgradeTenantPlan(data: { tenantId: string; newPlan: string; forceCheckout?: boolean }) {
  return changePlan(data.newPlan as Plan, data.forceCheckout)
}
