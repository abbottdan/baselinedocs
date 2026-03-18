/**
 * lib/auth/get-tenant-auth-method.ts
 *
 * CHANGED: Now queries clearstride_platform via createPlatformClient()
 * instead of the product DB. The tenants table (and auth_method column)
 * lives in platform.tenants — there is no tenants table in the product DB.
 */

import { createPlatformClient } from '@/lib/supabase/platform'

export type AuthMethod = 'google' | 'microsoft' | 'email'

/**
 * Returns the authentication method configured for a tenant.
 * Falls back to 'email' if the subdomain is not found in the platform DB.
 */
export async function getTenantAuthMethod(subdomain: string): Promise<AuthMethod> {
  const platform = createPlatformClient()

  const { data, error } = await platform
    .from('tenants')
    .select('auth_method')
    .eq('subdomain', subdomain)
    .single()

  if (error || !data) {
    console.log('[Auth] Tenant not found in platform DB, defaulting to email:', subdomain)
    return 'email'
  }

  return (data.auth_method as AuthMethod) ?? 'email'
}

/**
 * Checks whether a subdomain is available for registration.
 * Queries platform.tenants AND platform.subdomain_reservations via the
 * check_subdomain_available() Postgres function.
 */
export async function checkSubdomainAvailability(subdomain: string): Promise<{
  available: boolean
  tenant?: { id: string; auth_method: AuthMethod }
}> {
  const platform = createPlatformClient()

  const { data, error } = await platform
    .from('tenants')
    .select('id, auth_method')
    .eq('subdomain', subdomain)
    .single()

  if (error || !data) {
    return { available: true }
  }

  return {
    available: false,
    tenant: {
      id: data.id,
      auth_method: (data.auth_method as AuthMethod) ?? 'email',
    },
  }
}
