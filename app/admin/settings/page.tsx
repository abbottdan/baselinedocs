import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createPlatformClient } from '@/lib/supabase/platform'
import { redirect } from 'next/navigation'
import CompanySettingsForm from './CompanySettingsForm'
import { getCurrentSubdomain } from '@/lib/tenant'

export default async function CompanySettingsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/')
  }

  // Check admin access — allows master_admin and tenant_admin
  const { isAdmin, isMasterAdmin, tenantId: userTenantId } = await requireAdmin(user!.id, supabase)
  if (!isAdmin) {
    redirect('/dashboard')
  }
  const userData = {
    is_admin: isAdmin,
    is_master_admin: isMasterAdmin,
    tenant_id: userTenantId,
  }

  const currentSubdomain = await getCurrentSubdomain()

  const { data: tenant } = await createPlatformClient()
      .schema('platform')
      .from('tenants')
    .select('id, company_name, subdomain, logo_url, timezone, auto_rename_files')
    .eq('subdomain', currentSubdomain)
    .single()

  if (!tenant) {
    // Fallback: create a minimal tenant object so the form still renders
    // This happens when auto_rename_files column doesn't exist yet on platform.tenants
    // or when the subdomain lookup fails for the dev tenant
    const fallbackTenant = {
      id: await (async () => { const { getTenantIdBySubdomain } = await import('@/lib/supabase/platform'); return await getTenantIdBySubdomain(currentSubdomain) })() || '',
      company_name: 'ClearStride (Dev)',
      subdomain: currentSubdomain,
      logo_url: null,
      auto_rename_files: true,
      timezone: 'America/Los_Angeles',
    }
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <CompanySettingsForm tenant={fallbackTenant} />
      </div>
    )
  }

  if (!userData.is_master_admin && tenant.id !== userData.tenant_id) {
    redirect('/dashboard')
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Company Settings</h2>
        <p className="mt-2 text-gray-600">
          Manage your organization's identity and preferences
        </p>
        {userData.is_master_admin && (
          <p className="mt-1 text-sm text-[#2563EB]">
            Viewing settings for: <strong>{currentSubdomain}</strong>
          </p>
        )}
      </div>

      <CompanySettingsForm
        tenant={{
          id: tenant.id,
          company_name: tenant.company_name,
          subdomain: tenant.subdomain,
          logo_url: tenant.logo_url,
          auto_rename_files: tenant.auto_rename_files ?? true,
          timezone: tenant.timezone ?? 'America/Los_Angeles',
        }}
      />
    </div>
  )
}
