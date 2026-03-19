/**
 * GET /api/integrations/ping
 *
 * Called by BaselineReqs on every project page load (with 5-minute client-side
 * caching) to decide whether to show the BaselineDocs attachment UI.
 *
 * Auth: none — this endpoint only confirms existence, not data access.
 *
 * Tenant resolution: subdomain is read from the Host header, matching the
 * same pattern BaselineReqs uses for its own ping endpoint. BaselineReqs
 * simply calls https://acme.baselinedocs.com/api/integrations/ping and the
 * correct tenant resolves automatically.
 *
 * Responses:
 *   200  { exists: true,  subdomain: "acme" }  — active tenant found
 *   404  { exists: false }                      — unknown or inactive tenant
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  const host = req.headers.get('host') ?? ''
  const subdomain = host.split('.')[0]

  // Only reject if there's no subdomain at all (bare domain hit)
  if (!subdomain) {
    return NextResponse.json({ exists: false }, { status: 404 })
  }

  const supabase = createServiceClient()

  const { data: tenant } = await createPlatformClient()
      .schema('platform')
      .schema('platform').from('tenants')
    .select('id')
    .eq('subdomain', subdomain)
    .eq('is_active', true)
    .single()

  if (!tenant) {
    logger.info({ subdomain }, 'ping: tenant not found or inactive')
    return NextResponse.json({ exists: false }, { status: 404 })
  }

  return NextResponse.json({ exists: true, subdomain })
}
