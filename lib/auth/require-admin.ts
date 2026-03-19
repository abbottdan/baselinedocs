/**
 * lib/auth/require-admin.ts
 *
 * Shared helper for admin permission checks across all server actions.
 * Replaces the inline two-step pattern scattered across user-management.ts,
 * document-types.ts, admin pages, etc.
 *
 * Usage:
 *   const { isAdmin, isMasterAdmin, tenantId, error } = await requireAdmin(userId, supabase)
 *   if (error) return { success: false, error }
 */

import { createSharedClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'

export interface AdminCheckResult {
  isAdmin: boolean
  isMasterAdmin: boolean
  tenantId: string | null
  error?: string
}

/**
 * Check if a user is an admin (master_admin or tenant_admin).
 * Uses shared.users for is_master_admin, falls back to docs.user_roles for tenant_admin.
 *
 * @param userId  - The auth user ID to check
 * @param supabase - Optional existing supabase client (avoids creating a second one)
 */
export async function requireAdmin(
  userId: string,
  supabase?: Awaited<ReturnType<typeof createClient>>
): Promise<AdminCheckResult> {
  const client = supabase ?? await createClient()
  const sharedClient = createSharedClient()

  const { data: sharedUser, error: userError } = await sharedClient
    .schema('shared')
    .from('users')
    .select('tenant_id, is_master_admin, is_active')
    .eq('id', userId)
    .single()

  if (userError || !sharedUser) {
    return { isAdmin: false, isMasterAdmin: false, tenantId: null, error: 'User not found' }
  }

  if (!sharedUser.is_active) {
    return { isAdmin: false, isMasterAdmin: false, tenantId: sharedUser.tenant_id, error: 'Account is deactivated' }
  }

  // Master admins are always admins
  if (sharedUser.is_master_admin) {
    return { isAdmin: true, isMasterAdmin: true, tenantId: sharedUser.tenant_id }
  }

  // Check docs.user_roles for tenant_admin
  const { data: roleRow } = await client
    .schema('docs')
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('tenant_id', sharedUser.tenant_id)
    .single()

  const isAdmin = ['tenant_admin', 'master_admin'].includes(roleRow?.role ?? '')

  return {
    isAdmin,
    isMasterAdmin: false,
    tenantId: sharedUser.tenant_id,
    ...(!isAdmin && { error: 'Admin access required' }),
  }
}

/**
 * Like requireAdmin but throws/returns error string if not admin.
 * Convenience wrapper for actions that want early return pattern.
 */
export async function assertAdmin(
  userId: string,
  supabase?: Awaited<ReturnType<typeof createClient>>
): Promise<{ isMasterAdmin: boolean; tenantId: string }> {
  const result = await requireAdmin(userId, supabase)
  if (!result.isAdmin || !result.tenantId) {
    throw new Error(result.error ?? 'Admin access required')
  }
  return { isMasterAdmin: result.isMasterAdmin, tenantId: result.tenantId }
}
