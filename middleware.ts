/**
 * middleware.ts — BaselineDocs
 *
 * CHANGED:
 *  - Tenant lookup (.from('tenants')) now uses createPlatformClient()
 *    because platform.tenants is the source of truth — there is no
 *    tenants table in the product DB.
 *  - User lookup (.from('users')) now targets shared.users via
 *    createSharedClient() (service-role, scoped to the shared schema).
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient, createSharedClient } from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'

const COOKIE_DOMAIN = '.baselinedocs.com'
const APP_DOMAIN    = 'baselinedocs.com'

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
    pathname.startsWith('/_next')
  )
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  const pathname = request.nextUrl.pathname
  const subdomain = extractSubdomain(hostname)

  console.log('[Middleware] hostname:', hostname, '→ subdomain:', subdomain, 'path:', pathname)

  const response = NextResponse.next()

  // Always stamp the subdomain cookie so the login page and auth callback
  // know which tenant context they're operating in.
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

  // Public paths pass through without auth checks.
  if (isPublicPath(pathname)) {
    return response
  }

  // ── Authenticated route checks ────────────────────────────────────────────

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Look up user in shared.users (product DB, shared schema)
  const sharedClient = createSharedClient()
  const { data: userData, error: userError } = await sharedClient
    .from('users')
    .select('tenant_id, is_master_admin, is_active, role')
    .eq('id', user.id)
    .single()

  if (!userData || userError) {
    console.log('[Middleware] 🚨 User not found in shared.users:', user.email)
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

  // Master admins bypass subdomain verification — they can visit any tenant.
  if (userData.is_master_admin) {
    console.log('[Middleware] ✅ Master admin — access granted')

    if (pathname.startsWith('/system-admin')) {
      // allowed
    } else if (pathname.startsWith('/admin')) {
      // allowed
    }

    return response
  }

  // Look up the user's home tenant subdomain from the platform DB.
  // CHANGED: was supabase.from('tenants') on the product DB.
  const platform = createPlatformClient()
  const { data: tenant } = await platform
    .from('tenants')
    .select('subdomain')
    .eq('id', userData.tenant_id)
    .single()

  const userTenantSubdomain = tenant?.subdomain

  if (!userTenantSubdomain) {
    console.log('[Middleware] 🚨 Tenant not found in platform for user:', user.email)
    const redirectUrl = new URL('/auth/error', request.url)
    redirectUrl.searchParams.set('message', 'Organisation not found. Please contact support.')
    return NextResponse.redirect(redirectUrl)
  }

  if (userTenantSubdomain !== subdomain) {
    console.log('[Middleware] 🚨 TENANT MISMATCH — belongs to:', userTenantSubdomain, 'accessing:', subdomain)
    const redirectUrl = new URL('/auth/error', request.url)
    redirectUrl.searchParams.set('message', `You belong to ${userTenantSubdomain}.${APP_DOMAIN}`)
    return NextResponse.redirect(redirectUrl)
  }

  console.log('[Middleware] ✅ Tenant match — access granted')

  // Route guards
  if (pathname.startsWith('/system-admin')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  if (pathname.startsWith('/admin')) {
    if (!['tenant_admin', 'master_admin'].includes(userData.role ?? '')) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
