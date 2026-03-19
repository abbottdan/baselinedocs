/**
 * GET /api/integrations/docs/types
 *
 * Returns the active document types for a tenant so BaselineReqs can
 * populate a document type selector before calling the create endpoint.
 *
 * Tenant resolved from Host header (e.g. acme.baselinedocs.com).
 * Auth: x-integration-key header required.
 *
 * Response:
 * {
 *   "types": [
 *     { "id": "uuid", "name": "Form", "prefix": "FORM", "description": "..." },
 *     { "id": "uuid", "name": "Procedure", "prefix": "PROC", "description": null }
 *   ]
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { getSubdomainTenantId } from '@/lib/tenant'
import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const key = req.headers.get('x-integration-key')
  if (!key || key !== process.env.INTEGRATION_SECRET) {
    logger.warn({ path: req.nextUrl.pathname }, 'Integration auth failed on docs/types')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Tenant from Host header ───────────────────────────────────────────────
  const host = req.headers.get('host') ?? ''
  const subdomain = host.split('.')[0]

  if (!subdomain) {
    return NextResponse.json({ error: 'Invalid subdomain' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // ── Resolve tenant ────────────────────────────────────────────────────────
  const { data: tenant, error: tenantError } = await createPlatformClient()
      .schema('platform')
      .schema('platform').from('tenants')
    .select('id')
    .eq('subdomain', subdomain)
    .single()

  if (tenantError || !tenant) {
    logger.warn({ subdomain }, 'docs/types: tenant not found')
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  // ── Fetch active document types ───────────────────────────────────────────
  const { data, error } = await supabase
    .schema('docs')
    .from('document_types')
    .select('id, name, prefix, description')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) {
    logger.error({ subdomain, tenantId: tenant.id, error: error.message }, 'docs/types DB query failed')
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  logger.info({ subdomain, count: data?.length ?? 0 }, 'docs/types returned results')

  return NextResponse.json({
    types: (data ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      description: t.description ?? null,
    }))
  })
}
