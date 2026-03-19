/**
 * lib/supabase/platform.ts
 *
 * Platform Supabase client — connects to clearstride_platform (Project 1).
 * This project owns: tenants, product_subscriptions, invoices, billing_history,
 * subdomain_reservations, master_admins.
 *
 * ⚠️  SERVER-SIDE ONLY — never import this in client components or expose the
 *     service key to the browser. The platform DB holds billing and tenant data
 *     for all three products and must not be client-accessible.
 *
 * Required environment variables (add to .env.local and Vercel/hosting env):
 *   PLATFORM_SUPABASE_URL          — Supabase project URL for clearstride_platform
 *   PLATFORM_SUPABASE_SERVICE_ROLE_KEY  — Service role key for clearstride_platform
 *                                    (NOT the anon key — we always need to bypass RLS here)
 *
 * Usage:
 *   import { createPlatformClient } from '@/lib/supabase/platform'
 *
 *   const platform = createPlatformClient()
 *
 *   // Resolve tenant from subdomain
 *   const { data: tenant } = await platform
 *     .from('tenants')
 *     .select('id, company_name, auth_method, is_active')
 *     .eq('subdomain', subdomain)
 *     .single()
 *
 *   // Read billing/subscription for this tenant+product
 *   const { data: subscription } = await platform
 *     .from('product_subscriptions')
 *     .select('plan, status, user_limit, trial_ends_at')
 *     .eq('tenant_id', tenantId)
 *     .eq('product', 'baselinedocs')   // ← swap per product
 *     .single()
 *
 *   // Check subdomain availability (also available as a Postgres RPC)
 *   const { data: available } = await platform
 *     .rpc('check_subdomain_available', { p_subdomain: slug })
 *
 *   // Provision a new tenant atomically (tenant row + trial subscription)
 *   const { data } = await platform
 *     .rpc('provision_tenant', {
 *       p_subdomain:    slug,
 *       p_company_name: companyName,
 *       p_product:      'baselinedocs',  // ← swap per product
 *       p_auth_method:  'email',
 *     })
 */

import { createClient } from '@supabase/supabase-js'

// ─── Env validation ──────────────────────────────────────────────────────────

function getPlatformEnv(): { url: string; serviceKey: string } {
  const url        = process.env.PLATFORM_SUPABASE_URL
  const serviceKey = process.env.PLATFORM_SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error(
      '[platform] PLATFORM_SUPABASE_URL is not set. ' +
      'Add it to .env.local and your hosting environment.'
    )
  }
  if (!serviceKey) {
    throw new Error(
      '[platform] PLATFORM_SUPABASE_SERVICE_ROLE_KEY is not set. ' +
      'Add it to .env.local and your hosting environment. ' +
      'This must be the SERVICE ROLE key, not the anon key.'
    )
  }

  return { url, serviceKey }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProductKey = 'baselinedocs' | 'baselinereqs' | 'baselineinventory'

export type SubscriptionPlan = 'trial' | 'starter' | 'professional' | 'enterprise'

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'cancelled'
  | 'paused'

export interface PlatformTenant {
  id:                 string
  subdomain:          string
  company_name:       string
  logo_url:           string | null
  stripe_customer_id: string | null
  auth_method:        'email' | 'google' | 'microsoft'
  primary_color:      string | null
  secondary_color:    string | null
  is_active:          boolean
  created_at:         string
  updated_at:         string
}

export interface ProductSubscription {
  id:                       string
  tenant_id:                string
  product:                  ProductKey
  plan:                     SubscriptionPlan
  status:                   SubscriptionStatus
  billing_cycle:            'month' | 'year' | null
  stripe_subscription_id:   string | null
  stripe_price_id:          string | null
  user_limit:               number
  document_limit:           number | null   // BaselineDocs only
  project_limit:            number | null   // BaselineReqs / BaselineInventory
  item_limit:               number | null   // BaselineInventory only
  storage_limit_gb:         number | null
  current_period_start:     string | null
  current_period_end:       string | null
  trial_ends_at:            string | null
  cancelled_at:             string | null
  payment_method_type:      string | null
  payment_method_last4:     string | null
  payment_method_brand:     string | null
  created_at:               string
  updated_at:               string
}

export interface ProvisionResult {
  tenant_id:       string | null
  subscription_id: string | null
  error:           string | null
}

// ─── Client factory ───────────────────────────────────────────────────────────

/**
 * Creates a service-role Supabase client pointed at clearstride_platform.
 *
 * Always returns a fresh client — safe to call once per request in a server
 * action or API route. Do not cache the return value across requests.
 *
 * The platform schema is set to 'platform' so all .from() calls resolve to
 * platform.tenants, platform.product_subscriptions, etc. without needing
 * .schema('platform') on every query.
 */
export function createPlatformClient() {
  const { url, serviceKey } = getPlatformEnv()

  return createClient(url, serviceKey, {
    db: { schema: 'platform' },
    auth: {
      autoRefreshToken: false,
      persistSession:   false,
    },
  })
}

// ─── High-level helpers ───────────────────────────────────────────────────────
// These wrap the raw client calls for the operations every product needs.
// Import just the helper you need rather than calling createPlatformClient()
// directly in every server action.

/**
 * Resolves a tenant record from a subdomain slug.
 * Used by middleware, auth callback, and getSubdomainTenantId().
 *
 * Returns null if the subdomain does not exist or the tenant is inactive.
 */
export async function getTenantBySubdomain(
  subdomain: string
): Promise<PlatformTenant | null> {
  const platform = createPlatformClient()

  const { data, error } = await platform
    .schema('platform')
    .from('tenants')
    .select('*')
    .eq('subdomain', subdomain.toLowerCase())
    .eq('is_active', true)
    .single()

  if (error || !data) return null
  return data as PlatformTenant
}

/**
 * Returns the UUID of the tenant for a given subdomain, or null.
 * Drop-in replacement for the old getSubdomainTenantId() DB query.
 */
export async function getTenantIdBySubdomain(
  subdomain: string
): Promise<string | null> {
  const tenant = await getTenantBySubdomain(subdomain)
  return tenant?.id ?? null
}

/**
 * Fetches the active product subscription for a tenant.
 * Returns null if no subscription row exists yet (e.g. provisioning in progress).
 */
export async function getProductSubscription(
  tenantId:  string,
  product:   ProductKey
): Promise<ProductSubscription | null> {
  const platform = createPlatformClient()

  const { data, error } = await platform
    .schema('platform')
    .from('product_subscriptions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('product', product)
    .single()

  if (error || !data) return null
  return data as ProductSubscription
}

/**
 * Checks whether a subdomain is available for registration.
 * Queries the check_subdomain_available() Postgres function which checks
 * both platform.tenants and platform.subdomain_reservations.
 *
 * Returns true  → subdomain is free
 * Returns false → taken or reserved
 */
export async function checkSubdomainAvailable(
  subdomain: string
): Promise<boolean> {
  const platform = createPlatformClient()

  const { data, error } = await platform
    .rpc('check_subdomain_available', { p_subdomain: subdomain.toLowerCase() })

  if (error) {
    console.error('[platform] checkSubdomainAvailable error:', error)
    return false   // fail closed — treat errors as unavailable
  }

  return data === true
}

/**
 * Atomically creates a new tenant + trial product subscription.
 * Call this from the marketing site signup server action after email/auth
 * signup succeeds.
 *
 * Returns { tenant_id, subscription_id } on success, or { error } on failure.
 * Failure cases: subdomain taken, subdomain reserved, DB constraint violation.
 */
export async function provisionTenant(params: {
  subdomain:    string
  companyName:  string
  product:      ProductKey
  authMethod?:  'email' | 'google' | 'microsoft'
}): Promise<ProvisionResult> {
  const platform = createPlatformClient()

  const { data, error } = await platform
    .rpc('provision_tenant', {
      p_subdomain:    params.subdomain.toLowerCase(),
      p_company_name: params.companyName,
      p_product:      params.product,
      p_auth_method:  params.authMethod ?? 'email',
    })

  if (error) {
    console.error('[platform] provisionTenant error:', error)
    return { tenant_id: null, subscription_id: null, error: error.message }
  }

  // provision_tenant() returns TABLE(tenant_id, subscription_id, error)
  // Supabase RPC returns it as an array — take the first row.
  const row = Array.isArray(data) ? data[0] : data
  return row as ProvisionResult
}

/**
 * Resolves the Stripe customer ID for a tenant.
 * Used by billing server actions before creating/updating Stripe subscriptions.
 */
export async function getStripeCustomerId(
  tenantId: string
): Promise<string | null> {
  const platform = createPlatformClient()

  const { data, error } = await platform
    .schema('platform')
    .from('tenants')
    .select('stripe_customer_id')
    .eq('id', tenantId)
    .single()

  if (error || !data) return null
  return data.stripe_customer_id
}

/**
 * Updates the Stripe customer ID on the tenant record.
 * Call this after Stripe.customers.create() for new tenants.
 */
export async function setStripeCustomerId(
  tenantId:         string,
  stripeCustomerId: string
): Promise<void> {
  const platform = createPlatformClient()

  const { error } = await platform
    .schema('platform')
    .from('tenants')
    .update({ stripe_customer_id: stripeCustomerId })
    .eq('id', tenantId)

  if (error) {
    console.error('[platform] setStripeCustomerId error:', error)
    throw new Error(`Failed to set Stripe customer ID: ${error.message}`)
  }
}

/**
 * Resolves a tenant_id from a Stripe customer ID.
 * Used in Stripe webhook handlers to identify which tenant an event belongs to.
 * Replaces the old getTenantId(customerId) helper in the BaselineDocs webhook.
 */
export async function getTenantIdByStripeCustomer(
  stripeCustomerId: string
): Promise<string> {
  const platform = createPlatformClient()

  const { data, error } = await platform
    .schema('platform')
    .from('tenants')
    .select('id')
    .eq('stripe_customer_id', stripeCustomerId)
    .single()

  if (error || !data) {
    throw new Error(
      `[platform] No tenant found for Stripe customer ${stripeCustomerId}: ${error?.message}`
    )
  }

  return data.id
}
