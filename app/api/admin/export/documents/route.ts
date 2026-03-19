import { NextRequest, NextResponse } from 'next/server'
import { createClient , createSharedClient} from '@/lib/supabase/server'
import { getSubdomainTenantId } from '@/lib/tenant'

/**
 * GET /api/admin/export/documents
 *
 * Streams a CSV of all document records for the current tenant.
 * Admin-only. Includes all versions and statuses.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Auth check
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Admin check
    const sharedClient = createSharedClient()
      const { data: _su } = await sharedClient
        .schema('shared')
        .from('users')
        .select('is_master_admin, tenant_id, email, full_name')
        .eq('id', user.id)
        .single()
      const userData = {
        is_admin: _su?.is_master_admin ?? false,
        tenant_id: _su?.tenant_id,
        email: _su?.email,
        full_name: _su?.full_name,
      }

    if (!userData?.is_admin) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    // Tenant from subdomain
    const tenantId = await getSubdomainTenantId()
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 })
    }

    // Fetch all documents with related data
    const { data: documents, error } = await supabase
      .from('documents')
      .select(`
        document_number,
        version,
        title,
        description,
        status,
        is_production,
        project_code,
        created_at,
        updated_at,
        released_at,
        document_types!inner ( name, prefix ),
        created_by,
        released_by
      `)
      .eq('tenant_id', tenantId)
      .order('document_number', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 })
    }

    function esc(value: string | null | undefined): string {
      return `"${String(value ?? '').replace(/"/g, '""')}"`
    }

    function formatDate(value: string | null | undefined): string {
      if (!value) return ''
      return new Date(value).toISOString().replace('T', ' ').substring(0, 19)
    }

    const headers = [
      'Document Number',
      'Version',
      'Full Identifier',
      'Title',
      'Description',
      'Document Type',
      'Status',
      'Classification',
      'Project Code',
      'Created By',
      'Created At (UTC)',
      'Updated At (UTC)',
      'Released By',
      'Released At (UTC)',
    ]

    const headerRow = headers.map(h => esc(h)).join(',')

    // Fetch user emails for created_by / released_by UUIDs
    const userIds = [...new Set([
      ...(documents ?? []).map((d: any) => d.created_by).filter(Boolean),
      ...(documents ?? []).map((d: any) => d.released_by).filter(Boolean),
    ])]
    let userEmailMap: Record<string, string> = {}
    if (userIds.length > 0) {
      const { createSharedClient } = await import('@/lib/supabase/server')
      const { data: userRows } = await createSharedClient()
        .schema('shared')
        .from('users')
        .select('id, email')
        .in('id', userIds)
      userEmailMap = Object.fromEntries((userRows || []).map((u: any) => [u.id, u.email]))
    }

    const dataRows = (documents ?? []).map((doc: any) => {
      const docType = Array.isArray(doc.document_types) ? doc.document_types[0] : doc.document_types

      return [
        esc(doc.document_number),
        esc(doc.version),
        esc(`${doc.document_number}${doc.version}`),
        esc(doc.title),
        esc(doc.description),
        esc(docType?.name),
        esc(doc.status),
        esc(doc.is_production ? 'Production' : 'Prototype'),
        esc(doc.project_code),
        esc(userEmailMap[doc.created_by] || doc.created_by),
        esc(formatDate(doc.created_at)),
        esc(formatDate(doc.updated_at)),
        esc(userEmailMap[doc.released_by] || ''),
        esc(formatDate(doc.released_at)),
      ].join(',')
    })

    const csv = [headerRow, ...dataRows].join('\n')
    const date = new Date().toISOString().split('T')[0]

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="documents-export-${date}.csv"`,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 }
    )
  }
}
