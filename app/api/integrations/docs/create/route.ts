/**
 * POST /api/integrations/docs/create
 *
 * Creates a new Draft document on behalf of a BaselineReqs user.
 * Called after the user selects a document type from the picker populated
 * by GET /api/integrations/docs/types.
 *
 * Tenant resolved from Host header (e.g. acme.baselinedocs.com).
 * Auth: x-integration-key header required.
 *
 * Request body:
 * {
 *   "title": "System Architecture",          // required
 *   "document_type_id": "uuid",              // required — from /docs/types
 *   "user_email": "alice@acme.com",          // required — creator identity
 *   "description": "Optional description"   // optional
 * }
 *
 * Success response:
 * {
 *   "doc_id": "uuid",
 *   "title": "System Architecture",
 *   "document_number": "FORM-00042vA",
 *   "url": "https://acme.baselinedocs.com/documents/<uuid>"
 * }
 *
 * The returned URL is what BaselineReqs stores as the attachment href and
 * uses for all future reference lookups (delete guard, mark-broken, badge).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildDocumentUrl } from '@/lib/integrations/baselinereqs'
import { logger } from '@/lib/logger'
import { sanitizeHTML } from '@/lib/security/sanitize'

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const key = req.headers.get('x-integration-key')
  if (!key || key !== process.env.INTEGRATION_SECRET) {
    logger.warn({ path: req.nextUrl.pathname }, 'Integration auth failed on docs/create')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Tenant from Host header ───────────────────────────────────────────────
  const host = req.headers.get('host') ?? ''
  const subdomain = host.split('.')[0]

  if (!subdomain) {
    return NextResponse.json({ error: 'Invalid subdomain' }, { status: 400 })
  }

  // ── Parse + validate body ─────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''
  const documentTypeId = typeof body.document_type_id === 'string' ? body.document_type_id.trim() : ''
  const userEmail = typeof body.user_email === 'string' ? body.user_email.trim().toLowerCase() : ''
  const rawDescription = typeof body.description === 'string' ? body.description.trim() : ''

  if (!rawTitle) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!documentTypeId) {
    return NextResponse.json({ error: 'document_type_id is required' }, { status: 400 })
  }
  if (!userEmail) {
    return NextResponse.json({ error: 'user_email is required' }, { status: 400 })
  }

  // Sanitize user-supplied strings — same treatment as the main createDocument action
  const title = sanitizeHTML(rawTitle) ?? ''
  const description = rawDescription ? (sanitizeHTML(rawDescription) ?? null) : null

  if (!title.trim()) {
    return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // ── Resolve tenant ────────────────────────────────────────────────────────
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id')
    .eq('subdomain', subdomain)
    .single()

  if (tenantError || !tenant) {
    logger.warn({ subdomain }, 'docs/create: tenant not found')
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  // ── Resolve user by email ─────────────────────────────────────────────────
  // Both apps share the same tenant subdomain — a user logged in to BaselineReqs
  // under acme.baselinereqs.com has the same email as their BaselineDocs account.
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, is_active, role')
    .eq('email', userEmail)
    .eq('tenant_id', tenant.id)
    .single()

  if (userError || !user) {
    logger.warn({ subdomain, userEmail }, 'docs/create: user not found in tenant')
    return NextResponse.json(
      { error: `No BaselineDocs account found for ${userEmail} in this tenant` },
      { status: 404 }
    )
  }

  // Check the user is allowed to create documents
  if (user.is_active === false || user.role === 'Deactivated') {
    logger.warn({ subdomain, userEmail }, 'docs/create: user is deactivated')
    return NextResponse.json({ error: 'User account is deactivated' }, { status: 403 })
  }
  if (user.role === 'Read Only') {
    logger.warn({ subdomain, userEmail }, 'docs/create: user is read-only')
    return NextResponse.json({ error: 'User does not have permission to create documents' }, { status: 403 })
  }

  // ── Validate document type belongs to this tenant ─────────────────────────
  const { data: docType, error: typeError } = await supabase
    .from('document_types')
    .select('id, prefix, next_number, is_active')
    .eq('id', documentTypeId)
    .eq('tenant_id', tenant.id)
    .single()

  if (typeError || !docType) {
    logger.warn({ subdomain, documentTypeId }, 'docs/create: document type not found')
    return NextResponse.json({ error: 'Document type not found' }, { status: 404 })
  }

  if (!docType.is_active) {
    return NextResponse.json({ error: 'Document type is inactive' }, { status: 400 })
  }

  // ── Generate document number ──────────────────────────────────────────────
  // All documents created via this endpoint are Prototype (not Production) —
  // promotion to Production requires the full approval workflow in BaselineDocs.
  const documentNumber = `${docType.prefix}-${String(docType.next_number).padStart(5, '0')}`
  const version = 'vA'

  // ── Insert document ───────────────────────────────────────────────────────
  const { data: document, error: createError } = await supabase
    .from('documents')
    .insert({
      document_type_id: documentTypeId,
      document_number: documentNumber,
      version,
      title,
      description,
      is_production: false,
      status: 'Draft',
      created_by: user.id,
      tenant_id: tenant.id,
    })
    .select('id')
    .single()

  if (createError || !document) {
    logger.error(
      { subdomain, userEmail, documentNumber, error: createError?.message },
      'docs/create: document insert failed'
    )
    return NextResponse.json({ error: 'Failed to create document' }, { status: 500 })
  }

  // ── Increment document type counter ───────────────────────────────────────
  // Same pattern as the main createDocument action — non-atomic but consistent
  // with existing behaviour. Race conditions here would produce a gap in
  // numbering, not a duplicate (unique constraint protects against that).
  await supabase
    .from('document_types')
    .update({ next_number: docType.next_number + 1 })
    .eq('id', documentTypeId)

  // ── Audit log ─────────────────────────────────────────────────────────────
  await supabase
    .from('audit_log')
    .insert({
      document_id: document.id,
      document_number: documentNumber,
      action: 'created',
      performed_by: user.id,
      performed_by_email: user.email,
      tenant_id: tenant.id,
      details: {
        document_number: documentNumber,
        version,
        title,
        is_production: false,
        source: 'baselinereqs_integration',
      },
    })

  const url = buildDocumentUrl(subdomain, document.id)

  logger.info(
    { subdomain, userEmail, documentId: document.id, documentNumber: `${documentNumber}${version}` },
    'docs/create: document created via integration'
  )

  return NextResponse.json({
    doc_id: document.id,
    title,
    document_number: `${documentNumber}${version}`,
    url,
  }, { status: 201 })
}
