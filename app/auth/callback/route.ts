/**
 * app/auth/callback/route.ts — BaselineDocs
 *
 * CHANGED:
 *  - Tenant lookup uses createPlatformClient() with .schema('platform')
 *  - User lookup uses createSharedClient() with .schema('shared')
 *    NOTE: .schema() must be chained on every query — the db.schema
 *    constructor option is silently ignored by the base supabase-js client.
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
    return NextResponse.redirect(`${origin}/`)
  }

  const cookieStore = await cookies()
  const supabase    = await createClient()

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
  if (exchangeError) {
    console.error('[Auth Callback] Exchange error:', exchangeError)
    return NextResponse.redirect(`${origin}/auth/error`)
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${origin}/`)
  }

  const oauthOriginCookie = cookieStore.get('oauth_origin_subdomain')
  let subdomain = oauthOriginCookie?.value
  if (!subdomain) subdomain = cookieStore.get('tenant_subdomain')?.value
  if (!subdomain) subdomain = 'app'

  console.log('[Auth Callback] User:', user.email, 'subdomain:', subdomain)

  // Tenant lookup — platform DB with explicit .schema('platform')
  const platform = createPlatformClient()
  const { data: tenant, error: tenantError } = await platform
    .schema('platform')
    .from('tenants')
    .select('id, company_name, subdomain')
    .eq('subdomain', subdomain)
    .eq('is_active', true)
    .single()

  if (tenantError || !tenant) {
    console.log('[Auth Callback] Tenant not found for subdomain:', subdomain)
    if (oauthOriginCookie) cookieStore.delete('oauth_origin_subdomain')
    return NextResponse.redirect(`${origin}/auth/error?message=tenant_not_found`)
  }

  // User lookup — shared schema with explicit .schema('shared')
  const sharedClient = createSharedClient()
  const { data: userRecord, error: userError } = await sharedClient
    .schema('shared')
    .from('users')
    .select('tenant_id, is_master_admin, full_name')
    .eq('id', user.id)
    .maybeSingle()

  if (!userRecord && (!userError || userError.code === 'PGRST116')) {
    console.log('[Auth Callback] User not in shared.users — access denied:', user.email)
    await supabase.auth.signOut()
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

  // Backfill full_name from OAuth metadata if missing
  if (!userRecord.full_name) {
    const fullName = user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split('@')[0] || 'User'
    await sharedClient
      .schema('shared')
      .from('users')
      .update({ full_name: fullName })
      .eq('id', user.id)
  }

  if (oauthOriginCookie) cookieStore.delete('oauth_origin_subdomain')

  if (userRecord.is_master_admin) {
    console.log('[Auth Callback] Master admin — redirecting')
    return NextResponse.redirect(`https://${subdomain}.${DASHBOARD_DOMAIN}/dashboard`)
  }

  if (userRecord.tenant_id !== tenant.id) {
    console.error('[Auth Callback] Tenant mismatch')
    return NextResponse.redirect(`${origin}/auth/error?message=tenant_mismatch`)
  }

  return NextResponse.redirect(`https://${subdomain}.${DASHBOARD_DOMAIN}/dashboard`)
}
