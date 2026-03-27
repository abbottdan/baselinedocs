// @ts-nocheck
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { redirect } from 'next/navigation'
import { getCurrentUser, isTenantAdmin, getSubdomainTenantId } from '@/lib/tenant'
import BillingManagementPanel from '@/components/admin/BillingManagementPanel'
import type { Plan, Product } from '@/app/actions/billing'

export const metadata = { title: 'Billing' }

// Map any legacy DB plan value to a valid Plan slug
function normalizePlan(raw: string | null | undefined): Plan {
  if (!raw) return 'trial'
  if (raw === 'pro' || raw === 'professional') return 'pro'
  if (raw === 'starter') return 'starter'
  if (raw === 'trial' || raw === 'trialing') return 'trial'
  // Anything else (e.g. 'enterprise', 'active') — fall back to trial
  return 'trial'
}

export default async function DocsBillingPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/auth/login')
  if (!await isTenantAdmin()) redirect('/dashboard')

  const tenantId = await getSubdomainTenantId()
  if (!tenantId) redirect('/dashboard')

  const platform      = createPlatformClient()
  const supabaseAdmin = createServiceRoleClient()

  const { data: sub } = await platform.schema('platform').from('product_subscriptions')
    .select('plan, status, user_limit, storage_limit_gb, current_period_end, trial_ends_at, payment_method_last4, payment_method_brand, stripe_subscription_id')
    .eq('tenant_id', tenantId).eq('product', 'baselinedocs').single()

  // Suite context
  const { data: allSubs } = await platform.schema('platform').from('product_subscriptions')
    .select('product, plan').eq('tenant_id', tenantId).in('status', ['active', 'trialing'])
  const otherTools = (allSubs ?? []).filter(s => s.product !== 'baselinedocs') as { product: Product; plan: Plan }[]

  const { count: activeUserCount } = await supabaseAdmin.schema('shared').from('users')
    .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_active', true)

  // Invoice history from platform.invoices (populated by Stripe webhook)
  const { data: invoices } = await platform.schema('platform').from('invoices')
    .select('stripe_invoice_id, amount_paid, currency, status, invoice_pdf, period_start, period_end, created_at')
    .eq('tenant_id', tenantId)
    .eq('product', 'baselinedocs')
    .order('created_at', { ascending: false })
    .limit(12)

  const currentPlan = normalizePlan(sub?.plan)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-800">Billing &amp; Plan</h2>
        <p className="text-sm text-slate-500 mt-0.5">Manage your subscription, seats, and storage</p>
      </div>
      <BillingManagementPanel
        tenantId={tenantId}
        product="baselinedocs"
        currentPlan={currentPlan}
        status={sub?.status ?? 'trialing'}
        currentPeriodEnd={sub?.current_period_end ?? null}
        trialEndsAt={sub?.trial_ends_at ?? null}
        userLimit={sub?.user_limit ?? 2}
        activeUserCount={activeUserCount ?? 0}
        storageLimitGb={sub?.storage_limit_gb ?? 1}
        paymentMethodBrand={sub?.payment_method_brand ?? null}
        paymentMethodLast4={sub?.payment_method_last4 ?? null}
        activeToolCount={(allSubs ?? []).length}
        otherTools={otherTools}
        invoices={invoices ?? []}
      />
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════════