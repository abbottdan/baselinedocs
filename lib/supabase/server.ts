/**
 * lib/supabase/server.ts — BaselineDocs
 *
 * Products Supabase client — connects to clearstride_products (Project 2),
 * scoped to the 'docs' Postgres schema.
 *
 * Two clients are exported:
 *   createClient()            — session-aware, cookie-forwarding (use in server actions + pages)
 *   createServiceRoleClient() — bypasses RLS (use in admin actions, webhooks, auth callbacks)
 *
 * For the platform DB (billing, tenants, subdomain checks) use:
 *   import { createPlatformClient } from '@/lib/supabase/platform'
 *
 * Required environment variables:
 *   NEXT_PUBLIC_SUPABASE_URL     — clearstride_products Supabase URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY — clearstride_products anon key
 *   SUPABASE_SERVICE_ROLE_KEY    — clearstride_products service role key
 */

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createSupabaseClient }    from '@supabase/supabase-js'
import { cookies }                                  from 'next/headers'

// ─── Session-aware client ────────────────────────────────────────────────────
// Use this for all normal server actions and page data fetching.
// Forwards the user's session cookie so Supabase auth.getUser() works correctly.
// Scoped to the 'docs' schema — all .from() calls resolve to docs.* tables.

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: 'docs' },
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({
              name,
              value,
              ...options,
              domain:   '.baselinedocs.com',
              secure:   process.env.NODE_ENV === 'production',
              sameSite: 'lax',
            })
          } catch {
            // Called from a Server Component — safe to ignore.
            // Middleware handles session refresh.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({
              name,
              value:  '',
              ...options,
              domain: '.baselinedocs.com',
            })
          } catch {
            // Called from a Server Component — safe to ignore.
          }
        },
      },
    }
  )
}

// ─── Service-role client ──────────────────────────────────────────────────────
// Bypasses RLS. Use ONLY in trusted server contexts:
//   - Admin server actions (user management, system-admin pages)
//   - Auth callbacks (app/auth/callback/route.ts)
//   - Stripe webhook handler
//   - Inngest background functions
//
// Also scoped to the 'docs' schema.

export function createServiceRoleClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. ' +
      'Add it to .env.local and your hosting environment.'
    )
  }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      db: { schema: 'docs' },
      auth: {
        autoRefreshToken: false,
        persistSession:   false,
      },
    }
  )
}

// ─── shared.users client ──────────────────────────────────────────────────────
// Convenience service-role client scoped to the 'shared' schema.
// Use when querying shared.users directly (e.g. checking is_master_admin,
// looking up user records during auth callback, user management actions).

export function createSharedClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.')
  }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      db: { schema: 'shared' },
      auth: {
        autoRefreshToken: false,
        persistSession:   false,
      },
    }
  )
}

// ─── Backwards-compat alias ───────────────────────────────────────────────────
// Remove once all callers are updated to createServiceRoleClient().
export const createServiceClient = createServiceRoleClient
