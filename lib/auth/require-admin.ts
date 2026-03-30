'use server'

import { createSharedClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'

export interface AdminCheckResult {
  isAdmin: boolean
  isMasterAdmin: boolean
  tenantId: string | null
  error?: string
}

export async function requireAdmin(
  userId: string,
  supabase?: Awaited<ReturnType<typeof createClient>>
): Promise<AdminCheckResult> {
  console.log('[requireAdmin] START userId:', userId)

  const sharedClient = createSharedClient()

  const { data: sharedUser, error: userError } = await sharedClient
    .schema('shared')
    .from('users')
    .select('tenant_id, is_master_admin, is_active')
    .eq('id', userId)
    .single()

  if (userError) {
    console.log('[requireAdmin] shared.users query ERROR:', JSON.stringify(userError))
    return { isAdmin: false, isMasterAdmin: false, tenantId: null, error: 'User not found' }
  }

  if (!sharedUser) {
    console.log('[requireAdmin] shared.users: no row found for userId:', userId)
    return { isAdmin: false, isMasterAdmin: false, tenantId: null, error: 'User not found' }
  }

  console.log('[requireAdmin] shared.users row:', JSON.stringify({
    tenant_id: sharedUser.tenant_id,
    is_master_admin: sharedUser.is_master_admin,
    is_active: sharedUser.is_active,
  }))

  if (!sharedUser.is_active) {
    console.log('[requireAdmin] FAIL: user is_active=false')
    return { isAdmin: false, isMasterAdmin: false, tenantId: sharedUser.tenant_id, error: 'Account is deactivated' }
  }

  if (sharedUser.is_master_admin) {
    console.log('[requireAdmin] PASS: is_master_admin=true')
    return { isAdmin: true, isMasterAdmin: true, tenantId: sharedUser.tenant_id }
  }

  // Check docs.user_roles for tenant_admin
  const { data: roleRow, error: roleError } = await createServiceRoleClient()
    .schema('docs')
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('tenant_id', sharedUser.tenant_id)
    .single()

  if (roleError) {
    console.log('[requireAdmin] docs.user_roles query ERROR:', JSON.stringify(roleError))
  }

  console.log('[requireAdmin] docs.user_roles row:', JSON.stringify(roleRow ?? null))

  const isAdmin = ['tenant_admin', 'master_admin'].includes(roleRow?.role ?? '')
  console.log('[requireAdmin] RESULT isAdmin:', isAdmin, 'role:', roleRow?.role ?? 'none')

  return {
    isAdmin,
    isMasterAdmin: false,
    tenantId: sharedUser.tenant_id,
    ...(!isAdmin && { error: 'Admin access required' }),
  }
}

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
