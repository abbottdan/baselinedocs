/**
 * app/actions/system-admin.ts
 * CHANGED: All DB lookups migrated to new schema structure.
 *   - tenants  → createPlatformClient().schema('platform').from('tenants')
 *   - users    → createSharedClient().schema('shared').from('users')
 *   - tenant_billing → platform.product_subscriptions
 *   - billing_history → platform.billing_history
 *   - invoices → platform.invoices
 */

'use server'

import { createClient, createSharedClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { redirect } from 'next/navigation'

interface TenantMetrics {
  tenant_id: string
  company_name: string
  subdomain: string
  user_count: number
  document_count: number
  storage_bytes: number
  storage_mb: number
  storage_gb: number
  email_sends: number
  total_cost_estimate: number
  created_at: string
  last_activity: string | null
}

interface SystemMetrics {
  total_tenants: number
  total_users: number
  total_documents: number
  total_storage_gb: number
  total_email_sends: number
  total_estimated_cost: number
}

async function checkMasterAdmin() {
  const supabase      = await createClient()
  const sharedClient  = createSharedClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: sharedUser } = await sharedClient
    .schema('shared')
    .from('users')
    .select('is_master_admin')
    .eq('id', user.id)
    .single()

  if (!sharedUser?.is_master_admin) redirect('/dashboard')

  return { supabase, sharedClient, user }
}

async function getTenantStorage(supabase: any, tenantId: string): Promise<number> {
  const { data, error } = await supabase
    .schema('docs')
    .from('document_files')
    .select('file_size')
    .eq('tenant_id', tenantId)

  if (!error && data) {
    return data.reduce((sum: number, f: any) => sum + (f.file_size || 0), 0)
  }
  return 0
}

export async function getAllTenantMetrics(): Promise<TenantMetrics[]> {
  const { supabase } = await checkMasterAdmin()
  const platform     = createPlatformClient()
  const shared       = createSharedClient()

  const { data: tenants } = await platform
    .schema('platform')
    .from('tenants')
    .select('id, company_name, subdomain, created_at')
    .order('company_name')

  if (!tenants) return []

  const metrics = await Promise.all(
    tenants.map(async (tenant) => {
      const { count: userCount } = await shared
        .schema('shared')
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)

      const { count: documentCount } = await supabase
        .schema('docs')
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)

      const storageBytes = await getTenantStorage(supabase, tenant.id)
      const storageMB    = storageBytes / (1024 * 1024)
      const storageGB    = storageMB / 1024

      const { count: emailSends } = await supabase
        .schema('docs')
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)
        .eq('action', 'email_sent')

      const { data: lastDoc } = await supabase
        .schema('docs')
        .from('documents')
        .select('updated_at')
        .eq('tenant_id', tenant.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const emailCost  = (emailSends || 0) * 0.001
      const storageCost = storageGB * 0.023

      return {
        tenant_id:           tenant.id,
        company_name:        tenant.company_name,
        subdomain:           tenant.subdomain,
        user_count:          userCount || 0,
        document_count:      documentCount || 0,
        storage_bytes:       storageBytes,
        storage_mb:          storageMB,
        storage_gb:          storageGB,
        email_sends:         emailSends || 0,
        total_cost_estimate: emailCost + storageCost,
        created_at:          tenant.created_at,
        last_activity:       lastDoc?.updated_at || null,
      }
    })
  )

  return metrics
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const { supabase } = await checkMasterAdmin()
  const platform     = createPlatformClient()
  const shared       = createSharedClient()

  const { count: totalTenants } = await platform
    .schema('platform')
    .from('tenants')
    .select('id', { count: 'exact', head: true })

  const { count: totalUsers } = await shared
    .schema('shared')
    .from('users')
    .select('id', { count: 'exact', head: true })

  const { count: totalDocuments } = await supabase
    .schema('docs')
    .from('documents')
    .select('id', { count: 'exact', head: true })

  const { data: allFiles } = await supabase
    .schema('docs')
    .from('document_files')
    .select('file_size')

  const totalStorageBytes = (allFiles || []).reduce((s: number, f: any) => s + (f.file_size || 0), 0)
  const totalStorageGB    = totalStorageBytes / (1024 * 1024 * 1024)

  const { count: totalEmailSends } = await supabase
    .schema('docs')
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'email_sent')

  return {
    total_tenants:        totalTenants || 0,
    total_users:          totalUsers || 0,
    total_documents:      totalDocuments || 0,
    total_storage_gb:     totalStorageGB,
    total_email_sends:    totalEmailSends || 0,
    total_estimated_cost: (totalEmailSends || 0) * 0.001 + totalStorageGB * 0.023,
  }
}

export async function getTenantDetails(tenantId: string): Promise<{
  tenant: any; users: any[]; recentDocs: any[]; apiUsage: any[]; billing: any; invoices: any[]
}> {
  const { supabase } = await checkMasterAdmin()
  const platform     = createPlatformClient()
  const shared       = createSharedClient()

  const { data: tenant } = await platform
    .schema('platform')
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .single()

  if (!tenant) throw new Error('Tenant not found')

  const { data: users } = await shared
    .schema('shared')
    .from('users')
    .select('id, full_name, email, is_master_admin, is_active, created_at, last_sign_in_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  const { data: recentDocs } = await supabase
    .schema('docs')
    .from('documents')
    .select('id, document_number, version, title, status, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(10)

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const { data: apiUsage } = await supabase
    .schema('docs')
    .from('api_usage')
    .select('api_type, created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', thirtyDaysAgo.toISOString())
    .order('created_at')

  const { data: billing } = await platform
    .schema('platform')
    .from('product_subscriptions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('product', 'baselinedocs')
    .single()

  const { data: invoices } = await platform
    .schema('platform')
    .from('invoices')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('invoice_date', { ascending: false })
    .limit(20)

  return {
    tenant,
    users:      users || [],
    recentDocs: recentDocs || [],
    apiUsage:   apiUsage || [],
    billing:    billing || null,
    invoices:   invoices || [],
  }
}

export async function updateTenantBilling(data: {
  tenantId: string
  plan: string
  nextBillingDate: string | null
  reason: string
}) {
  const { user } = await checkMasterAdmin()
  const platform  = createPlatformClient()

  const validPlans = ['trial', 'starter', 'professional', 'enterprise']
  if (!validPlans.includes(data.plan)) return { success: false, error: 'Invalid plan' }

  const { data: currentSub } = await platform
    .schema('platform')
    .from('product_subscriptions')
    .select('plan, current_period_end')
    .eq('tenant_id', data.tenantId)
    .eq('product', 'baselinedocs')
    .single()

  const updatePayload: any = { plan: data.plan, updated_at: new Date().toISOString() }
  if (data.nextBillingDate) updatePayload.current_period_end = new Date(data.nextBillingDate).toISOString()

  const { error } = await platform
    .schema('platform')
    .from('product_subscriptions')
    .update(updatePayload)
    .eq('tenant_id', data.tenantId)
    .eq('product', 'baselinedocs')

  if (error) return { success: false, error: 'Failed to update billing' }

  await platform
    .schema('platform')
    .from('billing_history')
    .insert({
      tenant_id:             data.tenantId,
      action:                'manual_adjustment',
      previous_plan:         currentSub?.plan || null,
      new_plan:              data.plan,
      reason:                data.reason,
      performed_by:          user.id,
      performed_by_email:    user.email,
    })

  return {
    success: true,
    message: `Billing updated: ${data.plan} plan${data.nextBillingDate ? `, next bill: ${new Date(data.nextBillingDate).toLocaleDateString()}` : ''}`,
  }
}
