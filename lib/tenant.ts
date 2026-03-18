/**
 * lib/tenant.ts
 *
 * Tenant resolution and current-user helpers.
 *
 * This file is IDENTICAL across BaselineDocs, BaselineReqs, and BaselineInventory.
 * The only thing that changes between apps is the CLEARSTRIDE_PRODUCT env var,
 * which controls which product_subscriptions row is fetched for billing checks.
 *
 * Key changes from the previous version:
 *   - getSubdomainTenantId() now queries clearstride_platform via createPlatformClient()
 *     instead of the product DB. This is the fix that prevents subdomain collisions
 *     across products.
 *   - getCurrentUser() now joins shared.users + {product}.user_roles instead of the
 *     old public.users table. Role is read from user_roles, not the user row.
 *   - getTenantSubscription() is new — replaces all the old tenant_billing / tenants.plan
 *     queries scattered across billing pages and server actions.
 *   - All functions that previously queried tenants from the product DB now query the
 *     platform DB. The product DB no longer has a tenants table.
 *
 * Required environment variables:
 *   NEXT_PUBLIC_SUPABASE_URL      — clearstride_products Supabase URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY — clearstride_products anon key
 *   SUPABASE_SERVICE_ROLE_KEY     — clearstride_products service role key
 *   PLATFORM_SUPABASE_URL         — clearstride_platform Supabase URL
 *   PLATFORM_SUPABASE_SERVICE_KEY — clearstride_platform service role key
 *   CLEARSTRIDE_PRODUCT           — 'baselinedocs' | 'baselinereqs' | 'baselineinventory'
 */

'use server'

import { headers } from 'next/headers'
import { createClient, createSharedClient } from '@/lib/supabase/server'
import {
  createPlatformClient,
  getTenantBySubdomain,
  getTenantIdBySubdomain,
  getProductSubscription,
  type PlatformTenant,
  type ProductSubscription,
  type ProductKey,
} from '@/lib/supabase/platform'

// ─── Product key ──────────────────────────────────────────────────────────────

/**
 * Returns the product key for this application.
 * Driven by the CLEARSTRIDE_PRODUCT env var so this file is identical
 * across all three codebases.
 */
function getProductKey(): ProductKey {
  const product = process.env.CLEARSTRIDE_PRODUCT as ProductKey | undefined

  if (!product || !['baselinedocs', 'baselinereqs', 'baselineinventory'].includes(product)) {
    throw new Error(
      'CLEARSTRIDE_PRODUCT env var is not set or invalid. ' +
      "Set it to 'baselinedocs', 'baselinereqs', or 'baselineinventory'."
    )
  }

  return product
}

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Valid roles per product:
 *   BaselineDocs / BaselineReqs: readonly | user | tenant_admin | master_admin
 *   BaselineInventory:           readonly | user | inventory_manager | tenant_admin | master_admin
 */
export type UserRole =
  | 'readonly'
  | 'user'
  | 'inventory_manager'
  | 'tenant_admin'
  | 'master_admin'

export interface CurrentUser {
  /** Auth user ID (same as shared.users.id, references auth.users) */
  id:               string
  email:            string
  full_name:        string | null

  /**
   * Role from the product-scoped user_roles table.
   * This is what all permission checks should use — NOT is_admin boolean.
   * For master admins this is always 'master_admin'.
   */
  role:             UserRole

  /** True if this user is a ClearStride master admin (cross-tenant access). */
  is_master_admin:  boolean
  is_active:        boolean

  /**
   * The tenant ID this user's data requests should be scoped to.
   * For regular users:   their home tenant (same as shared.users.tenant_id)
   * For master admins:   the subdomain tenant they are currently visiting
   *
   * Always use this for data queries — never home_tenant_id directly.
   */
  tenant_id:        string

  /**
   * The user's actual home tenant (their row in shared.users).
   * Only differs from tenant_id for master admins visiting other tenants.
   */
  home_tenant_id:   string

  /** Tenant info from the platform DB. */
  tenant:           PlatformTenant | null
}

// ─── Subdomain helpers ────────────────────────────────────────────────────────

/**
 * Extracts the subdomain slug from the current request's Host header.
 *
 * Examples:
 *   acme.baselinedocs.com     → 'acme'
 *   localhost:3000            → 'app'
 *   baselinedocs.com          → 'app'  (apex domain — redirect to signup)
 *   acme.baselinedocs.com:443 → 'acme'
 */
export async function getCurrentSubdomain(): Promise<string> {
  const headersList = await headers()
  const host        = headersList.get('host') || ''
  const cleanHost   = host.split(':')[0].replace(/^www\./, '')

  // Local development
  if (cleanHost === 'localhost' || cleanHost === '127.0.0.1') return 'app'

  const parts = cleanHost.split('.')

  // Apex domain (e.g. baselinedocs.com) — no tenant context
  if (parts.length === 2) return 'app'

  // Subdomain present (e.g. acme.baselinedocs.com)
  if (parts.length >= 3) return parts[0]

  return 'app'
}

/**
 * Resolves the tenant UUID for the current subdomain by querying
 * clearstride_platform. This is the authoritative tenant ID for all
 * data queries in this request.
 *
 * Replaces the old pattern of querying public.tenants in the product DB.
 * Master admins visiting acme.baselinedocs.com get acme's tenant ID.
 */
export async function getSubdomainTenantId(): Promise<string | null> {
  const subdomain = await getCurrentSubdomain()
  if (!subdomain || subdomain === 'app') return null
  return getTenantIdBySubdomain(subdomain)
}

/**
 * Alias for getSubdomainTenantId(). All data queries should use this.
 */
export async function getCurrentTenantId(): Promise<string | null> {
  return getSubdomainTenantId()
}

/**
 * Returns full tenant data from the platform DB for the current subdomain.
 * Replaces the old join on public.tenants via the product DB.
 */
export async function getCurrentTenantData(): Promise<PlatformTenant | null> {
  const subdomain = await getCurrentSubdomain()
  if (!subdomain || subdomain === 'app') return null
  return getTenantBySubdomain(subdomain)
}

// ─── User helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the fully-resolved current user, including their product-scoped role
 * from {product}.user_roles and their tenant data from the platform DB.
 *
 * For regular users:   tenant_id = their home tenant
 * For master admins:   tenant_id = the subdomain tenant they are currently visiting
 *
 * Returns null if not authenticated or user row not found.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return null

  // Fetch user identity from shared.users
  const sharedClient = createSharedClient()
  const { data: sharedUser, error: sharedError } = await sharedClient
    .from('users')
    .select('id, email, full_name, tenant_id, is_master_admin, is_active')
    .eq('id', user.id)
    .single()

  if (sharedError || !sharedUser) return null

  // Fetch product-scoped role from {product}.user_roles
  // (supabase client is already scoped to the product schema)
  const subdomain = await getCurrentSubdomain()
  const subdomainTenantId = await getTenantIdBySubdomain(subdomain)
  const activeTenantId = subdomainTenantId ?? sharedUser.tenant_id

  const { data: roleRow } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', activeTenantId)
    .single()

  // Fall back to 'readonly' if no role row — safer than throwing
  const role = (roleRow?.role ?? 'readonly') as UserRole

  // For master admins, always return 'master_admin' as the effective role
  // regardless of what's in the product user_roles row, so permission checks
  // that test for role === 'master_admin' work correctly.
  const effectiveRole: UserRole = sharedUser.is_master_admin ? 'master_admin' : role

  // Fetch tenant data from platform DB
  const tenantData = subdomainTenantId
    ? await getTenantBySubdomain(subdomain)
    : null

  return {
    id:              sharedUser.id,
    email:           sharedUser.email,
    full_name:       sharedUser.full_name,
    role:            effectiveRole,
    is_master_admin: sharedUser.is_master_admin,
    is_active:       sharedUser.is_active,
    tenant_id:       activeTenantId,
    home_tenant_id:  sharedUser.tenant_id,
    tenant:          tenantData,
  }
}

/**
 * Returns just the tenant info for the current user.
 * Convenience wrapper around getCurrentUser().
 */
export async function getCurrentTenant(): Promise<PlatformTenant | null> {
  const user = await getCurrentUser()
  return user?.tenant ?? null
}

/**
 * Returns true if the current user is a ClearStride master admin.
 */
export async function isMasterAdmin(): Promise<boolean> {
  const sharedClient = createSharedClient()
  const supabase     = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { data } = await sharedClient
    .from('users')
    .select('is_master_admin')
    .eq('id', user.id)
    .single()

  return data?.is_master_admin === true
}

/**
 * Returns true if the current user belongs to a given tenant.
 * Uses the product user_roles table (a row must exist for the user in that tenant).
 */
export async function userBelongsToTenant(
  userId:   string,
  tenantId: string
): Promise<boolean> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .single()

  return !!data
}

// ─── Billing helpers ──────────────────────────────────────────────────────────

/**
 * Returns the current product subscription for the active tenant.
 *
 * Replaces:
 *   BaselineDocs: supabase.from('tenant_billing').select(...)
 *   BaselineReqs: supabase.from('tenants').select('plan, plan_status, ...')
 *
 * Returns null if no subscription exists (tenant not yet provisioned for
 * this product, or provisioning still in progress).
 */
export async function getTenantSubscription(): Promise<ProductSubscription | null> {
  const tenantId = await getSubdomainTenantId()
  if (!tenantId) return null

  return getProductSubscription(tenantId, getProductKey())
}

/**
 * Returns true if the current tenant has an active or trialing subscription.
 * Use this as a lightweight gate before allowing access to paid features.
 */
export async function isTenantActive(): Promise<boolean> {
  const subscription = await getTenantSubscription()
  if (!subscription) return false
  return ['active', 'trialing'].includes(subscription.status)
}

/**
 * Returns the current plan for quick display (e.g. in billing badge).
 * Returns 'trial' if no subscription exists.
 */
export async function getCurrentPlan(): Promise<string> {
  const subscription = await getTenantSubscription()
  return subscription?.plan ?? 'trial'
}

// ─── Permission helpers ────────────────────────────────────────────────────────
// These replace the old is_admin / is_master_admin boolean checks.
// Import and use these instead of reading role directly from the user object
// for the most common permission gates.

/**
 * Returns true if the current user can perform write operations in this product.
 * Excludes readonly users.
 */
export async function canWrite(): Promise<boolean> {
  const user = await getCurrentUser()
  if (!user || !user.is_active) return false
  return user.role !== 'readonly'
}

/**
 * Returns true if the current user is a tenant admin or higher.
 * Replaces: userData.is_admin === true
 */
export async function isTenantAdmin(): Promise<boolean> {
  const user = await getCurrentUser()
  if (!user) return false
  return ['tenant_admin', 'master_admin'].includes(user.role)
}

/**
 * Returns true if the current user is an inventory manager or higher.
 * Only meaningful in BaselineInventory — always false in Docs/Reqs because
 * the inventory_manager role cannot exist in those user_roles tables.
 */
export async function isInventoryManagerOrAbove(): Promise<boolean> {
  const user = await getCurrentUser()
  if (!user) return false
  return ['inventory_manager', 'tenant_admin', 'master_admin'].includes(user.role)
}

/**
 * Asserts that the current user is a tenant admin or master admin.
 * Throws a structured error if not — use in server actions that require admin access.
 *
 * Usage:
 *   const { user, tenantId } = await requireTenantAdmin()
 */
export async function requireTenantAdmin(): Promise<{
  user:     CurrentUser
  tenantId: string
}> {
  const user = await getCurrentUser()

  if (!user) {
    throw new Error('Not authenticated')
  }

  if (!['tenant_admin', 'master_admin'].includes(user.role)) {
    throw new Error('Tenant administrator access required')
  }

  return { user, tenantId: user.tenant_id }
}

/**
 * Asserts that the current user is a ClearStride master admin.
 * Throws if not. Use at the top of system-admin server actions.
 */
export async function requireMasterAdmin(): Promise<{
  user:     CurrentUser
  tenantId: string
}> {
  const user = await getCurrentUser()

  if (!user) {
    throw new Error('Not authenticated')
  }

  if (user.role !== 'master_admin' && !user.is_master_admin) {
    throw new Error('Master admin access required')
  }

  return { user, tenantId: user.tenant_id }
}
