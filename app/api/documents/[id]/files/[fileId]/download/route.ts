import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; fileId: string } }
) {
  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Get file metadata
    const { data: file, error: fileError } = await supabase
      .from('document_files')
      .select('*, document:documents(id, status, created_by)')
      .eq('id', params.fileId)
      .eq('document_id', params.id)
      .single()

    if (fileError || !file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Check access permission (RLS should handle this, but double-check)
    const document = file.document as any
    const canAccess = 
      document.status === 'Released' || 
      document.status === 'Obsolete' ||
      document.created_by === user.id

    if (!canAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Generate signed URL (valid for 1 hour)
    const { data: signedUrlData, error: urlError } = await createServiceRoleClient().storage
      .from('documents')
      .createSignedUrl(file.file_path, 3600)

    if (urlError || !signedUrlData) {
      console.error('Error generating signed URL:', urlError)
      return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 })
    }

    // Redirect to signed URL
    return NextResponse.redirect(signedUrlData.signedUrl)
  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
