/**
 * Updated User Management Page with Limit Banner
 * app/admin/users/page.tsx
 */

import { createClient, createServiceRoleClient, createSharedClient } from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import UserManagementTable from './UserManagementTable'
import UserLimitBanner from '@/components/admin/UserLimitBanner'

export default async function UsersPage() {
  const supabase = await createClient()

  // Check authentication
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  
  if (userError || !user) {
    redirect('/')
  }

  // Check admin status
  const { data: userData } = await supabase
    .schema('shared')
    .from('users')
    .select('is_master_admin, tenant_id')
    .eq('id', user.id)
    .single()

  if (!userData?.is_admin) {
    redirect('/dashboard')
  }

  // Get subdomain tenant (for multi-tenant support)
  const cookieStore = await cookies()
  const subdomainCookie = cookieStore.get('tenant_subdomain')
  const subdomain = subdomainCookie?.value

  let targetTenantId = userData.tenant_id

  if (subdomain) {
    const { data: subdomainTenant } = await createPlatformClient()
        .schema('platform')
      .from('tenants')
      .select('id')
      .eq('subdomain', subdomain)
      .single()
    
    if (subdomainTenant) {
      targetTenantId = subdomainTenant.id
    }
  }

  // Get user limit information for banner
  const supabaseAdmin = createServiceRoleClient()
  
  // Get billing info
  const { data: billingData } = await supabase
    .from('product_subscriptions')
    .select('plan, user_limit')
    .eq('tenant_id', targetTenantId)
    .single()

  // Count current users (exclude deactivated, use admin client to bypass RLS)
  const { count: currentUserCount } = await supabaseAdmin
    .schema('shared')
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', targetTenantId)
    .neq('role', 'Deactivated')

  const plan = billingData?.plan || 'trial'
  const userLimit = billingData?.user_limit || 5
  const currentUsers = currentUserCount || 0

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
          <p className="mt-2 text-gray-600">Manage user roles and permissions</p>
        </div>

        {/* User Limit Banner */}
        <UserLimitBanner 
          currentUsers={currentUsers}
          userLimit={userLimit}
          plan={plan}
        />

        <UserManagementTable />
      </div>
    </div>
  )
}
