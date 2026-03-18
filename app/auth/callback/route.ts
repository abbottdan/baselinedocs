/**
 * app/auth/callback/route.ts — BaselineDocs
 *
 * CHANGED:
 *  - Tenant lookup now uses createPlatformClient() (platform.tenants)
 *  - User lookup now uses createSharedClient() (shared.users)
 */

import { createClient, createSharedClient } from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

const DASHBOARD_DOMAIN = 'baselinedocs.com'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code       = requestUrl.searchParams.get('code')
  const origin     = requestUrl.origin

  console.log('[Auth Callback] START — origin:', origin, 'has code:', !!code)

  if (!code) {
    console.log('[Auth Callback] No code — redirecting to home')
    return NextResponse.redirect(`${origin}/`)
  }

  const cookieStore = await cookies()
  const supabase    = await createClient()

  // Exchange the OAuth code for a session
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
  if (exchangeError) {
    console.error('[Auth Callback] Exchange error:', exchangeError)
    return NextResponse.redirect(`${origin}/auth/error`)
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    console.error('[Auth Callback] No user after exchange')
    return NextResponse.redirect(`${origin}/`)
  }

  console.log('[Auth Callback] User:', user.email)

  // Resolve subdomain — OAuth flows use oauth_origin_subdomain cookie set by
  // the sign-in button; email/password flows use the middleware tenant_subdomain cookie.
  const oauthOriginCookie = cookieStore.get('oauth_origin_subdomain')
  let subdomain = oauthOriginCookie?.value

  if (!subdomain) {
    subdomain = cookieStore.get('tenant_subdomain')?.value
    console.log('[Auth Callback] Fallback to tenant cookie:', subdomain)
  }
  if (!subdomain) {
    subdomain = 'app'
    console.log('[Auth Callback] Defaulting subdomain to: app')
  }

  console.log('[Auth Callback] Final subdomain:', subdomain)

  // ── Tenant lookup — CHANGED to platform DB ────────────────────────────────
  const platform = createPlatformClient()
  const { data: tenant, error: tenantError } = await platform
    .from('tenants')
    .select('id, company_name, subdomain')
    .eq('subdomain', subdomain)
    .eq('is_active', true)
    .single()

  if (tenantError || !tenant) {
    console.log('[Auth Callback] Tenant not found in platform for subdomain:', subdomain)
    if (oauthOriginCookie) cookieStore.delete('oauth_origin_subdomain')
    return NextResponse.redirect(`${origin}/auth/error?message=tenant_not_found`)
  }

  console.log('[Auth Callback] Found tenant:', tenant.company_name)

  // ── User lookup — CHANGED to shared.users ─────────────────────────────────
  const sharedClient = createSharedClient()
  const { data: userRecord, error: userError } = await sharedClient
    .from('users')
    .select('tenant_id, is_master_admin, full_name')
    .eq('id', user.id)
    .maybeSingle()

  // User not in shared.users — access is invite-only
  if (!userRecord && (!userError || userError.code === 'PGRST116')) {
    console.log('[Auth Callback] 🚨 User not in shared.users — access denied:', user.email)
    await sharedClient.auth.admin.signOut(user.id, 'global').catch(() => {})
    if (oauthOriginCookie) cookieStore.delete('oauth_origin_subdomain')
    return NextResponse.redirect(
      `${origin}/auth/error?message=You+are+not+authorised+to+access+this+organisation.+Please+contact+your+administrator.`
    )
  }

  if (userError) {
    console.error('[Auth Callback] User lookup error:', userError)
    if (oauthOriginCookie) cookieStore.delete('oauth_origin_subdomain')
    return NextResponse.redirect(`${origin}/auth/error?message=user_lookup_failed`)
  }

  if (!userRecord) {
    if (oauthOriginCookie) cookieStore.delete('oauth_origin_subdomain')
    return NextResponse.redirect(`${origin}/auth/error?message=user_record_null`)
  }

  console.log('[Auth Callback] User record: tenant_id=%s is_master_admin=%s',
    userRecord.tenant_id, userRecord.is_master_admin)

  // Backfill full_name from OAuth metadata if missing
  const fullName = userRecord.full_name ||
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split('@')[0] ||
    'User'

  if (!userRecord.full_name) {
    await sharedClient
      .from('users')
      .update({ full_name: fullName })
      .eq('id', user.id)
    console.log('[Auth Callback] Backfilled full_name:', fullName)
  }

  if (oauthOriginCookie) cookieStore.delete('oauth_origin_subdomain')

  // Master admins can access any tenant
  if (userRecord.is_master_admin) {
    console.log('[Auth Callback] Master admin — access granted')
    const redirectUrl = `https://${subdomain}.${DASHBOARD_DOMAIN}/dashboard`
    return NextResponse.redirect(redirectUrl)
  }

  // Regular users must belong to this tenant
  if (userRecord.tenant_id !== tenant.id) {
    console.error('[Auth Callback] Tenant mismatch — user tenant:', userRecord.tenant_id, 'requested:', tenant.id)
    return NextResponse.redirect(`${origin}/auth/error?message=tenant_mismatch`)
  }

  const redirectUrl = `https://${subdomain}.${DASHBOARD_DOMAIN}/dashboard`
  console.log('[Auth Callback] Redirecting to:', redirectUrl)
  return NextResponse.redirect(redirectUrl)
}
