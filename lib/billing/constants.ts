/**
 * lib/billing/constants.ts — ALL THREE PRODUCTS (identical)
 *
 * Pure constants and synchronous helpers for billing.
 * Kept separate from app/actions/billing.ts because 'use server' files
 * cannot export non-async values.
 *
 * Import from here in:
 *   - components/admin/BillingManagementPanel.tsx
 *   - Any page or component that needs plan/pricing data
 *
 * The server actions in app/actions/billing.ts also import from here.
 */

export type Plan    = 'trial' | 'starter' | 'pro'
export type Product = 'baselinedocs' | 'baselinereqs' | 'baselineinventory'

export const PLAN_ORDER: Plan[] = ['trial', 'starter', 'pro']

export const PLAN_PRICES: Record<Plan, number> = {
  trial:   0,
  starter: 49,
  pro:     89,
}

export const PLAN_NAMES: Record<Plan, string> = {
  trial:   'Trial',
  starter: 'Starter',
  pro:     'Pro',
}

// Users included in base plan price (before seat add-ons)
export const PLAN_INCLUDED_USERS: Record<Plan, number> = {
  trial:   2,
  starter: 10,
  pro:     25,
}

// Seat add-on price varies by plan
export const SEAT_ADDON_PRICE: Record<Plan, number> = {
  trial:   0,
  starter: 5,
  pro:     7,
}

// Storage included per plan (BaselineDocs only)
export const PLAN_INCLUDED_STORAGE_GB: Record<Plan, number> = {
  trial:   1,
  starter: 5,
  pro:     20,
}

export const STORAGE_BLOCK_GB        = 10
export const STORAGE_PRICE_PER_BLOCK = 5   // same for both plans

// Above this threshold: custom contract required, no self-serve
export const CUSTOM_CONTRACT_SEAT_THRESHOLD = 200

// Bundle discounts for suite pricing
export const BUNDLE_DISCOUNTS = { second: 0.15, third: 0.20 }

// ─── Synchronous helpers ──────────────────────────────────────────────────────

export type ProductLimits = {
  users:           number
  documents?:      number
  storageGb?:      number
  projects?:       number
  reqsPerProject?: number
  items?:          number
  bomsBuilds?:     number
}

export function getProductLimits(product: Product, plan: Plan): ProductLimits {
  const users = PLAN_INCLUDED_USERS[plan]
  if (product === 'baselinedocs') return {
    users,
    documents: plan === 'trial' ? 25  : plan === 'starter' ? 100  : 1000,
    storageGb: PLAN_INCLUDED_STORAGE_GB[plan],
  }
  if (product === 'baselinereqs') return {
    users,
    projects:       plan === 'trial' ? 1  : plan === 'starter' ? 3   : 20,
    reqsPerProject: plan === 'trial' ? 25 : plan === 'starter' ? 150 : 1000,
  }
  return { // baselineinventory
    users,
    items:      plan === 'trial' ? 25  : plan === 'starter' ? 250  : 5000,
    bomsBuilds: plan === 'trial' ? 2   : plan === 'starter' ? 10   : 25,
  }
}

export function getPlanFeatures(product: Product): Record<Plan, string[]> {
  const base: Record<Plan, string[]> = {
    trial:   ['2 users included', '30-day trial', 'Email support'],
    starter: ['10 users included', '$5/extra seat/mo', 'Email support'],
    pro:     ['25 users included', '$7/extra seat/mo', 'Priority support'],
  }
  if (product === 'baselinedocs') return {
    trial:   [...base.trial,   '25 documents', '1GB storage'],
    starter: [...base.starter, '100 documents', '5GB storage', 'Version control', 'Approval workflows'],
    pro:     [...base.pro,     '1,000 documents', '20GB storage', 'Document analytics', 'Custom doc types'],
  }
  if (product === 'baselinereqs') return {
    trial:   [...base.trial,   '1 project', '25 requirements/project'],
    starter: [...base.starter, '3 projects', '150 requirements/project', 'Traceability'],
    pro:     [...base.pro,     '20 projects', '1,000 requirements/project', 'Baseline snapshots', 'Custom attributes'],
  }
  return { // baselineinventory
    trial:   [...base.trial,   '25 items', '2 BOMs/Builds'],
    starter: [...base.starter, '250 items', '10 BOMs/Builds', 'Barcode scanning'],
    pro:     [...base.pro,     '5,000 items', '25 BOMs/Builds', 'Multi-location', 'Lot/serial tracking'],
  }
}
