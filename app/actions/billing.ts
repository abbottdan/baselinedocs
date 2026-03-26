'use server'

/**
 * app/actions/billing.ts — REPLACE IN ALL THREE PRODUCTS
 *
 * Pricing per clearstride_pricing_summary_v2:
 *   Plans:   trial (free, 30d) | starter ($49) | pro ($89)
 *   Users:   trial=2, starter=10, pro=25 included
 *   Seats:   starter=$5/seat, pro=$7/seat  (plan-dependent)
 *   Storage: Docs only — starter=5GB, pro=20GB included; add-ons $5/10GB block
 *   Suite:   2nd tool 15% off, 3rd tool 20% off — same tier across all tools
 *   Custom:  200+ seats → contact sales, no self-serve
 *
 * Stripe env vars (per product deployment in Vercel):
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 *   STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO
 *   STRIPE_PRICE_SEAT_STARTER    — per-seat price on starter plan
 *   STRIPE_PRICE_SEAT_PRO        — per-seat price on pro plan
 *   STRIPE_PRICE_STORAGE_10GB    — 10GB storage block (Docs only)
 *   STRIPE_PRICE_STARTER_2ND     — starter 2nd-tool price (15% off = $41.65)
 *   STRIPE_PRICE_STARTER_3RD     — starter 3rd-tool price (20% off = $39.20)
 *   STRIPE_PRICE_PRO_2ND         — pro 2nd-tool price (15% off = $75.65)
 *   STRIPE_PRICE_PRO_3RD         — pro 3rd-tool price (20% off = $71.20)
 *   CLEARSTRIDE_PRODUCT          — baselinedocs | baselinereqs | baselineinventory
 */

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import {
  getStripe, getOrCreateStripeCustomer, createCheckoutSession,
} from '@/lib/stripe/client'
import { getCurrentSubdomain, getSubdomainTenantId } from '@/lib/tenant'
import { requireAdmin } from '@/lib/auth/require-admin'
import { revalidatePath } from 'next/cache'

// ─── Types ────────────────────────────────────────────────────────────────────

export type BillingActionResult =
  | { success: true; message: string; checkoutUrl?: string }
  | { success: false; error: string }

export type Plan = 'trial' | 'starter' | 'pro'
export type Product = 'baselinedocs' | 'baselinereqs' | 'baselineinventory'

// ─── Pricing constants (UI display — actual charges via Stripe) ───────────────

export const PLAN_PRICES: Record<Plan, number> = {
  trial:   0,
  starter: 49,
  pro:     89,
}

export const PLAN_NAMES: Record<Plan, string> = {
  trial:   'Trial',
  starter: 'Starter',
  pro:     'Pro',
}

// Users included in each plan (before seat add-ons)
export const PLAN_INCLUDED_USERS: Record<Plan, number> = {
  trial:   2,
  starter: 10,
  pro:     25,
}

// Seat add-on price varies by plan
export const SEAT_ADDON_PRICE: Record<Plan, number> = {
  trial:   0,
  starter: 5,
  pro:     7,
}

// Storage included per plan (Docs only)
export const PLAN_INCLUDED_STORAGE_GB: Record<Plan, number> = {
  trial:   1,
  starter: 5,
  pro:     20,
}

export const STORAGE_BLOCK_GB        = 10
export const STORAGE_PRICE_PER_BLOCK = 5   // same for both plans

// Custom contract threshold — no self-serve above this
export const CUSTOM_CONTRACT_SEAT_THRESHOLD = 200

// Bundle discounts
export const BUNDLE_DISCOUNTS = { second: 0.15, third: 0.20 }

const PLAN_ORDER: Plan[] = ['trial', 'starter', 'pro']

const ALL_PRODUCTS: Product[] = ['baselinedocs', 'baselinereqs', 'baselineinventory']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getProduct(): Product {
  const p = process.env.CLEARSTRIDE_PRODUCT
  if (!p) throw new Error('CLEARSTRIDE_PRODUCT env var not set')
  return p as Product
}

function getSeatPriceId(plan: Plan): string | undefined {
  if (plan === 'starter') return process.env.STRIPE_PRICE_SEAT_STARTER
  if (plan === 'pro')     return process.env.STRIPE_PRICE_SEAT_PRO
  return undefined
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

async function getAdminContext() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: 'Not authenticated' } as const
  const { isAdmin } = await requireAdmin(user.id)
  if (!isAdmin) return { error: 'Admin access required' } as const
  const tenantId = await getSubdomainTenantId()
  if (!tenantId) return { error: 'Tenant not found' } as const
  return { user, tenantId }
}

// Returns how many products this tenant currently subscribes to (active/trialing)
async function getActiveToolCount(tenantId: string, platform: ReturnType<typeof createPlatformClient>): Promise<number> {
  const { data } = await platform.schema('platform').from('product_subscriptions')
    .select('product')
    .eq('tenant_id', tenantId)
    .in('status', ['active', 'trialing'])
  return data?.length ?? 0
}

// ─── changePlan ───────────────────────────────────────────────────────────────
/**
 * Upgrade or downgrade plan for this product.
 *
 * Suite rule: if tenant has multiple tools, all must be upgraded simultaneously
 * via upgradeSuite(). This action handles single-product changes only and will
 * error if the tenant has other tools at a different tier (except trial).
 *
 * DB updated immediately. Stripe change at period end (proration_behavior: none).
 */
export async function changePlan(
  newPlan:       Plan,
  confirmed:     boolean = true,
  forceCheckout: boolean = false,
): Promise<BillingActionResult> {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { success: false, error: ctx.error }
  const { user, tenantId } = ctx

  if (!PLAN_ORDER.includes(newPlan)) return { success: false, error: 'Invalid plan' }

  const platform = createPlatformClient()
  const product  = getProduct()

  const { data: sub } = await platform.schema('platform').from('product_subscriptions')
    .select('plan, stripe_subscription_id, user_limit, status')
    .eq('tenant_id', tenantId).eq('product', product).single()

  const currentPlan = (sub?.plan ?? 'trial') as Plan
  const currentIdx  = PLAN_ORDER.indexOf(currentPlan)
  const newIdx      = PLAN_ORDER.indexOf(newPlan)

  if (newIdx === currentIdx) return { success: false, error: 'Already on this plan' }

  const isDowngrade = newIdx < currentIdx
  if (isDowngrade && !confirmed) return { success: false, error: 'Downgrade not confirmed' }

  // Suite consistency check: if upgrading and other tools exist, they must all upgrade together
  if (!isDowngrade && newPlan !== 'trial') {
    const { data: otherSubs } = await platform.schema('platform').from('product_subscriptions')
      .select('product, plan')
      .eq('tenant_id', tenantId)
      .in('status', ['active', 'trialing'])
      .neq('product', product)
    const inconsistentTools = (otherSubs ?? []).filter(s => s.plan !== newPlan && s.plan !== 'trial')
    if (inconsistentTools.length > 0) {
      return {
        success: false,
        error: `Suite rule: all tools must be on the same plan. Use "Upgrade Suite" to upgrade all tools together.`,
      }
    }
  }

  // Seat guard on downgrade
  if (isDowngrade) {
    const admin = createServiceRoleClient()
    const { count } = await admin.schema('shared').from('users')
      .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_active', true)
    const newIncluded = PLAN_INCLUDED_USERS[newPlan]
    const newLimit    = Math.min(sub?.user_limit ?? newIncluded, newIncluded)
    if ((count ?? 0) > newLimit) {
      return { success: false, error: `You have ${count} active users but ${PLAN_NAMES[newPlan]} includes only ${newIncluded}. Deactivate users or purchase add-on seats first.` }
    }
  }

  // Calculate new user_limit: on downgrade cap to plan included; on upgrade keep current (admin adds seats separately)
  const newIncluded  = PLAN_INCLUDED_USERS[newPlan]
  const newUserLimit = isDowngrade
    ? Math.min(sub?.user_limit ?? newIncluded, newIncluded)
    : (sub?.user_limit ?? PLAN_INCLUDED_USERS[currentPlan])

  // DB: immediate
  await platform.schema('platform').from('product_subscriptions')
    .update({ plan: newPlan, user_limit: newUserLimit })
    .eq('tenant_id', tenantId).eq('product', product)

  // Stripe: at period end
  const toolCount  = await getActiveToolCount(tenantId, platform)
  const position   = Math.min(toolCount, 3) as 1 | 2 | 3
  const priceId    = getPlanPriceId(newPlan, position)

  if (!priceId) {
    revalidatePath('/admin/billing')
    return { success: true, message: `Plan changed to ${PLAN_NAMES[newPlan]}.` }
  }

  const { data: tenantData } = await platform.schema('platform').from('tenants')
    .select('id, subdomain, company_name, stripe_customer_id').eq('id', tenantId).single()
  if (!tenantData) return { success: false, error: 'Tenant not found' }

  const subdomain  = await getCurrentSubdomain()
  const appDomain  = process.env.NEXT_PUBLIC_APP_DOMAIN ?? 'clearstridetools.com'
  const customerId = await getOrCreateStripeCustomer({
    tenantId, email: user.email ?? '',
    companyName: tenantData.company_name ?? tenantData.subdomain,
    existingCustomerId: tenantData.stripe_customer_id,
  })

  const stripe = getStripe()

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
        await platform.schema('platform').from('tenants').update({ stripe_customer_id: customerId }).eq('id', tenantId)
        revalidatePath('/admin/billing')
        return { success: true, message: `Plan ${isDowngrade ? 'downgraded' : 'upgraded'} to ${PLAN_NAMES[newPlan]}. Billing change at next renewal.` }
      }
    } catch { /* fall through to checkout */ }
  }

  const baseUrl = `https://${subdomain}.${appDomain}`
  const session = await createCheckoutSession({
    customerId, priceId, tenantId,
    successUrl: `${baseUrl}/admin/billing?success=true`,
    cancelUrl:  `${baseUrl}/admin/billing?canceled=true`,
  })

  return { success: true, message: 'Redirecting to checkout…', checkoutUrl: session.url ?? undefined }
}

// ─── upgradeSuite ─────────────────────────────────────────────────────────────
/**
 * Upgrade ALL of this tenant's active tools to a new plan simultaneously.
 * Required for multi-tool tenants (suite rule: all tools must share one tier).
 *
 * Updates all product_subscriptions rows immediately.
 * Schedules all Stripe subscriptions at period end.
 */
export async function upgradeSuite(newPlan: 'starter' | 'pro', confirmed: boolean = true): Promise<BillingActionResult> {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { success: false, error: ctx.error }
  const { user, tenantId } = ctx

  if (!confirmed) return { success: false, error: 'Not confirmed' }

  const platform = createPlatformClient()

  const { data: allSubs } = await platform.schema('platform').from('product_subscriptions')
    .select('product, plan, stripe_subscription_id, user_limit')
    .eq('tenant_id', tenantId).in('status', ['active', 'trialing'])

  if (!allSubs?.length) return { success: false, error: 'No active subscriptions found' }

  const isDowngrade = allSubs.some(s => PLAN_ORDER.indexOf(s.plan as Plan) > PLAN_ORDER.indexOf(newPlan))

  // Seat guard on downgrade across all tools (users are shared)
  if (isDowngrade) {
    const admin = createServiceRoleClient()
    const { count } = await admin.schema('shared').from('users')
      .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_active', true)
    const newIncluded = PLAN_INCLUDED_USERS[newPlan]
    if ((count ?? 0) > newIncluded) {
      return { success: false, error: `You have ${count} active users but ${PLAN_NAMES[newPlan]} includes only ${newIncluded}. Deactivate users first.` }
    }
  }

  const { data: tenantData } = await platform.schema('platform').from('tenants')
    .select('id, subdomain, company_name, stripe_customer_id').eq('id', tenantId).single()
  if (!tenantData) return { success: false, error: 'Tenant not found' }

  const customerId = await getOrCreateStripeCustomer({
    tenantId, email: user.email ?? '',
    companyName: tenantData.company_name ?? tenantData.subdomain,
    existingCustomerId: tenantData.stripe_customer_id,
  })

  const stripe    = getStripe()
  const errors: string[] = []

  for (let i = 0; i < allSubs.length; i++) {
    const s        = allSubs[i]
    const position = Math.min(i + 1, 3) as 1 | 2 | 3
    const priceId  = getPlanPriceId(newPlan, position)

    // DB: immediate
    const newIncluded  = PLAN_INCLUDED_USERS[newPlan]
    const newUserLimit = isDowngrade
      ? Math.min(s.user_limit ?? newIncluded, newIncluded)
      : (s.user_limit ?? PLAN_INCLUDED_USERS[s.plan as Plan])

    await platform.schema('platform').from('product_subscriptions')
      .update({ plan: newPlan, user_limit: newUserLimit })
      .eq('tenant_id', tenantId).eq('product', s.product)

    // Stripe: period end
    if (priceId && s.stripe_subscription_id) {
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
      } catch (err: any) {
        errors.push(`${s.product}: ${err.message}`)
      }
    }
  }

  await platform.schema('platform').from('tenants').update({ stripe_customer_id: customerId }).eq('id', tenantId)
  revalidatePath('/admin/billing')

  if (errors.length) {
    return { success: false, error: `Suite updated in DB but Stripe errors: ${errors.join('; ')}` }
  }

  return {
    success: true,
    message: `All ${allSubs.length} tool${allSubs.length > 1 ? 's' : ''} ${isDowngrade ? 'downgraded' : 'upgraded'} to ${PLAN_NAMES[newPlan]}. Billing change at next renewal.`,
  }
}

// ─── addTool ──────────────────────────────────────────────────────────────────
/**
 * Add a new ClearStride product to this tenant's suite.
 * The new tool inherits the current tier and gets the bundle discount.
 *
 * Position 1 = full price, position 2 = 15% off, position 3 = 20% off.
 * All tools must be at the same tier — new tool inherits current plan.
 */
export async function addTool(newProduct: Product): Promise<BillingActionResult> {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { success: false, error: ctx.error }
  const { user, tenantId } = ctx

  const platform    = createPlatformClient()
  const currentTool = getProduct()

  // Get current tool's plan to determine tier for the new tool
  const { data: currentSub } = await platform.schema('platform').from('product_subscriptions')
    .select('plan, status').eq('tenant_id', tenantId).eq('product', currentTool).single()

  const currentPlan = (currentSub?.plan ?? 'trial') as Plan

  // Check new product isn't already subscribed
  const { data: existing } = await platform.schema('platform').from('product_subscriptions')
    .select('status').eq('tenant_id', tenantId).eq('product', newProduct).single()

  if (existing && ['active', 'trialing'].includes(existing.status)) {
    return { success: false, error: `Already subscribed to ${newProduct}` }
  }

  const activeCount = await getActiveToolCount(tenantId, platform)
  const newPosition = Math.min(activeCount + 1, 3) as 1 | 2 | 3
  const discount    = newPosition === 2 ? BUNDLE_DISCOUNTS.second : newPosition === 3 ? BUNDLE_DISCOUNTS.third : 0
  const priceId     = getPlanPriceId(currentPlan, newPosition)

  // Insert or update product_subscriptions for the new product
  const newIncluded = PLAN_INCLUDED_USERS[currentPlan]
  await platform.schema('platform').from('product_subscriptions')
    .upsert({
      tenant_id:  tenantId,
      product:    newProduct,
      plan:       currentPlan,
      status:     currentPlan === 'trial' ? 'trialing' : 'active',
      user_limit: newIncluded,
    }, { onConflict: 'tenant_id,product' })

  // Stripe: create new subscription for new product if not trial
  if (priceId) {
    const { data: tenantData } = await platform.schema('platform').from('tenants')
      .select('id, subdomain, company_name, stripe_customer_id').eq('id', tenantId).single()
    if (!tenantData) return { success: false, error: 'Tenant not found' }

    const subdomain  = await getCurrentSubdomain()
    const appDomain  = process.env[`NEXT_PUBLIC_${newProduct.replace('baseline', '').toUpperCase()}_DOMAIN`]
      ?? `${newProduct.replace('baseline', '')}.com`
    const customerId = await getOrCreateStripeCustomer({
      tenantId, email: user.email ?? '',
      companyName: tenantData.company_name ?? tenantData.subdomain,
      existingCustomerId: tenantData.stripe_customer_id,
    })

    const stripe  = getStripe()
    const baseUrl = `https://${subdomain}.${appDomain}`

    // For new tools, send to Checkout (they need to enter payment details for the new sub)
    const session = await createCheckoutSession({
      customerId, priceId, tenantId,
      successUrl: `${baseUrl}/admin/billing?success=true`,
      cancelUrl:  `${baseUrl}/admin/billing?canceled=true`,
    })

    return {
      success: true,
      message: `Adding ${newProduct}${discount > 0 ? ` at ${Math.round(discount * 100)}% bundle discount` : ''}. Redirecting to checkout…`,
      checkoutUrl: session.url ?? undefined,
    }
  }

  revalidatePath('/admin/billing')
  return { success: true, message: `${newProduct} added to your suite. Access is immediate; billing at next renewal.` }
}

// ─── adjustSeats ──────────────────────────────────────────────────────────────
/**
 * Add or remove seats. Price per seat depends on current plan (starter=$5, pro=$7).
 * Blocks if new limit < active user count.
 * Blocks if new limit >= CUSTOM_CONTRACT_SEAT_THRESHOLD (200+).
 */
export async function adjustSeats(delta: number): Promise<BillingActionResult> {
  if (delta === 0) return { success: false, error: 'No change requested' }

  const ctx = await getAdminContext()
  if ('error' in ctx) return { success: false, error: ctx.error }
  const { tenantId } = ctx

  const platform = createPlatformClient()
  const product  = getProduct()

  const { data: sub } = await platform.schema('platform').from('product_subscriptions')
    .select('plan, user_limit, stripe_subscription_id').eq('tenant_id', tenantId).eq('product', product).single()

  const currentPlan  = (sub?.plan ?? 'starter') as Plan
  const currentLimit = sub?.user_limit ?? PLAN_INCLUDED_USERS[currentPlan]
  const newLimit     = currentLimit + delta

  if (newLimit < 1) return { success: false, error: 'Seat limit cannot go below 1' }

  // Block at custom contract threshold
  if (newLimit >= CUSTOM_CONTRACT_SEAT_THRESHOLD) {
    return {
      success: false,
      error: `${CUSTOM_CONTRACT_SEAT_THRESHOLD}+ seats require a custom contract. Please contact us at support@clearstridetools.com.`,
    }
  }

  // Block reduction below active users
  if (delta < 0) {
    const admin = createServiceRoleClient()
    const { count } = await admin.schema('shared').from('users')
      .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_active', true)
    if ((count ?? 0) > newLimit) {
      return { success: false, error: `Cannot reduce to ${newLimit} seats — you have ${count} active users. Deactivate users first.` }
    }
  }

  // DB: immediate
  await platform.schema('platform').from('product_subscriptions')
    .update({ user_limit: newLimit }).eq('tenant_id', tenantId).eq('product', product)

  // Stripe: period end
  const seatPriceId = getSeatPriceId(currentPlan)
  if (sub?.stripe_subscription_id && seatPriceId) {
    const stripe = getStripe()
    try {
      const existing  = await stripe.subscriptions.retrieve(sub.stripe_subscription_id)
      if (existing.status !== 'canceled') {
        const seatItem = existing.items.data.find(i => i.price.id === seatPriceId)
        // Only bill add-on seats above included amount
        const includedSeats = PLAN_INCLUDED_USERS[currentPlan]
        const addonSeats    = Math.max(newLimit - includedSeats, 0)
        const params = addonSeats > 0
          ? { items: seatItem
              ? [{ id: seatItem.id, quantity: addonSeats }]
              : [{ price: seatPriceId, quantity: addonSeats }],
            proration_behavior: 'none' as const, billing_cycle_anchor: 'unchanged' as const }
          : seatItem
            // Remove the add-on item entirely if no longer needed
            ? { items: [{ id: seatItem.id, deleted: true }],
                proration_behavior: 'none' as const, billing_cycle_anchor: 'unchanged' as const }
            : null
        if (params) await stripe.subscriptions.update(sub.stripe_subscription_id, params)
      }
    } catch (err) {
      console.error('[adjustSeats] Stripe update failed — DB already updated:', err)
    }
  }

  revalidatePath('/admin/billing')
  const seatPrice = SEAT_ADDON_PRICE[currentPlan]
  const dir = delta > 0 ? `Added ${delta} seat${delta > 1 ? 's' : ''}` : `Removed ${Math.abs(delta)} seat${Math.abs(delta) > 1 ? 's' : ''}`
  return { success: true, message: `${dir}. New limit: ${newLimit}. Billing change at next renewal ($${seatPrice}/seat/mo above ${PLAN_INCLUDED_USERS[currentPlan]} included).` }
}

// ─── adjustStorage ────────────────────────────────────────────────────────────
/**
 * Add or remove storage in 10GB blocks. BaselineDocs only.
 * $5/block/month for both plans.
 */
export async function adjustStorage(deltaBlocks: number): Promise<BillingActionResult> {
  if (deltaBlocks === 0) return { success: false, error: 'No change requested' }

  const product = getProduct()
  if (product !== 'baselinedocs') return { success: false, error: 'Storage add-ons are available for BaselineDocs only' }

  const ctx = await getAdminContext()
  if ('error' in ctx) return { success: false, error: ctx.error }
  const { tenantId } = ctx

  const platform = createPlatformClient()

  const { data: sub } = await platform.schema('platform').from('product_subscriptions')
    .select('plan, storage_limit_gb, stripe_subscription_id').eq('tenant_id', tenantId).eq('product', product).single()

  const currentPlan = (sub?.plan ?? 'starter') as Plan
  const currentGB   = sub?.storage_limit_gb ?? PLAN_INCLUDED_STORAGE_GB[currentPlan]
  const newGB       = currentGB + (deltaBlocks * STORAGE_BLOCK_GB)

  if (newGB < STORAGE_BLOCK_GB) return { success: false, error: `Minimum storage is ${STORAGE_BLOCK_GB}GB` }

  // DB: immediate
  await platform.schema('platform').from('product_subscriptions')
    .update({ storage_limit_gb: newGB }).eq('tenant_id', tenantId).eq('product', product)

  // Stripe: period end — only charge blocks above included amount
  const storagePriceId = process.env.STRIPE_PRICE_STORAGE_10GB
  if (sub?.stripe_subscription_id && storagePriceId) {
    const stripe        = getStripe()
    const includedGB    = PLAN_INCLUDED_STORAGE_GB[currentPlan]
    const addonBlocks   = Math.max(Math.floor((newGB - includedGB) / STORAGE_BLOCK_GB), 0)
    try {
      const existing      = await stripe.subscriptions.retrieve(sub.stripe_subscription_id)
      if (existing.status !== 'canceled') {
        const storageItem = existing.items.data.find(i => i.price.id === storagePriceId)
        const params = addonBlocks > 0
          ? { items: storageItem
              ? [{ id: storageItem.id, quantity: addonBlocks }]
              : [{ price: storagePriceId, quantity: addonBlocks }],
            proration_behavior: 'none' as const, billing_cycle_anchor: 'unchanged' as const }
          : storageItem
            ? { items: [{ id: storageItem.id, deleted: true }],
                proration_behavior: 'none' as const, billing_cycle_anchor: 'unchanged' as const }
            : null
        if (params) await stripe.subscriptions.update(sub.stripe_subscription_id, params)
      }
    } catch (err) {
      console.error('[adjustStorage] Stripe update failed — DB already updated:', err)
    }
  }

  revalidatePath('/admin/billing')
  const dir = deltaBlocks > 0 ? `Added ${deltaBlocks * STORAGE_BLOCK_GB}GB` : `Removed ${Math.abs(deltaBlocks * STORAGE_BLOCK_GB)}GB`
  return { success: true, message: `${dir} storage. New limit: ${newGB}GB. Billing change at next renewal ($${STORAGE_PRICE_PER_BLOCK}/10GB block/mo above ${PLAN_INCLUDED_STORAGE_GB[currentPlan]}GB included).` }
}

// ─── Feature/limit lookup (for UI and soft-limit enforcement) ─────────────────

export type ProductLimits = {
  users:            number
  documents?:       number
  storageGb?:       number
  projects?:        number
  reqsPerProject?:  number
  items?:           number
  bomsBuilds?:      number
}

export function getProductLimits(product: Product, plan: Plan): ProductLimits {
  const users = PLAN_INCLUDED_USERS[plan]
  if (product === 'baselinedocs') return {
    users,
    documents:  plan === 'trial' ? 25 : plan === 'starter' ? 100 : 1000,
    storageGb:  PLAN_INCLUDED_STORAGE_GB[plan],
  }
  if (product === 'baselinereqs') return {
    users,
    projects:        plan === 'trial' ? 1  : plan === 'starter' ? 3   : 20,
    reqsPerProject:  plan === 'trial' ? 25 : plan === 'starter' ? 150 : 1000,
  }
  return { // baselineinventory
    users,
    items:      plan === 'trial' ? 25  : plan === 'starter' ? 250  : 5000,
    bomsBuilds: plan === 'trial' ? 2   : plan === 'starter' ? 10   : 25,
  }
}

export function getPlanFeatures(product: Product): Record<Plan, string[]> {
  const base: Record<Plan, string[]> = {
    trial:   ['2 users included', '30-day trial', 'Email support'],
    starter: ['10 users included', '$5/extra seat/mo', 'Email support'],
    pro:     ['25 users included', '$7/extra seat/mo', 'Priority support'],
  }
  if (product === 'baselinedocs') return {
    trial:   [...base.trial,   '25 documents', '1GB storage'],
    starter: [...base.starter, '100 documents', '5GB storage', 'Version control', 'Approval workflows'],
    pro:     [...base.pro,     '1,000 documents', '20GB storage', 'Document analytics', 'Custom doc types'],
  }
  if (product === 'baselinereqs') return {
    trial:   [...base.trial,   '1 project', '25 requirements/project'],
    starter: [...base.starter, '3 projects', '150 requirements/project', 'Traceability'],
    pro:     [...base.pro,     '20 projects', '1,000 requirements/project', 'Baseline snapshots', 'Custom attributes'],
  }
  return {
    trial:   [...base.trial,   '25 items', '2 BOMs/Builds'],
    starter: [...base.starter, '250 items', '10 BOMs/Builds', 'Barcode scanning'],
    pro:     [...base.pro,     '5,000 items', '25 BOMs/Builds', 'Multi-location', 'Lot/serial tracking'],
  }
}
