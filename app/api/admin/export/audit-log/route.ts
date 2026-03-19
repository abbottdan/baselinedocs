import { NextRequest, NextResponse } from 'next/server'
import { createClient , createSharedClient} from '@/lib/supabase/server'
import { getSubdomainTenantId } from '@/lib/tenant'

/**
 * GET /api/admin/export/audit-log
 *
 * Streams a CSV of the entire audit log for the current tenant.
 * Admin-only. Includes all documents, all versions, all actions.
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

    // Fetch all audit log entries for this tenant, joined with document info
    const { data: logs, error } = await supabase
      .from('audit_log')
      .select(`
        id,
        action,
        performed_by_email,
        created_at,
        details,
        documents!inner (
          document_number,
          version,
          title
        )
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch audit log' }, { status: 500 })
    }

    // Build CSV
    const ACTION_LABELS: Record<string, string> = {
      created: 'Created',
      updated: 'Updated',
      document_deleted: 'Draft Deleted',
      released: 'Released',
      document_obsoleted: 'Obsoleted',
      file_uploaded: 'File Uploaded',
      file_deleted: 'File Deleted',
      file_scan_completed: 'Virus Scan Completed',
      file_scan_failed: 'Virus Scan Failed',
      submitted_for_approval: 'Submitted for Approval',
      approved: 'Approved',
      rejected: 'Rejected',
      withdrawn_from_approval: 'Withdrawn from Approval',
      approver_added: 'Approver Added',
      approver_removed: 'Approver Removed',
      version_created: 'New Version Created',
      promoted_to_production: 'Promoted to Production',
      converted_to_production: 'Converted to Production',
      admin_status_change: 'Status Changed (Admin)',
      admin_delete: 'Deleted (Admin)',
      admin_rename: 'Renamed (Admin)',
      admin_change_owner: 'Owner Changed (Admin)',
    }

    function esc(value: string | null | undefined): string {
      return `"${String(value ?? '').replace(/"/g, '""')}"`
    }

    function formatDetail(details: any): string {
      if (!details) return ''
      const parts: string[] = []
      if (details.old_status && details.new_status) parts.push(`${details.old_status} → ${details.new_status}`)
      if (details.old_number && details.new_number) parts.push(`${details.old_number} → ${details.new_number}`)
      if (details.old_owner && details.new_owner) parts.push(`${details.old_owner} → ${details.new_owner}`)
      if (details.rejection_reason) parts.push(`Reason: ${details.rejection_reason}`)
      if (details.comments) parts.push(`Comment: ${details.comments}`)
      if (details.file_name) parts.push(`File: ${details.file_name}`)
      return parts.join('; ')
    }

    const headers = ['Date (UTC)', 'Document Number', 'Version', 'Title', 'Action', 'Performed By', 'Details']
    const headerRow = headers.map(h => esc(h)).join(',')

    const dataRows = (logs ?? []).map(entry => {
      const doc = Array.isArray(entry.documents) ? entry.documents[0] : entry.documents
      return [
        esc(new Date(entry.created_at).toISOString().replace('T', ' ').substring(0, 19)),
        esc(doc?.document_number),
        esc(doc?.version),
        esc(doc?.title),
        esc(ACTION_LABELS[entry.action] ?? entry.action),
        esc(entry.performed_by_email),
        esc(formatDetail(entry.details)),
      ].join(',')
    })

    const csv = [headerRow, ...dataRows].join('\n')
    const date = new Date().toISOString().split('T')[0]

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-log-${date}.csv"`,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 }
    )
  }
}
