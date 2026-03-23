// @ts-nocheck
import { redirect } from 'next/navigation'
import { getCurrentUser, isTenantAdmin } from '@/lib/tenant'
import { createSharedClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { getExistingTenantUsers } from '@/app/actions/user-management'
import UserManagementTable from '@/app/admin/users/UserManagementTable'
import UserLimitBanner from '@/components/admin/UserLimitBanner'

export const metadata = { title: 'User Management' }

export default async function AdminUsersPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/auth/login')
  if (!await isTenantAdmin()) redirect('/dashboard')

  const sharedClient  = createSharedClient()
  const serviceClient = createServiceRoleClient()
  const platform      = createPlatformClient()

  // 1. Identity — shared.users for this tenant
  const { data: sharedUsers } = await sharedClient
    .schema('shared')
    .from('users')
    .select('id, email, full_name, is_active, is_master_admin, created_at')
    .eq('tenant_id', currentUser.tenant_id)
    .order('created_at', { ascending: false })

  // 2. Roles — docs.user_roles
  const { data: roleRows } = await serviceClient
    .schema('docs')
    .from('user_roles')
    .select('user_id, role')
    .eq('tenant_id', currentUser.tenant_id)

  // 3. Last sign-in — auth.users (shared.users.last_sign_in_at is always null)
  //    Wrap in try/catch — failure must never block the page from loading
  let lastSignInByUserId: Record<string, string | null> = {}
  try {
    const { data: authData } = await serviceClient.auth.admin.listUsers({ perPage: 1000 })
    if (authData?.users) {
      lastSignInByUserId = Object.fromEntries(
        authData.users.map(u => [u.id, u.last_sign_in_at ?? null])
      )
    }
  } catch (err) {
    console.error('[AdminUsersPage] Failed to fetch auth.users last_sign_in_at:', err)
  }

  // 4. Filter-before-map — only users with an explicit docs.user_roles row appear in the table.
  //    Users in shared.users with no role row are on other ClearStride products and must not show here.
  const roleByUserId = Object.fromEntries((roleRows ?? []).map(r => [r.user_id, r.role]))
  const users = (sharedUsers ?? [])
    .filter(u => u.is_master_admin || roleByUserId[u.id] !== undefined)
    .map(u => ({
      ...u,
      role:            u.is_master_admin ? 'master_admin' : roleByUserId[u.id],
      last_sign_in_at: lastSignInByUserId[u.id] ?? null,
    }))

  // 5. Eligible existing users for the Add User dropdown
  const { data: existingTenantUsers } = await getExistingTenantUsers()

  // 6. Plan limits for UserLimitBanner
  const { data: subscription } = await platform
    .schema('platform')
    .from('product_subscriptions')
    .select('plan, user_limit')
    .eq('tenant_id', currentUser.tenant_id)
    .eq('product', 'baselinedocs')
    .single()

  const { count: currentUserCount } = await serviceClient
    .schema('shared')
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', currentUser.tenant_id)
    .eq('is_active', true)

  const plan         = subscription?.plan       ?? 'trial'
  const userLimit    = subscription?.user_limit ?? 5
  const currentUsers = currentUserCount         ?? 0

  return (
    <div className="space-y-5">
      <UserLimitBanner
        currentUsers={currentUsers}
        userLimit={userLimit}
        plan={plan}
      />
      <UserManagementTable
        users={users}
        currentUserId={currentUser.id}
        existingTenantUsers={existingTenantUsers ?? []}
      />
    </div>
  )
}
