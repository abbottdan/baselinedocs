import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, createSharedClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
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
      return NextResponse.json(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      )
    }

    // Get request body
    const { documentId, isProduction } = await request.json()

    if (typeof isProduction !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'Invalid production status' },
        { status: 400 }
      )
    }

    // Get current document
    const { data: document } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .select('is_production, document_number, version')
      .eq('id', documentId)
      .single()

    if (!document) {
      return NextResponse.json(
        { success: false, error: 'Document not found' },
        { status: 404 }
      )
    }

    // Update document production status
    const { error: updateError } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .update({ 
        is_production: isProduction,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId)

    if (updateError) {
      console.error('Production toggle error:', updateError)
      return NextResponse.json(
        { success: false, error: 'Failed to update production status' },
        { status: 500 }
      )
    }

    // Create audit log entry
    const { error: auditError } = await createServiceRoleClient()
      .schema('docs')
      .from('audit_log')
      .insert({
        document_id: documentId,
        action: 'admin_toggle_production',
        performed_by: user.id,
        performed_by_email: userData.email,
        details: {
          old_is_production: document.is_production,
          new_is_production: isProduction,
          admin_action: true,
          version: document.version,
        },
      })

    if (auditError) {
      console.error('Audit log error:', auditError)
      // Don't fail the request, but log it
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Admin production toggle error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
