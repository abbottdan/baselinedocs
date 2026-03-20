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

    const { documentId, newDocNumber } = await request.json()

    if (!documentId || !newDocNumber) {
      return NextResponse.json({ success: false, error: 'Missing documentId or newDocNumber' }, { status: 400 })
    }

    // Validate format (PREFIX-#####)
    const numberPattern = /^[A-Z]+-\d{5}$/
    if (!numberPattern.test(newDocNumber)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid document number format. Use PREFIX-##### (e.g., FORM-00001)' 
      }, { status: 400 })
    }

    // Get document info
    const { data: document, error: docError } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .select('id, document_number, version, tenant_id')
      .eq('id', documentId)
      .single()

    if (docError || !document) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 })
    }

    // Check if new number already exists (for any version)
    const { data: existing } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .select('id')
      .eq('document_number', newDocNumber)
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json({ 
        success: false, 
        error: `Document number ${newDocNumber} already exists` 
      }, { status: 409 })
    }

    // Use service role client to bypass RLS
    const supabaseAdmin = createServiceRoleClient()
    
    const { error: updateError } = await supabaseAdmin
      .schema('docs')
      .from('documents')
      .update({ document_number: newDocNumber })
      .eq('id', documentId)

    if (updateError) {
      console.error('Failed to update document number:', updateError)
      return NextResponse.json({ success: false, error: 'Failed to update document number' }, { status: 500 })
    }

    // Create audit log
    await supabaseAdmin
      .from('audit_log')
      .insert({
        document_id: documentId,
        document_number: newDocNumber, // Use new number
        version: document.version,
        action: 'admin_rename',
        performed_by: user.id,
        performed_by_email: user.email,
        tenant_id: document.tenant_id,
        details: {
          old_number: `${document.document_number}${document.version}`,
          new_number: `${newDocNumber}${document.version}`,
        },
      })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Admin force document number change error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
