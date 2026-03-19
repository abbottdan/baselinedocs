/**
 * app/admin/layout.tsx — BaselineDocs
 *
 * CHANGED:
 *  - Admin check uses shared.users.is_master_admin via createSharedClient()
 *  - For non-master-admins, checks docs.user_roles.role
 *  - Removed getSubdomainTenantId() guard — master admins bypass it entirely,
 *    and the tenants table no longer exists in the product DB.
 */

import { createClient, createSharedClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AdminNavTabs from './AdminNavTabs'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    redirect('/')
  }

  // Check identity from shared.users
  const sharedClient = createSharedClient()
  const { data: sharedUser } = await sharedClient
    .schema('shared')
    .from('users')
    .select('tenant_id, is_master_admin, is_active')
    .eq('id', user.id)
    .single()

  if (!sharedUser || !sharedUser.is_active) {
    redirect('/dashboard')
  }

  const isMasterAdmin = sharedUser.is_master_admin === true

  if (!isMasterAdmin) {
    // For non-master admins, check role in docs.user_roles
    // tenant_id comes from shared.users — no platform DB call needed here
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

  return (
    <div className="min-h-screen py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Admin Panel</h1>
          <p className="mt-2 text-gray-600">Manage users, settings, and configuration</p>
        </div>

        <AdminNavTabs isMasterAdmin={isMasterAdmin} />

        <div>
          {children}
        </div>
      </div>
    </div>
  )
}
