/**
 * GET /api/integrations/docs/list
 *
 * Powers the BaselineReqs "Link existing doc" file picker.
 * Returns a searchable list of Released documents for the tenant identified
 * by the request's Host header subdomain — consistent with the ping pattern,
 * no subdomain query param needed.
 *
 * Query params:
 *   q  — optional search string matched against title and document_number
 *
 * Auth: x-integration-key header must match INTEGRATION_SECRET env var.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { createClient } from '@supabase/supabase-js'
import { buildDocumentUrl } from '@/lib/integrations/baselinereqs'
import { logger } from '@/lib/logger'

// Use service-role client — this route is server-to-server, not user-session-based
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
    logger.warn({ path: req.nextUrl.pathname }, 'Integration auth failed on docs/list')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Tenant from Host header ───────────────────────────────────────────────
  // BaselineReqs calls acme.baselinedocs.com/api/integrations/docs/list so the
  // subdomain is already in the Host — no query param needed.
  const host = req.headers.get('host') ?? ''
  const subdomain = host.split('.')[0]

  if (!subdomain) {
    return NextResponse.json({ error: 'Invalid subdomain' }, { status: 400 })
  }

  const query = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  const supabase = createServiceClient()

  // ── Resolve tenant ────────────────────────────────────────────────────────
  const { data: tenant, error: tenantError } = await createPlatformClient()
      .schema('platform')
      .schema('platform').from('tenants')
    .select('id')
    .eq('subdomain', subdomain)
    .single()

  if (tenantError || !tenant) {
    logger.warn({ subdomain }, 'docs/list: tenant not found')
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  // ── Query documents ───────────────────────────────────────────────────────
  // Return Released and Draft documents — engineers need to link requirements
  // to work-in-progress docs during active development. Obsolete docs are
  // excluded since they've been superseded and shouldn't attract new links.
  // In Approval is also excluded — those are transitional and will become
  // Released shortly anyway.
  let dbQuery = supabase
    .schema('docs')
    .from('documents')
    .select('id, title, document_number, version, status, updated_at')
    .eq('tenant_id', tenant.id)
    .in('status', ['Released', 'Draft'])
    .order('updated_at', { ascending: false })
    .limit(50)

  if (query) {
    dbQuery = dbQuery.or(
      `document_number.ilike.%${query}%,title.ilike.%${query}%`
    )
  }

  const { data, error } = await dbQuery

  if (error) {
    logger.error({ subdomain, tenantId: tenant.id, error: error.message }, 'docs/list DB query failed')
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  // ── Shape response ────────────────────────────────────────────────────────
  const docs = (data ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    document_number: d.document_number,
    version: d.version,
    status: d.status,
    updated_at: d.updated_at,
    // Canonical URL that BaselineReqs will store as the attachment href
    url: buildDocumentUrl(subdomain, d.id),
    // Human-readable label for the picker UI
    display_label: `${d.document_number}${d.version} — ${d.title}`,
  }))

  logger.info({ subdomain, query, count: docs.length }, 'docs/list returned results')

  return NextResponse.json({ docs })
}
