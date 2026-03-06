import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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
    const { data: userData } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

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
        created_by_user:users!documents_created_by_fkey ( email ),
        released_by_user:users!documents_released_by_fkey ( email )
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

    const dataRows = (documents ?? []).map(doc => {
      const docType = Array.isArray(doc.document_types) ? doc.document_types[0] : doc.document_types
      const createdByUser = Array.isArray(doc.created_by_user) ? doc.created_by_user[0] : doc.created_by_user
      const releasedByUser = Array.isArray(doc.released_by_user) ? doc.released_by_user[0] : doc.released_by_user

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
        esc(createdByUser?.email),
        esc(formatDate(doc.created_at)),
        esc(formatDate(doc.updated_at)),
        esc(releasedByUser?.email),
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
