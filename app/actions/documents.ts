'use server'

import { createClient, createServiceRoleClient , createSharedClient} from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logger, logError, logServerAction } from '@/lib/logger'
import { createDocumentSchema } from '@/lib/validation/schemas'
import { validateFormData, validateFile } from '@/lib/validation/validate'
import { sanitizeString, sanitizeFilename, sanitizeProjectCode, sanitizeHTML } from '@/lib/security/sanitize'
import { getCurrentSubdomain, getCurrentTenantId, getSubdomainTenantId } from '@/lib/tenant'
import { sendDocumentReleasedEmail } from '@/lib/email-notifications'
import { checkBaselineReqsReferences, markBaselineReqsLinksBroken, type BaselineReqsLinksResult } from '@/lib/integrations/baselinereqs'


// ==========================================
// Action: Create Document
// ==========================================
/**
 * Check if user has permission to perform write operations
 * Read Only and Deactivated users cannot create, edit, or delete
 */
async function checkWritePermission(supabase: any, userId: string): Promise<{ allowed: boolean, role: string | null }> {
  const sharedClient = createSharedClient()
    const { data: _sharedUser } = await sharedClient
      .schema('shared')
      .from('users')
      .select('is_active, is_master_admin, tenant_id')
      .eq('id', userId)
      .single()
    // Fetch role from docs.user_roles
    let _docRole = 'user'
    if (_sharedUser && !_sharedUser.is_master_admin) {
      const { data: rr } = await createServiceRoleClient()
        .schema('docs').from('user_roles')
        .select('role').eq('user_id', userId)
        .eq('tenant_id', _sharedUser.tenant_id).single()
      _docRole = rr?.role ?? 'user'
    } else if (_sharedUser?.is_master_admin) {
      _docRole = 'master_admin'
    }
    const userData = {
      role: _docRole === 'readonly' ? 'Read Only' : _docRole === 'tenant_admin' ? 'Admin' : 'Normal',
      is_active: _sharedUser?.is_active ?? false,
    }

  const role = userData?.role || 'Normal'
  const isActive = userData?.is_active !== false

  // Deactivated users cannot do anything
  if (!isActive || role === 'Deactivated') {
    return { allowed: false, role }
  }

  // Read Only users cannot write
  if (role === 'Read Only') {
    return { allowed: false, role }
  }

  // Admin and Normal users can write
  return { allowed: true, role }
}

export async function createDocument(formData: FormData) {
  const startTime = Date.now()
  let userId: string | undefined


  // Get subdomain for file path
  const subdomain = await getCurrentSubdomain()
  if (!subdomain) {
    return { success: false, error: 'Unable to determine tenant context' }
  }
  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      logger.warn('Create document attempted without authentication', { authError })
      return { success: false, error: 'Not authenticated' }
    }

    userId = user.id

    // Get tenant from CURRENT SUBDOMAIN (not user's home tenant)
    const tenantId = await getSubdomainTenantId()

    if (!tenantId) {
      logger.error('Invalid tenant subdomain', { userId })
      return { success: false, error: 'Invalid tenant context' }
    }

    // Check write permission
    const { allowed, role } = await checkWritePermission(supabase, userId!)
    if (!allowed) {
      logger.warn('User without write permission attempted to create document', {
        userId,
        role,
        action: 'createDocument'
      })
      return {
        success: false,
        error: role === 'Read Only'
          ? 'Read-only users cannot create documents'
          : 'Your account is deactivated. Please contact an administrator.'
      }
    }

    logger.info('Creating document', { userId, action: 'createDocument' })

    // Validate form data
    const validation = validateFormData(formData, createDocumentSchema)
    if (!validation.success) {
      logger.warn('Document creation validation failed', {
        userId,
        error: validation.error,
        errors: validation.errors,
      })
      return { success: false, error: validation.error }
    }

    const data = validation.data

    // Sanitize inputs - use sanitizeHTML for user-facing text to strip tags
    const title = sanitizeHTML(data.title)
    const description = sanitizeHTML(data.description || '')
    const project_code = sanitizeProjectCode(data.project_code)

    // Log if HTML was stripped (potential XSS attempt or accidental paste)
    if (data.title !== title) {
      logger.warn('HTML stripped from title', {
        userId,
        originalTitle: data.title,
        sanitizedTitle: title,
        action: 'createDocument'
      })
    }

    // Validate sanitized title isn't empty after HTML stripping
    if (!title || title.trim().length === 0) {
      logger.warn('Title is empty after sanitization', { userId, originalTitle: data.title })
      return { success: false, error: 'Title cannot be empty or contain only HTML tags' }
    }

    // Extract files from FormData
    const files: File[] = []
    formData.forEach((value, key) => {
      if (key.startsWith('file_') && value instanceof File) {
        files.push(value)
      }
    })

    // Validate files
    if (files.length > 0) {
      if (files.length > 20) {
        logger.warn('Too many files uploaded', { userId, fileCount: files.length })
        return { success: false, error: 'Cannot upload more than 20 files at once' }
      }

      for (const file of files) {
        const fileValidation = validateFile(file)
        if (!fileValidation.success) {
          logger.warn('File validation failed', {
            userId,
            fileName: file.name,
            error: fileValidation.error,
          })
          return { success: false, error: `${file.name}: ${fileValidation.error}` }
        }
      }
    }

    // Get document type for prefix and number — service role bypasses RLS for master admin
    const srDocType = createServiceRoleClient()
    const { data: docType, error: typeError } = await srDocType
      .schema('docs')
      .from('document_types')
      .select('prefix, next_number')
      .eq('id', data.document_type_id)
      .eq('tenant_id', tenantId)  // ✅ Verify document type belongs to this tenant
      .single()

    if (typeError || !docType) {
      logger.error('Document type not found', {
        userId,
        documentTypeId: data.document_type_id,
        error: typeError,
      })
      return { success: false, error: 'Document type not found' }
    }

    // Generate document number
    const documentNumber = `${docType.prefix}-${String(docType.next_number).padStart(5, '0')}`

    // Determine version based on production flag
    const version = data.is_production ? 'v1' : 'vA'

    logger.debug('Document number generated', {
      userId,
      documentNumber,
      version,
      prefix: docType.prefix,
      nextNumber: docType.next_number,
    })

    // Create document
    const { data: document, error: createError } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .insert({
        document_type_id: data.document_type_id,
        document_number: documentNumber,
        version: version,
        title: title,
        description: description,
        is_production: data.is_production,
        project_code: project_code,
        status: 'Draft',
        created_by: user.id,
        tenant_id: tenantId,
      })
      .select()
      .single()

    if (createError || !document) {
      logError(createError || new Error('No document returned'), {
        action: 'createDocument',
        userId,
        documentNumber,
      })
      return { success: false, error: 'Failed to create document' }
    }

    logger.info('Document created successfully', {
      userId,
      documentId: document.id,
      documentNumber: `${documentNumber}${version}`,
    })

    // Check if user is master admin (for cross-tenant file operations)
    const sharedClient2 = createSharedClient()
      const { data: userData } = await sharedClient2
        .schema('shared')
        .from('users')
        .select('is_master_admin')
        .eq('id', user.id)
        .single()

    const isMasterAdmin = userData?.is_master_admin || false

    // Use service role client for file operations if master admin
    // This bypasses RLS for cross-tenant operations
    const fileClient = isMasterAdmin ? createServiceRoleClient() : supabase

    // Create audit log for document creation
    await fileClient
      .schema('docs')
      .from('audit_log')
      .insert({
        document_id: document.id,
        action: 'created',
        performed_by: user.id,
        performed_by_email: user.email,
        tenant_id: tenantId,
        details: {
          document_number: documentNumber,
          version: version,
          title: title,
          is_production: data.is_production,
          project_code: project_code,
        }
      })


    // Increment document type counter
    await srDocType
      .schema('docs')
      .from('document_types')
      .update({ next_number: docType.next_number + 1 })
      .eq('id', data.document_type_id)

    // Upload files
    if (files.length > 0) {
      logger.info('Uploading files', {
        userId,
        documentId: document.id,
        fileCount: files.length,
      })

      const uploadPromises = files.map(async (file) => {
        const fileStartTime = Date.now()

        try {
          // Sanitize filename
          const sanitizedName = sanitizeFilename(file.name)
          const fileName = `${documentNumber}${version}_${sanitizedName}`
          const filePath = `${subdomain}/${documentNumber}${version}/${fileName}`

          // Upload to storage
          const { error: uploadError } = await createServiceRoleClient().storage
            .from('documents')
            .upload(filePath, file)

          if (uploadError) {
            logger.info({
              msg: 'File upload',
              fileName: sanitizedName,
              fileSize: file.size,
              documentId: document.id,
              userId,
              success: false,
              error: uploadError,
              duration: Date.now() - fileStartTime,
            })
            return null
          }

          // Save file metadata (using fileClient which may be service role for master admins)
          const { error: metaError } = await fileClient
            .schema('docs')
            .from('document_files')
            .insert({
              document_id: document.id,
              file_name: fileName,
              original_file_name: sanitizedName,
              file_path: filePath,
              file_size: file.size,
              mime_type: file.type,
              uploaded_by: user.id,
              tenant_id: tenantId,
            })

          if (metaError) {
            logError(metaError, {
              action: 'saveFileMetadata',
              userId,
              documentId: document.id,
              fileName,
            })
            return null
          }

          logger.info({
            msg: 'File Upload',
            fileName: sanitizedName,
            fileSize: file.size,
            documentId: document.id,
            userId,
            success: true,
            duration: Date.now() - fileStartTime,
          })

          return fileName
        } catch (error) {
          logError(error, {
            action: 'uploadFile',
            userId,
            documentId: document.id,
            fileName: file.name,
          })
          return null
        }
      })

      await Promise.all(uploadPromises)
    }

    // Create audit log entry
    await createServiceRoleClient()
      .schema('docs')
      .from('audit_log')
      .insert({
        document_id: document.id,
        action: 'created',
        performed_by: user.id,
        performed_by_email: user.email,
        tenant_id: tenantId,
        details: {
          document_number: documentNumber,
          version: version,
          title: title
        },
      })

    revalidatePath('/documents')
    revalidatePath('/dashboard')

    const duration = Date.now() - startTime
    logServerAction('createDocument', {
      userId,
      documentId: document.id,
      success: true,
      duration,
    })

    return {
      success: true,
      documentId: document.id,
      documentNumber: `${documentNumber}${version}`
    }
  } catch (error) {
    const duration = Date.now() - startTime
    logError(error, {
      action: 'createDocument',
      userId,
      duration,
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create document'
    }
  }
}

// ==========================================
// Action: Update Document
// ==========================================

export async function updateDocument(
  documentId: string,
  data: {
    title: string
    description: string
    project_code: string | null
  },
  newFiles: File[] = []
) {
  const startTime = Date.now()
  let userId: string | undefined
  // Get subdomain for file path
  const subdomain = await getCurrentSubdomain()
  if (!subdomain) {
    return { success: false, error: 'Unable to determine tenant context' }
  }
  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      logger.warn('Update document attempted without authentication', { authError, documentId })
      return { success: false, error: 'Not authenticated' }
    }

    userId = user.id

    // Check write permission
    const { allowed, role } = await checkWritePermission(supabase, userId!)
    if (!allowed) {
      logger.warn('User without write permission attempted to update document', {
        userId,
        role,
        documentId,
        action: 'updateDocument'
      })
      return {
        success: false,
        error: role === 'Read Only'
          ? 'Read-only users cannot edit documents'
          : 'Your account is deactivated. Please contact an administrator.'
      }
    }

    logger.info('Updating document', { userId, documentId, action: 'updateDocument' })

    // Sanitize inputs - use sanitizeHTML for user-facing text
    const title = sanitizeHTML(data.title)
    const description = sanitizeHTML(data.description || '')
    const project_code = sanitizeProjectCode(data.project_code)

    // Log if HTML was stripped
    if (data.title !== title) {
      logger.warn('HTML stripped from title during update', {
        userId,
        documentId,
        originalTitle: data.title,
        sanitizedTitle: title,
        action: 'updateDocument'
      })
    }

    // Validate sanitized data
    if (!title || title.length === 0) {
      logger.warn('Title is empty after sanitization', { userId, documentId, originalTitle: data.title })
      return { success: false, error: 'Title cannot be empty or contain only HTML tags' }
    }

    if (title.length > 200) {
      return { success: false, error: 'Title must be less than 200 characters' }
    }

    // Get document to check ownership and status
    const { data: document, error: getError } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single()

    if (getError || !document) {
      logger.error('Document not found for update', { userId, documentId, error: getError })
      return { success: false, error: 'Document not found' }
    }

    if (document.created_by !== user.id) {
      logger.warn('Unauthorized document update attempt', {
        userId,
        documentId,
        ownerId: document.created_by,
      })
      return { success: false, error: 'Not authorized' }
    }

    if (document.status !== 'Draft') {
      logger.warn('Attempt to edit non-draft document', {
        userId,
        documentId,
        status: document.status,
      })
      return { success: false, error: 'Only Draft documents can be edited' }
    }

    // Update document
    const { error: updateError } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .update({
        title: title,
        description: description,
        project_code: project_code,
      })
      .eq('id', documentId)

    if (updateError) {
      logError(updateError, { action: 'updateDocument', userId, documentId })
      return { success: false, error: 'Failed to update document' }
    }

    logger.info('Document updated successfully', { userId, documentId })

    // Validate and upload new files
    if (newFiles.length > 0) {
      if (newFiles.length > 20) {
        return { success: false, error: 'Cannot upload more than 20 files at once' }
      }

      // Validate each file
      for (const file of newFiles) {
        const fileValidation = validateFile(file)
        if (!fileValidation.success) {
          logger.warn('File validation failed during update', {
            userId,
            documentId,
            fileName: file.name,
            error: fileValidation.error,
          })
          return { success: false, error: `${file.name}: ${fileValidation.error}` }
        }
      }

      logger.info('Uploading new files', {
        userId,
        documentId,
        fileCount: newFiles.length,
      })

      const uploadPromises = newFiles.map(async (file) => {
        const fileStartTime = Date.now()

        try {
          const sanitizedName = sanitizeFilename(file.name)
          const fileName = `${document.document_number}${document.version}_${sanitizedName}`
          const filePath = `${subdomain}/${document.document_number}${document.version}/${fileName}`

          const { error: uploadError } = await createServiceRoleClient().storage
            .from('documents')
            .upload(filePath, file)

          if (uploadError) {
            logger.info({
              msg: 'File Upload',
              fileName: sanitizedName,
              fileSize: file.size,
              documentId: document.id,
              userId,
              success: false,
              error: uploadError,
              duration: Date.now() - fileStartTime,
            })
            return null
          }

          await createServiceRoleClient()
            .schema('docs')
            .from('document_files')
            .insert({
              document_id: document.id,
              file_name: fileName,
              original_file_name: sanitizedName,
              file_path: filePath,
              file_size: file.size,
              mime_type: file.type,
              uploaded_by: user.id,
            })

          logger.info({
            msg: 'File Upload',
            fileName: sanitizedName,
            fileSize: file.size,
            documentId: document.id,
            userId,
            success: true,
            duration: Date.now() - fileStartTime,
          })

          return fileName
        } catch (error) {
          logError(error, {
            action: 'uploadFileOnUpdate',
            userId,
            documentId,
            fileName: file.name,
          })
          return null
        }
      })

      await Promise.all(uploadPromises)
    }

    // Create audit log entry
    await createServiceRoleClient()
      .schema('docs')
      .from('audit_log')
      .insert({
        document_id: documentId,
        action: 'updated',
        performed_by: user.id,
        performed_by_email: user.email,
        tenant_id: document.tenant_id,
        details: { changes: { title, description, project_code } },
      })

    revalidatePath(`/documents/${documentId}`)
    revalidatePath('/documents')

    const duration = Date.now() - startTime
    logServerAction('updateDocument', {
      userId,
      documentId,
      success: true,
      duration,
    })

    return { success: true }
  } catch (error) {
    const duration = Date.now() - startTime
    logError(error, { action: 'updateDocument', userId, documentId, duration })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update document'
    }
  }
}

// ==========================================
// Action: Delete Document
// ==========================================

export async function deleteDocument(
  documentId: string,
  /**
   * Two-phase delete flow:
   *   - Pass `false` (default) on the first call to get reference info without deleting.
   *     If references exist the action returns early with `requiresAcknowledgement: true`.
   *   - Pass `true` after the user has confirmed they want to proceed.
   */
  acknowledgedRefs: boolean = false
) {
  const startTime = Date.now()
  let userId: string | undefined

  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      logger.warn('Delete document attempted without authentication', { authError, documentId })
      return { success: false, error: 'Not authenticated' }
    }

    userId = user.id

    // Check write permission
    const { allowed, role } = await checkWritePermission(supabase, userId!)
    if (!allowed) {
      logger.warn('User without write permission attempted to delete document', {
        userId,
        role,
        documentId,
        action: 'deleteDocument'
      })
      return {
        success: false,
        error: role === 'Read Only'
          ? 'Read-only users cannot delete documents'
          : 'Your account is deactivated. Please contact an administrator.'
      }
    }

    logger.info('Deleting document', { userId, documentId, action: 'deleteDocument' })

    // Get document to check ownership and status
    const { data: document, error: getError } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .select('*, document_files(*)')
      .eq('id', documentId)
      .single()

    if (getError || !document) {
      logger.error('Document not found for deletion', { userId, documentId, error: getError })
      return { success: false, error: 'Document not found' }
    }

    // Check if user is master admin (for cross-tenant operations)
    const sharedClient2 = createSharedClient()
      const { data: userData } = await sharedClient2
        .schema('shared')
        .from('users')
        .select('is_master_admin')
        .eq('id', user.id)
        .single()

    const isMasterAdmin = userData?.is_master_admin || false

    // Authorization: document creator OR master admin
    if (document.created_by !== user.id && !isMasterAdmin) {
      logger.warn('Unauthorized document deletion attempt', {
        userId,
        documentId,
        ownerId: document.created_by,
        isMasterAdmin,
      })
      return { success: false, error: 'Not authorized' }
    }

    if (document.status !== 'Draft') {
      logger.warn('Attempt to delete non-draft document', {
        userId,
        documentId,
        status: document.status,
      })
      return {
        success: false,
        error: 'Only Draft documents can be deleted'
      }
    }

    // BUSINESS RULE: Document numbers are permanent once created
    // A draft can only be deleted if there's a Released or Obsolete version
    const { data: otherVersions, error: versionCheckError } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .select('id, version, status')
      .eq('document_number', document.document_number)
      .eq('tenant_id', document.tenant_id)
      .neq('id', documentId)

    if (versionCheckError) {
      logger.error('Error checking for other versions', {
        documentId,
        documentNumber: document.document_number,
        error: versionCheckError,
      })
      return { success: false, error: 'Failed to verify document versions' }
    }

    // Check if there's at least one Released or Obsolete version
    const hasReleasedVersion = otherVersions?.some(v =>
      v.status === 'Released' || v.status === 'Obsolete'
    )

    if (!hasReleasedVersion) {
      logger.warn('Attempt to delete only version of document', {
        userId,
        documentId,
        documentNumber: document.document_number,
        version: document.version,
        otherVersionCount: otherVersions?.length || 0,
      })
      return {
        success: false,
        error: 'Cannot delete the only version of a document. Document numbers are permanent once created. Please release this version first, or create and release a new version before deleting this draft.'
      }
    }

    logger.info('Deleting draft - other versions exist', {
      documentId,
      documentNumber: document.document_number,
      version: document.version,
      otherVersionCount: otherVersions.length,
    })

    // ── BaselineReqs integration: check for linked requirements ────────────
    // Do this before any destructive work. Fail open — if the integration is
    // not configured or BaselineReqs is down, proceed normally.
    const subdomain = await getCurrentSubdomain()
    let refsData: BaselineReqsLinksResult | null = null

    if (subdomain) {
      refsData = await checkBaselineReqsReferences(subdomain, documentId)
    }

    if (refsData?.linked && !acknowledgedRefs) {
      // First call: surface the warning so the client can show the confirm dialog
      return {
        success: false,
        requiresAcknowledgement: true,
        refs: refsData,
        error: `This document is referenced by ${refsData.count} item${refsData.count === 1 ? '' : 's'} in BaselineReqs. Deleting it will mark those links as broken.`,
      }
    }
    // ── End BaselineReqs check ─────────────────────────────────────────────

    // Delete all files from storage
    if (document.document_files && document.document_files.length > 0) {
      const filePaths = document.document_files.map((f: any) => f.file_path)

      logger.info('Deleting files from storage', {
        userId,
        documentId,
        fileCount: filePaths.length,
      })

      const { error: storageError } = await createServiceRoleClient().storage
        .from('documents')
        .remove(filePaths)

      if (storageError) {
        logError(storageError, {
          action: 'deleteDocumentFiles',
          userId,
          documentId,
          fileCount: filePaths.length,
        })
      } else {
        logger.info('Files deleted from storage', {
          userId,
          documentId,
          fileCount: filePaths.length,
        })
      }
    }

    // Use service role client for deletion (bypasses RLS for master admins)
    const supabaseAdmin = createServiceRoleClient()

    // Create audit log for the deletion BEFORE deleting the document
    await supabaseAdmin
      .schema('docs')
      .from('audit_log')
      .insert({
        document_id: documentId,
        action: 'document_deleted',
        performed_by: user.id,
        performed_by_email: user.email,
        tenant_id: document.tenant_id,
        details: {
          document_number: document.document_number,
          version: document.version,
          title: document.title,
          file_count: document.document_files?.length || 0,
        }
      })

    // Delete document (cascade will remove document_files records)
    // Note: audit_log entries will have document_id set to NULL (preserved via ON DELETE SET NULL)
    const { error: deleteError } = await supabaseAdmin
      .schema('docs')
      .from('documents')
      .delete()
      .eq('id', documentId)

    if (deleteError) {
      logError(deleteError, { action: 'deleteDocument', userId, documentId })
      return { success: false, error: 'Failed to delete document' }
    }

    logger.info('Document deleted successfully', {
      userId,
      documentId,
      documentNumber: `${document.document_number}${document.version}`,
    })

    revalidatePath('/documents')
    revalidatePath('/dashboard')

    // ── BaselineReqs integration: mark any links to this doc as broken ─────
    if (subdomain) {
      // Fire-and-forget — don't await in the hot path; failures are logged inside
      markBaselineReqsLinksBroken(subdomain, documentId)
    }
    // ── End BaselineReqs ───────────────────────────────────────────────────

    const duration = Date.now() - startTime
    logServerAction('deleteDocument', {
      userId,
      documentId,
      success: true,
      duration,
    })

    return {
      success: true,
      message: 'Document deleted successfully'
    }
  } catch (error) {
    const duration = Date.now() - startTime
    logError(error, { action: 'deleteDocument', userId, documentId, duration })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete document'
    }
  }
}

// ==========================================
// Action: Delete File
// ==========================================

export async function deleteFile(documentId: string, fileId: string) {
  const startTime = Date.now()
  let userId: string | undefined

  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      logger.warn('Delete file attempted without authentication', { authError, documentId, fileId })
      return { success: false, error: 'Not authenticated' }
    }

    userId = user.id
    logger.info('Deleting file', { userId, documentId, fileId, action: 'deleteFile' })

    // Get file and document
    const { data: file, error: fileError } = await createServiceRoleClient()
      .schema('docs')
      .from('document_files')
      .select('*, document:documents(id, status, created_by, tenant_id)')
      .eq('id', fileId)
      .eq('document_id', documentId)
      .single()

    if (fileError || !file) {
      logger.error('File not found for deletion', { userId, documentId, fileId, error: fileError })
      return { success: false, error: 'File not found' }
    }

    const document = file.document as any

    if (document.created_by !== user.id) {
      logger.warn('Unauthorized file deletion attempt', {
        userId,
        documentId,
        fileId,
        ownerId: document.created_by,
      })
      return { success: false, error: 'Not authorized' }
    }

    if (document.status !== 'Draft') {
      logger.warn('Attempt to delete file from non-draft document', {
        userId,
        documentId,
        fileId,
        status: document.status,
      })
      return { success: false, error: 'Can only delete files from Draft documents' }
    }

    // Delete from storage
    const { error: storageError } = await createServiceRoleClient().storage
      .from('documents')
      .remove([file.file_path])

    if (storageError) {
      logError(storageError, {
        action: 'deleteFileFromStorage',
        userId,
        documentId,
        fileId,
        filePath: file.file_path,
      })
    }

    // Delete file record
    const { error: deleteError } = await createServiceRoleClient()
      .schema('docs')
      .from('document_files')
      .delete()
      .eq('id', fileId)

    if (deleteError) {
      logError(deleteError, { action: 'deleteFileRecord', userId, documentId, fileId })
      return { success: false, error: 'Failed to delete file' }
    }

    logger.info({
      msg: 'File Delete',
      fileName: file.file_name,
      fileSize: file.file_size,
      documentId: documentId,
      userId,
      success: true,
      duration: Date.now() - startTime,
    })

    // Create audit log entry
    const { error: auditError } = await createServiceRoleClient()
      .schema('docs')
      .from('audit_log')
      .insert({
        document_id: documentId,
        action: 'file_deleted',
        performed_by: user.id,
        performed_by_email: user.email,
        tenant_id: document.tenant_id,
        details: {
          file_id: fileId,
          file_name: file.file_name,
          file_size: file.file_size,
        },
      })

    if (auditError) {
      logger.error('Failed to create audit log for file deletion', {
        userId,
        documentId,
        fileId,
        error: auditError,
        tenantId: document.tenant_id
      })
    } else {
      logger.info('Audit log created for file deletion', {
        userId,
        documentId,
        fileId,
        action: 'file_deleted'
      })
    }

    revalidatePath(`/documents/${documentId}`)

    const duration = Date.now() - startTime
    logServerAction('deleteFile', {
      userId,
      documentId,
      fileId,
      success: true,
      duration,
    })

    return { success: true }
  } catch (error) {
    const duration = Date.now() - startTime
    logError(error, { action: 'deleteFile', userId, documentId, fileId, duration })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete file'
    }
  }
}

// ==========================================
// Action: Release Document
// ==========================================

export async function releaseDocument(documentId: string) {
  const startTime = Date.now()
  let userId: string | undefined

  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      logger.warn('Release document attempted without authentication', { authError, documentId })
      return { success: false, error: 'Not authenticated' }
    }

    userId = user.id
    logger.info('Releasing document', { userId, documentId, action: 'releaseDocument' })

    // Get document with approvers count
    const { data: document, error: getError } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .select('*, approvers:approvers(count)')
      .eq('id', documentId)
      .single()

    if (getError || !document) {
      logger.error('Document not found for release', { userId, documentId, error: getError })
      return { success: false, error: 'Document not found' }
    }

    if (document.created_by !== user.id) {
      logger.warn('Unauthorized document release attempt', {
        userId,
        documentId,
        ownerId: document.created_by,
      })
      return { success: false, error: 'Not authorized' }
    }

    if (document.status !== 'Draft') {
      logger.warn('Attempt to release non-draft document', {
        userId,
        documentId,
        status: document.status,
      })
      return { success: false, error: 'Only Draft documents can be released' }
    }

    if (document.is_production) {
      logger.warn('Attempt to directly release production document', {
        userId,
        documentId,
      })
      return {
        success: false,
        error: 'Production documents require approval workflow'
      }
    }

    // Check if there are approvers - if yes, must use submitForApproval instead
    const approverCount = document.approvers?.[0]?.count || 0
    if (approverCount > 0) {
      logger.warn('Attempt to release document with approvers', {
        userId,
        documentId,
        approverCount,
      })
      return {
        success: false,
        error: 'This document has approvers assigned. Use "Submit for Approval" instead of "Release".'
      }
    }

    // Update document to Released - use service role client as RLS might block status changes
    const supabaseAdmin = createServiceRoleClient()
    const { error: updateError } = await supabaseAdmin
      .schema('docs')
      .from('documents')
      .update({
        status: 'Released',
        released_at: new Date().toISOString(),
        released_by: user.id,
      })
      .eq('id', documentId)

    if (updateError) {
      logError(updateError, { action: 'releaseDocument', userId, documentId })
      return { success: false, error: 'Failed to release document' }
    }

    logger.info('Document released successfully', {
      userId,
      documentId,
      documentNumber: `${document.document_number}${document.version}`,
    })

    // Handle obsolescence: make immediate predecessor obsolete
    // Get the immediate predecessor version
    const { getImmediatePredecessor } = await import('./versions')
    const predecessorResult = await getImmediatePredecessor(
      document.document_number,
      document.version
    )

    if (predecessorResult.success && predecessorResult.data) {
      const predecessor = predecessorResult.data

      // Only obsolete if predecessor is Released
      if (predecessor.status === 'Released') {
        logger.info('Obsoleting predecessor version', {
          userId,
          documentId,
          predecessorId: predecessor.id,
          predecessorVersion: predecessor.version,
        })

        await supabaseAdmin
          .schema('docs')
          .from('documents')
          .update({ status: 'Obsolete' })
          .eq('id', predecessor.id)

        // Log obsolescence
        await supabaseAdmin
          .schema('docs')
          .from('audit_log')
          .insert({
            document_id: predecessor.id,
            action: 'document_obsoleted',
            performed_by: user.id,
            performed_by_email: user.email,
            tenant_id: predecessor.tenant_id,
            details: {
              document_number: `${predecessor.document_number}${predecessor.version}`,
              obsoleted_by_version: document.version,
            },
          })
      }
    }

    // Create audit log entry
    await supabaseAdmin
      .schema('docs')
      .from('audit_log')
      .insert({
        document_id: documentId,
        action: 'released',
        performed_by: user.id,
        performed_by_email: user.email,
        tenant_id: document.tenant_id,
        details: {
          document_number: `${document.document_number}${document.version}`
        },
      })

    revalidatePath(`/documents/${documentId}`)
    revalidatePath('/documents')
    revalidatePath('/dashboard')

    const duration = Date.now() - startTime
    logServerAction('releaseDocument', {
      userId,
      documentId,
      success: true,
      duration,
    })

    // Send release notification to creator
    try {
      await sendDocumentReleasedEmail(document.created_by, {
        documentNumber: document.document_number,
        documentVersion: document.version,
        documentTitle: document.title,
        documentId: document.id
      })
      logger.info('Sent release email to creator', { documentId, creatorId: document.created_by })
    } catch (emailError) {
      logger.error('Failed to send release email', { documentId, error: emailError })
    }

    return { success: true }
  } catch (error) {
    const duration = Date.now() - startTime
    logError(error, { action: 'releaseDocument', userId, documentId, duration })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to release document'
    }
  }
}
