/**
 * app/admin/users/page.tsx — BaselineDocs
 * CHANGED: Admin check via shared.users.is_master_admin + docs.user_roles
 */
import { createClient, createSharedClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getSubdomainTenantId } from '@/lib/tenant'
import UserManagementTable from './UserManagementTable'
import UserLimitBanner from '@/components/admin/UserLimitBanner'

export default async function UsersPage() {
  const supabase      = await createClient()
  const sharedClient  = createSharedClient()

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) redirect('/')

  const { data: sharedUser } = await sharedClient
    .schema('shared')
    .from('users')
    .select('tenant_id, is_master_admin, is_active')
    .eq('id', user.id)
    .single()

  if (!sharedUser?.is_active) redirect('/dashboard')

  const isAdmin = sharedUser.is_master_admin || false
  if (!isAdmin) {
    const { data: roleRow } = await supabase
      .schema('docs')
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('tenant_id', sharedUser.tenant_id)
      .single()
    if (!['tenant_admin', 'master_admin'].includes(roleRow?.role ?? '')) {
      redirect('/dashboard')
    }
  }

  const targetTenantId = await getSubdomainTenantId()
  if (!targetTenantId) redirect('/dashboard')

  // Get subscription info for user limit banner (from platform via product_subscriptions view)
  // Fall back to safe defaults if not available
  const supabaseAdmin = createServiceRoleClient()
  const { count: currentUserCount } = await sharedClient
    .schema('shared')
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', targetTenantId)
    .eq('is_active', true)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
        <p className="mt-2 text-gray-600">Manage user roles and permissions</p>
      </div>
      <UserLimitBanner
        currentUsers={currentUserCount || 0}
        userLimit={99}
        plan="trial"
      />
      <UserManagementTable />
    </div>
  )
}
