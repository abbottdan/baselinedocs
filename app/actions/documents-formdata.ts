'use server'

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { revalidatePath } from 'next/cache'
import { formatDocumentFilename } from '@/lib/file-naming'
import { createDocumentAudit, AuditAction } from '@/lib/audit-helper'
import { checkStorageLimit, getTotalFileSize } from '@/lib/storage-limit'
import { getCurrentSubdomain, getSubdomainTenantId } from '@/lib/tenant'
import { logger } from '@/lib/logger'


export async function updateDocumentWithFiles(formData: FormData) {
  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    // Extract form fields
    const documentId = formData.get('documentId') as string
    const title = formData.get('title') as string
    const description = formData.get('description') as string
    const projectCode = formData.get('projectCode') as string | null

    // Get document to check ownership and status
    const { data: document, error: getError } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single()

    if (getError || !document) {
      return { success: false, error: 'Document not found' }
    }

    // Use the subdomain's tenant_id (not the creator's home tenant)
    const tenantId = await getSubdomainTenantId()

    if (!tenantId) {
      logger.error('Tenant not found', { userId: user.id, userEmail: user.email })
      return { success: false, error: 'Tenant not found' }
    }

    const { data: tenant } = await createPlatformClient()
        .schema('platform')
        .from('tenants')
        .select('auto_rename_files')
        .eq('id', tenantId)
        .single()

    const autoRename = tenant?.auto_rename_files ?? true

    if (document.created_by !== user.id) {
      return { success: false, error: 'Not authorized' }
    }

    if (document.status !== 'Draft') {
      return { success: false, error: 'Only Draft documents can be edited' }
    }

    // Update document metadata
    const { error: updateError } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .update({
        title,
        description,
        project_code: projectCode ? projectCode.toUpperCase() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId)

    if (updateError) {
      return { success: false, error: 'Failed to update document' }
    }

    // Handle file uploads
    const files = formData.getAll('files') as File[]

    // ⭐ CHECK STORAGE LIMIT BEFORE UPLOADING ⭐
    if (files.length > 0 && files.some(f => f.size > 0)) {
      const totalFileSize = getTotalFileSize(files.filter(f => f.size > 0))

      console.log(`🔍 [Storage Check] Checking storage limit before upload...`)
      console.log(`🔍 [Storage Check] Tenant: ${tenantId}`)
      console.log(`🔍 [Storage Check] Files to upload: ${(totalFileSize / (1024 * 1024)).toFixed(2)} MB`)

      const storageCheck = await checkStorageLimit(tenantId, totalFileSize)

      console.log(`🔍 [Storage Check] Result:`, {
        allowed: storageCheck.allowed,
        currentGB: storageCheck.currentStorageGB.toFixed(2),
        limitGB: storageCheck.storageLimitGB,
        percentUsed: storageCheck.percentUsed.toFixed(1)
      })

      if (!storageCheck.allowed) {
        console.log(`🚫 [Storage Check] BLOCKED - Storage limit exceeded`)
        return {
          success: false,
          error: storageCheck.error || 'Storage limit exceeded',
          requiresUpgrade: true,
          currentStorageGB: storageCheck.currentStorageGB,
          storageLimitGB: storageCheck.storageLimitGB
        }
      }

      console.log(`✅ [Storage Check] PASSED - Upload allowed`)
    }

    const uploadedFiles: any[] = []

    if (files.length > 0) {
      console.log(`Uploading ${files.length} files for document ${documentId}`)

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (file.size === 0) continue

        console.log(`[${i + 1}/${files.length}] Processing file: ${file.name}, size: ${file.size}`)

        // Convert to buffer
        const fileBuffer = await file.arrayBuffer()

        // Generate unique file name
        const subdomain = await getCurrentSubdomain()

        if (!subdomain) {
          return { success: false, error: 'Unable to determine tenant context' }
        }

        const fileName = `${subdomain}/${document.document_number}${document.version}/${Date.now()}-${file.name}`


        // Upload to Supabase Storage (use service role to bypass RLS)
        const supabaseAdmin = createServiceRoleClient()
        const { error: uploadError } = await supabaseAdmin.storage
          .from('documents')
          .upload(fileName, fileBuffer, {
            contentType: file.type,
            upsert: false,
          })

        if (uploadError) {
          console.error('File upload error:', uploadError)
          return {
            success: false,
            error: `Failed to upload file ${file.name}: ${uploadError.message}`
          }
        }

        console.log(`[${i + 1}/${files.length}] File uploaded to storage`)

        // Format filename with smart renaming
        const formattedFileName = formatDocumentFilename(
          document.document_number,
          document.version,
          file.name,
          autoRename
        )

        // Create file record
        const { data: fileRecord, error: fileError } = await supabaseAdmin
          .schema('docs')
          .from('document_files')
          .insert({
            document_id: documentId,
            file_name: formattedFileName,
            original_file_name: file.name,
            file_path: fileName,
            file_size: file.size,
            mime_type: file.type,
            uploaded_by: user.id,
            tenant_id: document.tenant_id,
          })
          .select()
          .single()

        if (fileError) {
          console.error('File record creation error:', fileError)
          await supabaseAdmin.storage.from('documents').remove([fileName])
          return {
            success: false,
            error: `Failed to save file metadata for ${file.name}: ${fileError.message}`
          }
        }

        console.log(`[${i + 1}/${files.length}] ✅ File uploaded successfully`)

        // ✅ AUDIT: Log file upload
        await createDocumentAudit({
          documentId: documentId,
          action: AuditAction.FILE_UPLOADED,
          performedBy: user.id,
          performedByEmail: user.email!,
          tenantId: tenantId,
          details: {
            file_id: fileRecord.id,
            file_name: fileRecord.file_name,
            original_file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
          }
        })

        uploadedFiles.push(fileRecord)
      }
    }

    revalidatePath('/documents')

    return {
      success: true,
      documentNumber: document.document_number,
      version: document.version,
      filesUploaded: uploadedFiles.length,
    }
  } catch (error: any) {
    console.error('Server action error:', error)
    return { success: false, error: error.message || 'An error occurred' }
  }
}
