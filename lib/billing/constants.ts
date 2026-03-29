/**
 * lib/billing/constants.ts — ClearStride Billing Constants
 *
 * Pure constants and sync helpers only.
 * This file MUST NOT use 'use server' — it is imported by both server actions
 * and client components. Non-async exports cannot live in 'use server' files.
 */

export type Plan    = 'trial' | 'starter' | 'pro'
export type Product = 'baselinedocs' | 'baselinereqs' | 'baselineinventory'

// ─── Plan pricing (display only — actual charges via Stripe) ─────────────────

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

// ─── Included limits per plan ─────────────────────────────────────────────────

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
export const STORAGE_PRICE_PER_BLOCK = 5

// ─── Suite / custom thresholds ────────────────────────────────────────────────

export const CUSTOM_CONTRACT_SEAT_THRESHOLD = 200

export const BUNDLE_DISCOUNTS = { second: 0.15, third: 0.20 }

export const PLAN_ORDER: Plan[] = ['trial', 'starter', 'pro']

// ─── Per-product feature limits ───────────────────────────────────────────────

export function getPlanLimits(plan: Plan, product: Product) {
  const users = PLAN_INCLUDED_USERS[plan]
  if (product === 'baselinedocs') return {
    users,
    documents:  plan === 'trial' ? 25  : plan === 'starter' ? 100  : 1000,
    storageGb:  PLAN_INCLUDED_STORAGE_GB[plan],
  }
  if (product === 'baselinereqs') return {
    users,
    projects:        plan === 'trial' ? 1  : plan === 'starter' ? 3   : 20,
    reqsPerProject:  plan === 'trial' ? 25 : plan === 'starter' ? 150 : 1000,
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
  return {
    trial:   [...base.trial,   '25 items', '2 BOMs/Builds'],
    starter: [...base.starter, '250 items', '10 BOMs/Builds', 'Barcode scanning'],
    pro:     [...base.pro,     '5,000 items', '25 BOMs/Builds', 'Multi-location', 'Lot/serial tracking'],
  }
}
