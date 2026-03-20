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

    // Get form data
    const formData = await request.formData()
    const file = formData.get('file') as File
    const documentId = formData.get('documentId') as string

    if (!file || !documentId) {
      return NextResponse.json(
        { success: false, error: 'File and document ID required' },
        { status: 400 }
      )
    }

    // Get document info
    const { data: document } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .select('document_number, version, status')
      .eq('id', documentId)
      .single()

    if (!document) {
      return NextResponse.json(
        { success: false, error: 'Document not found' },
        { status: 404 }
      )
    }

    // Get file buffer
    const fileBuffer = await file.arrayBuffer()

    // Generate file path
    const fileExt = file.name.split('.').pop()
    const fileName = `${document.document_number}${document.version}_${Date.now()}.${fileExt}`
    const filePath = `${documentId}/${fileName}`

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase
      .storage
      .from('documents')
      .upload(filePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json(
        { success: false, error: 'Failed to upload file' },
        { status: 500 }
      )
    }

    // Create document_files record
    const { error: dbError } = await createServiceRoleClient()
      .schema('docs')
      .from('document_files')
      .insert({
        document_id: documentId,
        file_name: fileName,
        original_file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        mime_type: file.type,
        uploaded_by: user.id,
      })

    if (dbError) {
      console.error('Database insert error:', dbError)
      
      // Clean up uploaded file
      await createServiceRoleClient().storage.from('documents').remove([filePath])
      
      return NextResponse.json(
        { success: false, error: 'Failed to save file record' },
        { status: 500 }
      )
    }

    // Create audit log entry
    await createServiceRoleClient()
      .schema('docs')
      .from('audit_log')
      .insert({
        document_id: documentId,
        action: 'admin_file_added',
        performed_by: user.id,
        performed_by_email: userData.email,
        details: {
          file_name: file.name,
          file_size: file.size,
          admin_action: true,
          version: document.version,
          document_status: document.status,
        },
      })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Admin file upload error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
