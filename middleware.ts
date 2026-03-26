/**
 * middleware.ts — BaselineDocs
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient, createSharedClient } from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'

const COOKIE_DOMAIN  = '.baselinedocs.com'
const APP_DOMAIN     = 'baselinedocs.com'
const PRODUCT_SCHEMA = 'docs'
const PRODUCT        = 'baselinedocs'

function extractSubdomain(hostname: string): string {
  const host      = hostname.split(':')[0]
  if (host === 'localhost' || host === '127.0.0.1') return 'app'
  const cleanHost = host.replace(/^www\./, '')
  const parts     = cleanHost.split('.')
  if (parts.length >= 3) return parts[0]
  return 'app'
}

function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/help') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/trial-expired')
  )
}

export async function middleware(request: NextRequest) {
  const hostname  = request.headers.get('host') || ''
  const pathname  = request.nextUrl.pathname
  const subdomain = extractSubdomain(hostname)

  console.log('[Middleware] hostname:', hostname, 'subdomain:', subdomain, 'path:', pathname)

  const response = NextResponse.next()

  if (subdomain) {
    response.cookies.set('tenant_subdomain', subdomain, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge:   60 * 60 * 24 * 7,
      path:     '/',
      domain:   COOKIE_DOMAIN,
    })
  }

  if (isPublicPath(pathname)) {
    return response
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const loginUrl = new URL('/', request.url)
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  const sharedClient = createSharedClient()
  const { data: userData, error: userError } = await sharedClient
    .schema('shared')
    .from('users')
    .select('tenant_id, is_master_admin, is_active')
    .eq('id', user.id)
    .single()

  if (!userData || userError) {
    console.log('[Middleware] User not found in shared.users:', user.email, userError?.message)
    const redirectUrl = new URL('/auth/error', request.url)
    redirectUrl.searchParams.set('message', 'Account setup incomplete. Please contact support.')
    return NextResponse.redirect(redirectUrl)
  }

  if (!userData.is_active) {
    const redirectUrl = new URL('/auth/error', request.url)
    redirectUrl.searchParams.set('message', 'Your account has been deactivated.')
    return NextResponse.redirect(redirectUrl)
  }

  if (!userData.tenant_id) {
    const redirectUrl = new URL('/auth/error', request.url)
    redirectUrl.searchParams.set('message', 'No organisation assigned. Please contact support.')
    return NextResponse.redirect(redirectUrl)
  }

  // Master admins bypass all product-level checks
  if (userData.is_master_admin) {
    console.log('[Middleware] Master admin — access granted')
    return response
  }

  // Resolve user's home tenant subdomain from the platform DB
  const platform = createPlatformClient()
  const { data: tenant } = await platform
    .schema('platform')
    .from('tenants')
    .select('subdomain')
    .eq('id', userData.tenant_id)
    .single()

  const userTenantSubdomain = tenant?.subdomain

  if (!userTenantSubdomain) {
    console.log('[Middleware] Tenant not found in platform for user:', user.email)
    const redirectUrl = new URL('/auth/error', request.url)
    redirectUrl.searchParams.set('message', 'Organisation not found. Please contact support.')
    return NextResponse.redirect(redirectUrl)
  }

  if (userTenantSubdomain !== subdomain) {
    const redirectUrl = new URL('/auth/error', request.url)
    redirectUrl.searchParams.set('message', `You belong to ${userTenantSubdomain}.${APP_DOMAIN}`)
    return NextResponse.redirect(redirectUrl)
  }

  console.log('[Middleware] Tenant match — access granted')

  // ── Subscription check ───────────────────────────────────────────────────────
  // Verify tenant has an active/trialing subscription for this product.
  // Also enforces trial expiry — expired trials redirect to /trial-expired.
  // Billing and auth paths remain accessible so the tenant can subscribe.
  const { data: subscription } = await platform
    .schema('platform')
    .from('product_subscriptions')
    .select('status, trial_ends_at')
    .eq('tenant_id', userData.tenant_id)
    .eq('product', PRODUCT)
    .single()

  const activeStatuses = ['active', 'trialing', 'past_due']
  if (!subscription || !activeStatuses.includes(subscription.status)) {
    console.log('[Middleware] No active subscription for:', PRODUCT, userTenantSubdomain)
    const redirectUrl = new URL('/auth/error', request.url)
    redirectUrl.searchParams.set('message', 'Your subscription is inactive. Please contact support.')
    return NextResponse.redirect(redirectUrl)
  }

  // Trial expiry — allow /admin/billing so they can upgrade
  if (['trialing', 'trial'].includes(subscription.status) && subscription.trial_ends_at) {
    const expired    = new Date(subscription.trial_ends_at) < new Date()
    const billingOk  = pathname.startsWith('/admin/billing')
    if (expired && !billingOk) {
      console.log('[Middleware] Trial expired for:', userTenantSubdomain)
      return NextResponse.redirect(new URL('/trial-expired', request.url))
    }
  }
  // ── End subscription check ───────────────────────────────────────────────────

  // Route guards
  if (pathname.startsWith('/system-admin')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  if (pathname.startsWith('/admin')) {
    const { data: roleRow } = await supabase
      .schema(PRODUCT_SCHEMA)
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('tenant_id', userData.tenant_id)
      .single()

    if (!['tenant_admin', 'master_admin'].includes(roleRow?.role ?? '')) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
