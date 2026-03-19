import { createClient, createServiceRoleClient , createSharedClient} from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { redirect } from 'next/navigation'
import BillingPageClient from './BillingPageClient'
import { syncInvoicesFromStripe } from './sync-invoices'
import { getSubdomainTenantId } from '@/lib/tenant'


export default async function BillingPage() {
  const supabase = await createClient()
  

  // Check authentication
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect('/')
  }

  // Get subdomain tenant ID
  const tenantId = await getSubdomainTenantId()


  // Get tenant ID from subdomain
  const { data: tenantData } = await createPlatformClient()
      .schema('platform')
      .from('tenants')
      .select('id, company_name, subdomain, created_at, stripe_customer_id')
      .eq('id', tenantId)
      .single()

  if (!tenantData) {
    redirect('/dashboard')
  }

  // Check admin status
  const sharedClient = createSharedClient()
    const { data: _su } = await sharedClient
      .schema('shared').from('users')
      .select('is_master_admin, tenant_id')
      .eq('id', user.id).single()
    let _isAdmin = _su?.is_master_admin ?? false
    if (_su && !_su.is_master_admin) {
      const { data: rr } = await supabase.schema('docs').from('user_roles')
        .select('role').eq('user_id', user.id).eq('tenant_id', _su.tenant_id).single()
      _isAdmin = ['tenant_admin','master_admin'].includes(rr?.role ?? '')
    }
    const userData = { is_admin: _isAdmin }

  if (!userData?.is_admin) {
    redirect('/dashboard')
  }

  // Get billing information
  const { data: billing } = await createPlatformClient()
      .schema('platform')
      .from('product_subscriptions')
      .select('plan, status, billing_cycle, stripe_subscription_id, stripe_price_id, user_limit, document_limit, storage_limit_gb, current_period_end, trial_ends_at, payment_method_type, payment_method_last4, payment_method_brand')
      .eq('tenant_id', tenantData.id)
      .eq('product', 'baselinedocs')
      .single()

  // Get invoices - sync from Stripe first to backfill any missing
  let invoices = []
  if (tenantData?.stripe_customer_id) {
    invoices = await syncInvoicesFromStripe(tenantData.id, tenantData.stripe_customer_id)
  } else {
    // Fallback to database only if no Stripe customer
    const { data: dbInvoices } = await createPlatformClient()
        .schema('platform')
        .from('invoices')
      .select('*')
      .eq('tenant_id', tenantData.id)
      .order('invoice_date', { ascending: false })
      .limit(12)
    invoices = dbInvoices || []
  }

  // Get usage stats (last 30 days)
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  // ⭐ FIX 1: Use service role client to bypass RLS for api_usage
  const supabaseAdmin = createServiceRoleClient()

  const { data: apiUsage } = await supabaseAdmin
    .from('api_usage')
    .select('api_type, created_at')
    .eq('tenant_id', tenantData.id)
    .gte('created_at', thirtyDaysAgo.toISOString())

  // Calculate usage
  const emailsSent = apiUsage?.filter(u => u.api_type === 'resend_email').length || 0

  // Get storage usage (use admin client to bypass RLS)
  const { data: storageData } = await supabaseAdmin
    .from('document_files')
    .select('file_size, documents!inner(tenant_id)')
    .eq('documents.tenant_id', tenantData.id)

  const totalStorage = storageData?.reduce((sum, file) => sum + (file.file_size || 0), 0) || 0
  const storageGB = (totalStorage / (1024 * 1024 * 1024)).toFixed(2)

  // Get user count (use admin client to bypass RLS)
  const { count: userCount } = await supabaseAdmin
    .schema('shared')
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantData.id)
    .neq('role', 'Deactivated')

  // Get document count
  const { count: documentCount } = await supabaseAdmin
    .schema('docs')
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantData.id)

  return (
    <div className="min-h-screen py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <BillingPageClient
          tenant={tenantData}
          billing={billing}
          invoices={invoices || []}
          usage={{
            emailsSent,
            storageGB,
            userCount: userCount || 0,
            documentCount: documentCount || 0
          }}
        />
      </div>
    </div>
  )
}
