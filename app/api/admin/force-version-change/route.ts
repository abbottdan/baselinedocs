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
    const { documentId, newVersion } = await request.json()

    // Basic version validation
    if (!newVersion || newVersion.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'Version cannot be empty' },
        { status: 400 }
      )
    }

    // Get current document
    const { data: document } = await supabase
      .schema('docs')
      .from('documents')
      .select('version, document_number, is_production')
      .eq('id', documentId)
      .single()

    if (!document) {
      return NextResponse.json(
        { success: false, error: 'Document not found' },
        { status: 404 }
      )
    }

    // Check for conflicts with existing versions
    const { data: existingVersion } = await supabase
      .schema('docs')
      .from('documents')
      .select('id')
      .eq('document_number', document.document_number)
      .eq('version', newVersion)
      .neq('id', documentId)
      .single()

    if (existingVersion) {
      return NextResponse.json(
        { success: false, error: `Version ${newVersion} already exists for this document` },
        { status: 400 }
      )
    }

    // Update document version
    const { error: updateError } = await supabase
      .schema('docs')
      .from('documents')
      .update({ 
        version: newVersion,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId)

    if (updateError) {
      console.error('Version update error:', updateError)
      return NextResponse.json(
        { success: false, error: 'Failed to update version' },
        { status: 500 }
      )
    }

    // Create audit log entry
    await supabase
      .from('audit_log')
      .insert({
        document_id: documentId,
        action: 'admin_force_version_change',
        performed_by: user.id,
        performed_by_email: userData.email,
        details: {
          old_version: document.version,
          new_version: newVersion,
          admin_action: true,
          document_number: document.document_number,
          is_production: document.is_production,
        },
      })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Admin version change error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
