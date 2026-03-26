'use client'

/**
 * components/admin/BillingManagementPanel.tsx — SAME FILE IN ALL THREE PRODUCTS
 *
 * Pricing per clearstride_pricing_summary_v2:
 *   Plans: Trial | Starter ($49) | Pro ($89)
 *   Seats: Starter=$5/seat, Pro=$7/seat (above included)
 *   Storage: Docs only, $5/10GB block (above included)
 *   Suite: multi-tool tenants see suite upgrade option
 *   Custom: 200+ seats → contact sales, no stepper
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  changePlan, upgradeSuite, adjustSeats, adjustStorage, getPlanFeatures,
  PLAN_PRICES, PLAN_NAMES, PLAN_INCLUDED_USERS, SEAT_ADDON_PRICE,
  PLAN_INCLUDED_STORAGE_GB, STORAGE_BLOCK_GB, STORAGE_PRICE_PER_BLOCK,
  CUSTOM_CONTRACT_SEAT_THRESHOLD,
  type Plan, type Product,
} from '@/app/actions/billing'

export interface BillingManagementPanelProps {
  tenantId:            string
  product:             Product
  currentPlan:         Plan
  status:              string
  currentPeriodEnd:    string | null
  trialEndsAt:         string | null
  userLimit:           number
  activeUserCount:     number
  storageLimitGb:      number | null   // null for Reqs and Inventory
  paymentMethodBrand:  string | null
  paymentMethodLast4:  string | null
  // Suite context
  activeToolCount:     number
  otherTools:          { product: Product; plan: Plan }[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLAN_ORDER: Plan[] = ['trial', 'starter', 'pro']

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function daysUntil(d: string | null): number | null {
  if (!d) return null
  return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function StatusBadge({ status, trialEndsAt }: { status: string; trialEndsAt: string | null }) {
  const days = trialEndsAt ? daysUntil(trialEndsAt) : null
  if ((status === 'trialing' || status === 'trial') && days !== null) {
    const urgent = days <= 7
    return (
      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${urgent ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
        {days > 0 ? `Trial — ${days}d left` : 'Trial expired'}
      </span>
    )
  }
  const map: Record<string, { bg: string; text: string; label: string }> = {
    active:    { bg: 'bg-green-100', text: 'text-green-800', label: 'Active' },
    past_due:  { bg: 'bg-red-100',   text: 'text-red-800',   label: 'Past Due' },
    cancelled: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Cancelled' },
  }
  const s = map[status] ?? { bg: 'bg-slate-100', text: 'text-slate-600', label: status }
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${s.bg} ${s.text}`}>{s.label}</span>
}

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6">
      <div className="mb-4">
        <h3 className="font-semibold text-slate-800">{title}</h3>
        {description && <p className="text-sm text-slate-500 mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  )
}

// ─── Trial expiry banner ──────────────────────────────────────────────────────

function TrialBanner({ trialEndsAt }: { trialEndsAt: string }) {
  const days = daysUntil(trialEndsAt) ?? 0
  if (days > 14) return null
  const expired = days <= 0
  return (
    <div className={`rounded-lg px-5 py-4 flex items-start gap-3 ${expired ? 'bg-red-50 border border-red-300' : 'bg-amber-50 border border-amber-300'}`}>
      <span className={`text-xl ${expired ? 'text-red-500' : 'text-amber-500'}`}>{expired ? '⛔' : '⚠️'}</span>
      <div>
        <p className={`font-semibold text-sm ${expired ? 'text-red-900' : 'text-amber-900'}`}>
          {expired ? 'Your trial has ended — access is now restricted' : `Trial ends in ${days} day${days !== 1 ? 's' : ''}`}
        </p>
        <p className="text-sm text-slate-600 mt-0.5">
          {expired
            ? 'Choose a paid plan below to restore full access.'
            : `Upgrade to Starter or Pro before ${formatDate(trialEndsAt)} to avoid interruption.`}
        </p>
      </div>
    </div>
  )
}

// ─── Plan section ─────────────────────────────────────────────────────────────

function PlanSection({
  product, currentPlan, status, currentPeriodEnd, trialEndsAt,
  activeToolCount, otherTools,
}: Pick<BillingManagementPanelProps, 'product' | 'currentPlan' | 'status' | 'currentPeriodEnd' | 'trialEndsAt' | 'activeToolCount' | 'otherTools'>) {
  const router                            = useRouter()
  const [isPending, start]                = useTransition()
  const [showPlans, setShowPlans]         = useState(currentPlan === 'trial')
  const [selectedPlan, setSelectedPlan]   = useState<Plan | null>(null)
  const [showWarn, setShowWarn]           = useState(false)
  const [suiteMode, setSuiteMode]         = useState(false)

  const currentIdx = PLAN_ORDER.indexOf(currentPlan)
  const features   = getPlanFeatures(product)

  // Is this a multi-tool tenant where suite upgrade is needed?
  const multiTool        = activeToolCount > 1
  const otherAtDiffPlan  = otherTools.some(t => t.plan !== currentPlan && t.plan !== 'trial')

  function handleSelect(plan: Plan) {
    setSelectedPlan(plan)
    const isDown = PLAN_ORDER.indexOf(plan) < currentIdx
    if (isDown) { setShowWarn(true); return }
    execute(plan, true)
  }

  function execute(plan: Plan, confirmed: boolean) {
    start(async () => {
      const result = multiTool && !suiteMode
        ? await upgradeSuite(plan as 'starter' | 'pro', confirmed)
        : await changePlan(plan, confirmed)

      if (result.success) {
        if (result.checkoutUrl) { window.location.href = result.checkoutUrl; return }
        toast.success('Plan updated', { description: result.message })
        setShowPlans(false); setSelectedPlan(null); setShowWarn(false); setSuiteMode(false)
        router.refresh()
      } else {
        toast.error('Could not change plan', { description: result.error })
      }
    })
  }

  const upgradablePlans: Plan[] = (['starter', 'pro'] as Plan[]).filter(p => PLAN_ORDER.indexOf(p) !== currentIdx)

  return (
    <SectionCard title="Subscription Plan" description="Changes take effect immediately; billing change at next renewal.">
      {/* Current plan */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <span className="text-2xl font-bold text-slate-900">{PLAN_NAMES[currentPlan]}</span>
            <StatusBadge status={status} trialEndsAt={trialEndsAt} />
          </div>
          <p className="text-sm text-slate-500">${PLAN_PRICES[currentPlan]}/month</p>
          {currentPeriodEnd && currentPlan !== 'trial' && (
            <p className="text-xs text-slate-400 mt-0.5">Renews {formatDate(currentPeriodEnd)}</p>
          )}
          {multiTool && (
            <p className="text-xs text-slate-400 mt-1">
              Suite: {activeToolCount} tools active
              {activeToolCount === 2 ? ' (2nd tool 15% off)' : activeToolCount >= 3 ? ' (3rd tool 20% off)' : ''}
            </p>
          )}
        </div>
        <button onClick={() => setShowPlans(s => !s)}
          className="text-sm font-medium text-slate-600 hover:text-slate-900 underline underline-offset-2">
          {showPlans ? 'Hide plans' : currentPlan === 'trial' ? 'Choose a plan' : 'Change plan'}
        </button>
      </div>

      {multiTool && otherAtDiffPlan && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
          Suite rule: your other tools are on a different plan. Use the suite upgrade to align all tools.
        </div>
      )}

      {/* Plan grid */}
      {showPlans && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 border-t border-slate-100">
          {upgradablePlans.map(plan => {
            const isCurrent   = plan === currentPlan
            const isDown      = PLAN_ORDER.indexOf(plan) < currentIdx
            const toolPos     = activeToolCount >= 3 ? 3 : activeToolCount === 2 ? 2 : 1
            const discountPct = toolPos === 2 ? 15 : toolPos === 3 ? 20 : 0
            const displayPrice = Math.round(PLAN_PRICES[plan] * (1 - discountPct / 100))

            return (
              <div key={plan} className={`rounded-lg border p-4 flex flex-col gap-3 ${isCurrent ? 'border-slate-300 bg-slate-50' : 'border-slate-200'}`}>
                <div>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-semibold text-slate-800">{PLAN_NAMES[plan]}</span>
                    {discountPct > 0 && !isDown && (
                      <span className="text-xs text-green-700 font-medium bg-green-50 px-1.5 py-0.5 rounded">{discountPct}% bundle off</span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-xl font-bold text-slate-900">${displayPrice}</span>
                    <span className="text-xs text-slate-400">/mo</span>
                    {discountPct > 0 && !isDown && (
                      <span className="text-xs text-slate-400 line-through ml-1">${PLAN_PRICES[plan]}</span>
                    )}
                  </div>
                </div>
                <ul className="space-y-1 flex-1">
                  {(features[plan] ?? []).map(f => (
                    <li key={f} className="text-xs text-slate-600 flex items-start gap-1.5">
                      <span className="text-green-500 mt-0.5 shrink-0">✓</span>{f}
                    </li>
                  ))}
                </ul>
                {!isCurrent && (
                  <button disabled={isPending}
                    onClick={() => handleSelect(plan)}
                    className={`text-sm font-medium py-1.5 px-3 rounded border transition-colors disabled:opacity-50 ${
                      isDown ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-slate-300 hover:bg-slate-100'
                    }`}>
                    {isPending && selectedPlan === plan ? 'Updating…' : isDown ? 'Downgrade' : multiTool ? 'Upgrade Suite' : 'Upgrade'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Downgrade warning modal */}
      {showWarn && selectedPlan && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-bold text-slate-900 text-lg">
              Downgrade to {PLAN_NAMES[selectedPlan]}?
              {multiTool && <span className="text-sm font-normal text-slate-500 block mt-0.5">All {activeToolCount} tools will downgrade.</span>}
            </h3>
            <div className="bg-amber-50 border border-amber-200 rounded p-3">
              <p className="text-sm font-semibold text-amber-900 mb-2">You will lose access to:</p>
              <ul className="space-y-1">
                {(features[currentPlan] ?? [])
                  .filter(f => !(features[selectedPlan] ?? []).includes(f))
                  .map(f => (
                    <li key={f} className="text-sm text-amber-800 flex items-start gap-1.5">
                      <span className="text-red-500 mt-0.5 shrink-0">✕</span>{f}
                    </li>
                  ))}
              </ul>
            </div>
            <p className="text-sm text-slate-500">Access changes immediately. Lower billing starts at next renewal{currentPeriodEnd ? ` on ${formatDate(currentPeriodEnd)}` : ''}.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setShowWarn(false); setSelectedPlan(null) }}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900">Cancel</button>
              <button onClick={() => execute(selectedPlan, true)} disabled={isPending}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50">
                {isPending ? 'Downgrading…' : 'Confirm Downgrade'}
              </button>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  )
}

// ─── Seats section ────────────────────────────────────────────────────────────

function SeatsSection({ currentPlan, userLimit, activeUserCount }: {
  currentPlan: Plan; userLimit: number; activeUserCount: number
}) {
  const router             = useRouter()
  const [isPending, start] = useTransition()
  const [delta, setDelta]  = useState(0)

  const newLimit      = userLimit + delta
  const includedSeats = PLAN_INCLUDED_USERS[currentPlan]
  const seatPrice     = SEAT_ADDON_PRICE[currentPlan]
  const addonSeats    = Math.max(newLimit - includedSeats, 0)
  const addonCost     = addonSeats * seatPrice
  const pct           = Math.min(Math.round((activeUserCount / Math.max(newLimit, 1)) * 100), 100)
  const barColor      = pct >= 100 ? '#DC2626' : pct >= 90 ? '#D97706' : pct >= 75 ? '#D97706' : '#15803D'
  const atCustomThreshold = newLimit >= CUSTOM_CONTRACT_SEAT_THRESHOLD
  const trialPlan         = currentPlan === 'trial'

  async function handleApply() {
    if (delta === 0) return
    start(async () => {
      const result = await adjustSeats(delta)
      if (result.success) { toast.success('Seats updated', { description: result.message }); setDelta(0); router.refresh() }
      else toast.error('Could not update seats', { description: result.error })
    })
  }

  return (
    <SectionCard
      title="User Seats"
      description={trialPlan ? 'Seat add-ons available on Starter and Pro plans.' : `${includedSeats} included in ${PLAN_NAMES[currentPlan]}. Add-ons: $${seatPrice}/seat/mo. Billing change at next renewal.`}
    >
      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-sm mb-1.5">
            <span className="text-slate-600">{activeUserCount} of {userLimit} seats used</span>
            <span className="text-slate-400 text-xs">{pct}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div style={{ width: `${pct}%`, backgroundColor: barColor }} className="h-full rounded-full transition-all duration-300" />
          </div>
          {pct >= 90 && <p className="text-xs text-amber-600 mt-1">Approaching seat limit — consider adding seats.</p>}
        </div>

        {!trialPlan && (
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center border border-slate-200 rounded">
              <button onClick={() => setDelta(d => d - 1)}
                disabled={newLimit <= Math.max(activeUserCount, 1) || isPending}
                className="w-9 h-9 flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30 text-lg font-medium">−</button>
              <div className="px-4 py-2 text-center min-w-[64px]">
                <div className="text-lg font-bold text-slate-900">{newLimit}</div>
                <div className="text-xs text-slate-400">seats</div>
              </div>
              <button onClick={() => setDelta(d => d + 1)}
                disabled={isPending || atCustomThreshold}
                className="w-9 h-9 flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30 text-lg font-medium">+</button>
            </div>

            <div className="text-sm text-slate-500 flex-1">
              {delta !== 0
                ? <span className={delta > 0 ? 'text-green-700' : 'text-red-700'}>
                    {delta > 0 ? `+${delta}` : delta} seat{Math.abs(delta) > 1 ? 's' : ''}
                    {addonCost > 0 ? ` · $${addonCost}/mo add-on at next renewal` : ''}
                  </span>
                : addonCost > 0
                  ? <span>${addonCost}/mo add-on ({addonSeats} × ${seatPrice})</span>
                  : <span className="text-green-700">{includedSeats} seats included</span>
              }
            </div>

            {delta !== 0 && (
              <button onClick={handleApply} disabled={isPending || atCustomThreshold}
                className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded hover:bg-slate-700 disabled:opacity-50">
                {isPending ? 'Saving…' : 'Apply'}
              </button>
            )}
          </div>
        )}

        {atCustomThreshold && (
          <p className="text-xs text-red-700 font-medium">
            200+ seats require a custom contract.{' '}
            <a href="mailto:support@clearstridetools.com?subject=Custom%20Contract%20Enquiry" className="underline">Contact us</a>
          </p>
        )}
      </div>
    </SectionCard>
  )
}

// ─── Storage section (Docs only) ──────────────────────────────────────────────

function StorageSection({ currentPlan, storageLimitGb }: { currentPlan: Plan; storageLimitGb: number }) {
  const router             = useRouter()
  const [isPending, start] = useTransition()
  const [delta, setDelta]  = useState(0)

  const includedGB    = PLAN_INCLUDED_STORAGE_GB[currentPlan]
  const newGB         = storageLimitGb + (delta * STORAGE_BLOCK_GB)
  const addonBlocks   = Math.max(Math.floor((newGB - includedGB) / STORAGE_BLOCK_GB), 0)
  const addonCost     = addonBlocks * STORAGE_PRICE_PER_BLOCK
  const trialPlan     = currentPlan === 'trial'

  async function handleApply() {
    if (delta === 0) return
    start(async () => {
      const result = await adjustStorage(delta)
      if (result.success) { toast.success('Storage updated', { description: result.message }); setDelta(0); router.refresh() }
      else toast.error('Could not update storage', { description: result.error })
    })
  }

  return (
    <SectionCard
      title="Storage"
      description={trialPlan ? `1GB included in trial. Storage add-ons available on Starter and Pro.` : `${includedGB}GB included in ${PLAN_NAMES[currentPlan]}. Add-ons: $${STORAGE_PRICE_PER_BLOCK}/10GB block/mo. Billing change at next renewal.`}
    >
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center border border-slate-200 rounded">
          <button onClick={() => setDelta(d => d - 1)}
            disabled={newGB <= STORAGE_BLOCK_GB || isPending || trialPlan}
            className="w-9 h-9 flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30 text-lg font-medium">−</button>
          <div className="px-4 py-2 text-center min-w-[76px]">
            <div className="text-lg font-bold text-slate-900">{newGB}GB</div>
            <div className="text-xs text-slate-400">storage</div>
          </div>
          <button onClick={() => setDelta(d => d + 1)}
            disabled={isPending || trialPlan}
            className="w-9 h-9 flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30 text-lg font-medium">+</button>
        </div>

        <div className="text-sm text-slate-500 flex-1">
          {delta !== 0
            ? <span className={delta > 0 ? 'text-green-700' : 'text-red-700'}>
                {delta > 0 ? `+${delta * STORAGE_BLOCK_GB}GB` : `${delta * STORAGE_BLOCK_GB}GB`}
                {addonCost > 0 ? ` · $${addonCost}/mo at next renewal` : ''}
              </span>
            : addonCost > 0
              ? <span>${addonCost}/mo add-on ({addonBlocks} × ${STORAGE_PRICE_PER_BLOCK})</span>
              : <span className="text-green-700">{includedGB}GB included</span>
          }
        </div>

        {delta !== 0 && !trialPlan && (
          <button onClick={handleApply} disabled={isPending}
            className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded hover:bg-slate-700 disabled:opacity-50">
            {isPending ? 'Saving…' : 'Apply'}
          </button>
        )}
      </div>
    </SectionCard>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function BillingManagementPanel(props: BillingManagementPanelProps) {
  const isDocsProduct = props.product === 'baselinedocs'
  const showStorage   = isDocsProduct && props.storageLimitGb !== null
  const trialExpired  = props.trialEndsAt
    ? daysUntil(props.trialEndsAt) !== null && daysUntil(props.trialEndsAt)! <= 0
    : false

  return (
    <div className="space-y-6 max-w-3xl">
      {props.trialEndsAt && <TrialBanner trialEndsAt={props.trialEndsAt} />}

      <PlanSection
        product={props.product}
        currentPlan={props.currentPlan}
        status={props.status}
        currentPeriodEnd={props.currentPeriodEnd}
        trialEndsAt={props.trialEndsAt}
        activeToolCount={props.activeToolCount}
        otherTools={props.otherTools}
      />

      <SeatsSection
        currentPlan={props.currentPlan}
        userLimit={props.userLimit}
        activeUserCount={props.activeUserCount}
      />

      {showStorage && (
        <StorageSection
          currentPlan={props.currentPlan}
          storageLimitGb={props.storageLimitGb!}
        />
      )}

      {props.paymentMethodLast4 && (
        <SectionCard title="Payment Method">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-slate-100 rounded flex items-center justify-center text-slate-500">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <span className="text-sm text-slate-700 capitalize">{props.paymentMethodBrand} •••• {props.paymentMethodLast4}</span>
            </div>
            <a href="mailto:support@clearstridetools.com?subject=Update%20Payment%20Method"
              className="text-sm text-slate-500 underline hover:text-slate-700">Update</a>
          </div>
        </SectionCard>
      )}

      <p className="text-xs text-slate-400">
        Need 200+ seats? <a href="mailto:support@clearstridetools.com?subject=Custom%20Contract" className="underline hover:text-slate-600">Contact us for a custom contract.</a>
        {' · '}
        <a href="mailto:support@clearstridetools.com" className="underline hover:text-slate-600">General support</a>
      </p>
    </div>
  )
}
