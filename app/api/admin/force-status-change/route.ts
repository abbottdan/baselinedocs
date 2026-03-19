import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient , createSharedClient} from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    // Check if user is admin
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
      return NextResponse.json({ success: false, error: 'Not authorized - admin only' }, { status: 403 })
    }

    const { documentId, newStatus } = await request.json()

    if (!documentId || !newStatus) {
      return NextResponse.json({ success: false, error: 'Missing documentId or newStatus' }, { status: 400 })
    }

    // Validate status
    const validStatuses = ['Draft', 'In Approval', 'Released', 'Obsolete']
    if (!validStatuses.includes(newStatus)) {
      return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 })
    }

    // Get document info
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, document_number, version, status, tenant_id')
      .eq('id', documentId)
      .single()

    if (docError || !document) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 })
    }

    // Use service role client to bypass RLS
    const supabaseAdmin = createServiceRoleClient()
    
    const { error: updateError } = await supabaseAdmin
      .from('documents')
      .update({ status: newStatus })
      .eq('id', documentId)

    if (updateError) {
      console.error('Failed to update document status:', updateError)
      return NextResponse.json({ success: false, error: 'Failed to update status' }, { status: 500 })
    }

    // Create audit log
    await supabaseAdmin
      .from('audit_log')
      .insert({
        document_id: documentId,
        action: 'admin_status_change',
        performed_by: user.id,
        performed_by_email: user.email,
        tenant_id: document.tenant_id,
        details: {
          document_number: `${document.document_number}${document.version}`,
          old_status: document.status,
          new_status: newStatus,
        },
      })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Admin force status change error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
