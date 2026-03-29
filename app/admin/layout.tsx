import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { redirect } from 'next/navigation'
import { getSubdomainTenantId } from '@/lib/tenant'
import AdminNavTabs from './AdminNavTabs'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  // Check authentication
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    redirect('/')
  }

  // Check admin status — allows both master_admin and tenant_admin
  const { isAdmin, isMasterAdmin } = await requireAdmin(user!.id, supabase)

  if (!isAdmin) {
    redirect('/dashboard')
  }

  // Get tenant from CURRENT SUBDOMAIN (not user's home tenant)
  const subdomainTenantId = await getSubdomainTenantId()
  if (!subdomainTenantId) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Admin Panel</h1>
          <p className="mt-2 text-gray-600">Manage users, settings, and configuration</p>
        </div>

        {/* Admin Navigation Tabs */}
        <AdminNavTabs 
          isMasterAdmin={isMasterAdmin}
        />

        {/* Content */}
        <div>
          {children}
        </div>
      </div>
    </div>
  )
}
