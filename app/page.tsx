/**
 * app/page.tsx — BaselineDocs login page
 *
 * CHANGED:
 *  - Tenant name/logo lookup now uses createPlatformClient() (platform.tenants)
 *    instead of the product DB (which has no tenants table).
 *  - getTenantAuthMethod() already fixed in lib/auth/get-tenant-auth-method.ts
 */

import { createClient } from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTenantAuthMethod } from '@/lib/auth/get-tenant-auth-method'
import GoogleSignInButton from '@/components/auth/GoogleSignInButton'
import MicrosoftSignInButton from '@/components/auth/MicrosoftSignInButton'
import EmailPasswordForm from '@/components/auth/EmailPasswordForm'
import { BaselineDocsLogoLight, ClearStrideIconLight } from '@/components/dashboard/BaselineDocsLogo'
import Image from 'next/image'
import Link from 'next/link'

export default async function LandingPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    redirect('/dashboard')
  }

  const cookieStore = await cookies()
  const tenantSubdomain = cookieStore.get('tenant_subdomain')?.value

  // CHANGED: query platform.tenants instead of product DB tenants table
  let tenant = null
  if (tenantSubdomain) {
    const platform = createPlatformClient()
    const { data } = await platform
      .from('tenants')
      .select('company_name, logo_url')
      .eq('subdomain', tenantSubdomain)
      .single()
    tenant = data
  }

  const authMethod = await getTenantAuthMethod(tenantSubdomain || 'app')

  return (
    <div className="min-h-screen flex">

      {/* ── Left panel — Dark Slate brand panel ─────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12"
        style={{ backgroundColor: '#1E293B' }}
      >
        <div>
          <BaselineDocsLogoLight className="h-11" />
        </div>

        <div className="space-y-8">
          <div>
            <h2 className="text-3xl font-bold text-white leading-tight mb-4">
              Document control built for quality teams.
            </h2>
            <p className="text-slate-400 text-base leading-relaxed">
              Version control, multi-approver workflows, and complete audit trails — purpose-built for ISO-aligned organizations.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ClearStrideIconLight className="h-6 w-6" />
          <span className="text-slate-500 text-sm">Part of the ClearStride Tools suite</span>
        </div>
      </div>

      {/* ── Right panel — sign-in form ───────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-white">
        <div className="w-full max-w-sm">

          {/* Mobile logo */}
          <div className="lg:hidden mb-8">
            <BaselineDocsLogoLight className="h-9" />
          </div>

          {/* Tenant branding */}
          {tenant?.logo_url && (
            <div className="mb-6 flex justify-center">
              <Image src={tenant.logo_url} alt={tenant.company_name ?? ''} width={120} height={40} className="object-contain" />
            </div>
          )}

          <h1 className="text-2xl font-bold text-slate-900 mb-1">
            {tenant?.company_name ? `Sign in to ${tenant.company_name}` : 'Sign in'}
          </h1>
          <p className="text-slate-500 text-sm mb-8">
            BaselineDocs — Document Control
          </p>

          {authMethod === 'google'    && <GoogleSignInButton />}
          {authMethod === 'microsoft' && <MicrosoftSignInButton />}
          {authMethod === 'email'     && <EmailPasswordForm />}

          <p className="mt-8 text-center text-xs text-slate-400">
            <Link href="/terms" className="hover:underline">Terms</Link>
            {' · '}
            <Link href="/privacy" className="hover:underline">Privacy</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
