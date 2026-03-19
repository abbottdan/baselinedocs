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
    const { fileId, documentId } = await request.json()

    if (!fileId || !documentId) {
      return NextResponse.json(
        { success: false, error: 'File ID and document ID required' },
        { status: 400 }
      )
    }

    // Get file info
    const { data: file } = await supabase
      .from('document_files')
      .select('file_path, original_file_name, document_id')
      .eq('id', fileId)
      .single()

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'File not found' },
        { status: 404 }
      )
    }

    // Verify file belongs to document
    if (file.document_id !== documentId) {
      return NextResponse.json(
        { success: false, error: 'File does not belong to this document' },
        { status: 400 }
      )
    }

    // Get document info for audit log
    const { data: document } = await supabase
      .schema('docs')
      .from('documents')
      .select('document_number, version, status')
      .eq('id', documentId)
      .single()

    // Delete from storage
    const { error: storageError } = await supabase
      .storage
      .from('documents')
      .remove([file.file_path])

    if (storageError) {
      console.error('Storage delete error:', storageError)
      // Continue anyway - file might already be deleted
    }

    // Delete from database
    const { error: dbError } = await supabase
      .from('document_files')
      .delete()
      .eq('id', fileId)

    if (dbError) {
      console.error('Database delete error:', dbError)
      return NextResponse.json(
        { success: false, error: 'Failed to delete file record' },
        { status: 500 }
      )
    }

    // Create audit log entry
    if (document) {
      await supabase
        .from('audit_log')
        .insert({
          document_id: documentId,
          action: 'admin_file_deleted',
          performed_by: user.id,
          performed_by_email: userData.email,
          details: {
            file_name: file.original_file_name,
            admin_action: true,
            document_number: document.document_number,
            version: document.version,
            document_status: document.status,
          },
        })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Admin file delete error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
