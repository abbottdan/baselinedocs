// app/actions/document-types.ts
'use server'

import { createClient , createSharedClient} from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logger, logServerAction, logError, logDatabaseQuery } from '@/lib/logger'
import { sanitizeString } from '@/lib/security/sanitize'
import { getSubdomainTenantId } from '@/lib/tenant'
import { 
  documentTypeCreateSchema, 
  documentTypeUpdateSchema,
  uuidSchema 
} from '@/lib/validation/schemas'

// Type export for components
export type DocumentType = {
  id: string
  name: string
  prefix: string
  description: string | null
  is_active: boolean
  next_number: number
  created_at: string
  updated_at: string
}

/**
 * Create a new document type
 * Admin only - creates new document type with validation
 */
export async function createDocumentType(data: { name: string; prefix: string; description?: string; is_active?: boolean }) {
  const startTime = Date.now()
  const supabase = await createClient()
  
  try {
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError || !user) {
      logger.warn('Unauthorized document type creation attempt', { error: userError?.message })
      return { 
        success: false, 
        error: { message: 'You must be logged in to create document types' } 
      }
    }

    const userId = user.id
    const userEmail = user.email

    // Check admin status
          const sharedClient = createSharedClient()
      const { data: _su } = await sharedClient
        .schema('shared').from('users')
        .select('is_master_admin, tenant_id')
        .eq('id', user.id).single()
      let _isAdmin = _su?.is_master_admin ?? false
      if (_su && !_su.is_master_admin) {
        const { data: rr } = await supabase
          .schema('docs').from('user_roles')
          .select('role').eq('user_id', user.id)
          .eq('tenant_id', _su.tenant_id).single()
        _isAdmin = ['tenant_admin','master_admin'].includes(rr?.role ?? '')
      }
      const userData = { is_admin: _isAdmin, tenant_id: _su?.tenant_id, email: _su?.email ?? user.email }

    if (adminCheckError || !userData?.is_admin) {
      logger.warn('Non-admin attempted document type creation', { 
        userId, 
        userEmail,
        isAdmin: userData?.is_admin 
      })
      return { 
        success: false, 
        error: { message: 'Only administrators can create document types' } 
      }
    }

    // Get tenant from CURRENT SUBDOMAIN (not user's home tenant)
    const tenantId = await getSubdomainTenantId()

    if (!tenantId) {
      logger.error('Invalid tenant subdomain', { userId, userEmail })
      return { 
        success: false, 
        error: { message: 'Invalid tenant context' } 
      }
    }

    // Validate input data
    const rawData = {
      name: data.name,
      prefix: data.prefix,
      description: data.description || null,
      is_active: data.is_active ?? true
    }

    const validation = documentTypeCreateSchema.safeParse(rawData)
    
    if (!validation.success) {
      const firstError = validation.error.issues[0]
      logger.warn('Document type creation validation failed', { 
        userId, 
        userEmail,
        errors: validation.error.issues,
        rawData: { ...rawData, description: rawData.description ? '[PROVIDED]' : null }
      })
      return { 
        success: false, 
        error: {
          field: firstError.path[0] as string,
          message: firstError.message
        }
      }
    }

    const validatedData = validation.data

    // Sanitize text inputs
    const sanitizedData = {
      name: sanitizeString(validatedData.name),
      prefix: validatedData.prefix.toUpperCase(), // Already validated as uppercase letters
      description: validatedData.description ? sanitizeString(validatedData.description) : null,
      is_active: validatedData.is_active
    }

    logger.info('Creating document type', {
      userId,
      userEmail,
      documentType: sanitizedData.name,
      prefix: sanitizedData.prefix,
      tenantId
    })

    // Check for duplicate prefix within this tenant
    const { data: existingType, error: checkError } = await supabase
      .from('document_types')
      .select('id, prefix')
      .eq('prefix', sanitizedData.prefix)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (checkError) {
      logger.error('Database error checking for duplicate prefix', {
        userId,
        prefix: sanitizedData.prefix,
        tenantId,
        error: checkError
      })
      throw checkError
    }

    if (existingType) {
      logger.warn('Duplicate prefix attempted', {
        userId,
        userEmail,
        prefix: sanitizedData.prefix,
        tenantId,
        existingTypeId: existingType.id
      })
      return { 
        success: false, 
        error: { 
          field: 'prefix',
          message: `Prefix "${sanitizedData.prefix}" is already in use` 
        }
      }
    }

    // Insert new document type
    const { data: newType, error: insertError } = await supabase
      .from('document_types')
      .insert({
        name: sanitizedData.name,
        prefix: sanitizedData.prefix,
        description: sanitizedData.description,
        is_active: sanitizedData.is_active,
        tenant_id: tenantId,  // FIXED: Include tenant_id for RLS
        next_number: 1 // Start sequential numbering at 1
      })
      .select()
      .single()

    if (insertError) {
      logger.error('Failed to insert document type', {
        userId,
        userEmail,
        tenantId,
        error: insertError,
        data: sanitizedData
      })
      throw insertError
    }

    const duration = Date.now() - startTime
    
    logger.info('Document type created successfully', {
      userId,
      userEmail,
      tenantId,
      documentTypeId: newType.id,
      name: newType.name,
      prefix: newType.prefix,
      duration
    })

    logServerAction('createDocumentType', {
      userId,
      userEmail,
      tenantId,
      documentTypeId: newType.id,
      prefix: newType.prefix,
      duration,
      success: true
    })

    revalidatePath('/document-types')
    revalidatePath('/admin/document-types')
    
    return { 
      success: true, 
      data: newType 
    }

  } catch (error) {
    const duration = Date.now() - startTime
    
    logError(error, {
      action: 'createDocumentType',
      userId: (await supabase.auth.getUser()).data.user?.id,
      duration
    })

    return { 
      success: false, 
      error: { message: error instanceof Error ? error.message : 'Failed to create document type' } 
    }
  }
}

/**
 * Update an existing document type
 * Admin only - updates document type with validation
 */
export async function updateDocumentType(id: string, data: { name: string; description?: string; is_active?: boolean }) {
  const startTime = Date.now()
  const supabase = await createClient()
  
  try {
    // Validate ID
    const idValidation = uuidSchema.safeParse(id)
    if (!idValidation.success) {
      logger.warn('Invalid document type ID for update', { providedId: id })
      return { success: false, error: { message: 'Invalid document type ID' } }
    }

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError || !user) {
      logger.warn('Unauthorized document type update attempt', { error: userError?.message })
      return { 
        success: false, 
        error: { message: 'You must be logged in to update document types' } 
      }
    }

    const userId = user.id
    const userEmail = user.email

    // Check admin status
          const sharedClient = createSharedClient()
      const { data: _su } = await sharedClient
        .schema('shared').from('users')
        .select('is_master_admin, tenant_id')
        .eq('id', user.id).single()
      let _isAdmin = _su?.is_master_admin ?? false
      if (_su && !_su.is_master_admin) {
        const { data: rr } = await supabase
          .schema('docs').from('user_roles')
          .select('role').eq('user_id', user.id)
          .eq('tenant_id', _su.tenant_id).single()
        _isAdmin = ['tenant_admin','master_admin'].includes(rr?.role ?? '')
      }
      const userData = { is_admin: _isAdmin, tenant_id: _su?.tenant_id, email: _su?.email ?? user.email }

    if (adminCheckError || !userData?.is_admin) {
      logger.warn('Non-admin attempted document type update', { 
        userId, 
        userEmail,
        documentTypeId: id,
        isAdmin: userData?.is_admin 
      })
      return { 
        success: false, 
        error: { message: 'Only administrators can update document types' } 
      }
    }

    // Validate input data
    const rawData = {
      name: data.name,
      description: data.description || null,
      is_active: data.is_active ?? true
    }

    const validation = documentTypeUpdateSchema.safeParse(rawData)
    
    if (!validation.success) {
      const firstError = validation.error.issues[0]
      logger.warn('Document type update validation failed', { 
        userId,
        userEmail,
        documentTypeId: id,
        errors: validation.error.issues
      })
      return { 
        success: false, 
        error: {
          field: firstError.path[0] as string,
          message: firstError.message
        }
      }
    }

    const validatedData = validation.data

    // Sanitize text inputs
    const sanitizedData = {
      name: sanitizeString(validatedData.name),
      description: validatedData.description ? sanitizeString(validatedData.description) : null,
      is_active: validatedData.is_active
    }

    logger.info('Updating document type', {
      userId,
      userEmail,
      documentTypeId: id,
      updates: sanitizedData
    })

    // Get current document type to check for documents
    const { data: currentType, error: fetchError } = await supabase
      .from('document_types')
      .select('prefix, name')
      .eq('id', id)
      .single()

    if (fetchError || !currentType) {
      logger.error('Document type not found for update', {
        userId,
        documentTypeId: id,
        error: fetchError
      })
      return { 
        success: false, 
        error: { message: 'Document type not found' } 
      }
    }

    // Update document type
    const { data: updatedType, error: updateError } = await supabase
      .from('document_types')
      .update(sanitizedData)
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      logger.error('Failed to update document type', {
        userId,
        userEmail,
        documentTypeId: id,
        error: updateError
      })
      throw updateError
    }

    const duration = Date.now() - startTime
    
    logger.info('Document type updated successfully', {
      userId,
      userEmail,
      documentTypeId: id,
      name: updatedType.name,
      changes: sanitizedData,
      duration
    })

    logServerAction('updateDocumentType', {
      userId,
      userEmail,
      documentTypeId: id,
      duration,
      success: true
    })

    revalidatePath('/document-types')
    
    return { 
      success: true, 
      data: updatedType 
    }

  } catch (error) {
    const duration = Date.now() - startTime
    
    logError(error, {
      action: 'updateDocumentType',
      documentTypeId: id,
      userId: (await supabase.auth.getUser()).data.user?.id,
      duration
    })

    return { 
      success: false, 
      error: { message: error instanceof Error ? error.message : 'Failed to update document type' } 
    }
  }
}

/**
 * Delete a document type
 * Admin only - can only delete if no documents use this type
 */
export async function deleteDocumentType(id: string) {
  const startTime = Date.now()
  const supabase = await createClient()
  
  try {
    // Validate ID
    const idValidation = uuidSchema.safeParse(id)
    if (!idValidation.success) {
      logger.warn('Invalid document type ID for deletion', { providedId: id })
      return { success: false, error: { message: 'Invalid document type ID' } }
    }

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError || !user) {
      logger.warn('Unauthorized document type deletion attempt', { error: userError?.message })
      return { 
        success: false, 
        error: { message: 'You must be logged in to delete document types' } 
      }
    }

    const userId = user.id
    const userEmail = user.email

    // Check admin status
          const sharedClient = createSharedClient()
      const { data: _su } = await sharedClient
        .schema('shared').from('users')
        .select('is_master_admin, tenant_id')
        .eq('id', user.id).single()
      let _isAdmin = _su?.is_master_admin ?? false
      if (_su && !_su.is_master_admin) {
        const { data: rr } = await supabase
          .schema('docs').from('user_roles')
          .select('role').eq('user_id', user.id)
          .eq('tenant_id', _su.tenant_id).single()
        _isAdmin = ['tenant_admin','master_admin'].includes(rr?.role ?? '')
      }
      const userData = { is_admin: _isAdmin, tenant_id: _su?.tenant_id, email: _su?.email ?? user.email }

    if (adminCheckError || !userData?.is_admin) {
      logger.warn('Non-admin attempted document type deletion', { 
        userId,
        userEmail,
        documentTypeId: id,
        isAdmin: userData?.is_admin 
      })
      return { 
        success: false, 
        error: { message: 'Only administrators can delete document types' } 
      }
    }

    logger.info('Attempting document type deletion', {
      userId,
      userEmail,
      documentTypeId: id
    })

    // Check if any documents use this type
    const { data: documents, error: checkError } = await supabase
      .from('documents')
      .select('id')
      .eq('document_type_id', id)
      .limit(1)

    if (checkError) {
      logger.error('Error checking for documents using type', {
        userId,
        documentTypeId: id,
        error: checkError
      })
      throw checkError
    }

    if (documents && documents.length > 0) {
      logger.warn('Cannot delete document type with existing documents', {
        userId,
        userEmail,
        documentTypeId: id,
        documentCount: documents.length
      })
      return { 
        success: false, 
        error: { message: 'Cannot delete document type that has documents. Please deactivate it instead.' } 
      }
    }

    // Get document type info before deletion for logging
    const { data: typeToDelete } = await supabase
      .from('document_types')
      .select('name, prefix')
      .eq('id', id)
      .single()

    // Delete document type
    const { error: deleteError } = await supabase
      .from('document_types')
      .delete()
      .eq('id', id)

    if (deleteError) {
      logger.error('Failed to delete document type', {
        userId,
        userEmail,
        documentTypeId: id,
        error: deleteError
      })
      throw deleteError
    }

    const duration = Date.now() - startTime
    
    logger.info('Document type deleted successfully', {
      userId,
      userEmail,
      documentTypeId: id,
      name: typeToDelete?.name,
      prefix: typeToDelete?.prefix,
      duration
    })

    logServerAction('deleteDocumentType', {
      userId,
      userEmail,
      documentTypeId: id,
      name: typeToDelete?.name,
      prefix: typeToDelete?.prefix,
      duration,
      success: true
    })

    revalidatePath('/document-types')
    
    return { success: true }

  } catch (error) {
    const duration = Date.now() - startTime
    
    logError(error, {
      action: 'deleteDocumentType',
      documentTypeId: id,
      userId: (await supabase.auth.getUser()).data.user?.id,
      duration
    })

    return { 
      success: false, 
      error: { message: error instanceof Error ? error.message : 'Failed to delete document type' } 
    }
  }
}

/**
 * Toggle document type active status
 * Admin only - quick action to activate/deactivate types
 */
export async function toggleDocumentTypeStatus(id: string) {
  const startTime = Date.now()
  const supabase = await createClient()
  
  try {
    // Validate inputs
    const idValidation = uuidSchema.safeParse(id)
    if (!idValidation.success) {
      logger.warn('Invalid document type ID for status toggle', { providedId: id })
      return { success: false, error: { message: 'Invalid document type ID' } }
    }

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError || !user) {
      logger.warn('Unauthorized status toggle attempt', { error: userError?.message })
      return { 
        success: false, 
        error: { message: 'You must be logged in to modify document types' } 
      }
    }

    const userId = user.id
    const userEmail = user.email

    // Check admin status
          const sharedClient = createSharedClient()
      const { data: _su } = await sharedClient
        .schema('shared').from('users')
        .select('is_master_admin, tenant_id')
        .eq('id', user.id).single()
      let _isAdmin = _su?.is_master_admin ?? false
      if (_su && !_su.is_master_admin) {
        const { data: rr } = await supabase
          .schema('docs').from('user_roles')
          .select('role').eq('user_id', user.id)
          .eq('tenant_id', _su.tenant_id).single()
        _isAdmin = ['tenant_admin','master_admin'].includes(rr?.role ?? '')
      }
      const userData = { is_admin: _isAdmin, tenant_id: _su?.tenant_id, email: _su?.email ?? user.email }

    if (adminCheckError || !userData?.is_admin) {
      logger.warn('Non-admin attempted status toggle', { 
        userId,
        userEmail,
        documentTypeId: id,
        isAdmin: userData?.is_admin 
      })
      return { 
        success: false, 
        error: { message: 'Only administrators can modify document types' } 
      }
    }

    // Get current document type info
    const { data: currentType } = await supabase
      .from('document_types')
      .select('name, prefix, is_active')
      .eq('id', id)
      .single()
    
    if (!currentType) {
      return { success: false, error: { message: "Document type not found" } }
    }
    
    // Toggle the current status
    const newStatus = !currentType.is_active

    logger.info('Toggling document type status', {
      userId,
      userEmail,
      documentTypeId: id,
      previousStatus: currentType.is_active,
      newStatus: newStatus ? 'active' : 'inactive'
    })

    // Update status
    const { data: updatedType, error: updateError } = await supabase
      .from('document_types')
      .update({ is_active: newStatus })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      logger.error('Failed to toggle document type status', {
        userId,
        userEmail,
        documentTypeId: id,
        error: updateError
      })
      throw updateError
    }

    const duration = Date.now() - startTime
    
    logger.info('Document type status toggled successfully', {
      userId,
      userEmail,
      documentTypeId: id,
      name: updatedType.name,
      prefix: updatedType.prefix,
      previousStatus: currentType?.is_active,
      newStatus: newStatus,
      duration
    })

    logServerAction('toggleDocumentTypeStatus', {
      userId,
      userEmail,
      documentTypeId: id,
      newStatus: newStatus ? 'active' : 'inactive',
      duration,
      success: true
    })

    revalidatePath('/document-types')
    
    return { 
      success: true, 
      data: updatedType 
    }

  } catch (error) {
    const duration = Date.now() - startTime
    
    logError(error, {
      action: 'toggleDocumentTypeStatus',
      documentTypeId: id,
      userId: (await supabase.auth.getUser()).data.user?.id,
      duration
    })

    return { 
      success: false, 
      error: { message: error instanceof Error ? error.message : 'Failed to toggle status' } 
    }
  }
}

/**
 * Get a single document type by ID
 */
export async function getDocumentType(id: string) {
  const supabase = await createClient()
  
  try {
    const { data, error } = await supabase
      .from('document_types')
      .select('*')
      .eq('id', id)
      .single()
    
    if (error) {
      logger.error('Failed to fetch document type', { id, error })
      return { success: false, error: { message: error.message } }
    }
    
    return { success: true, data }
  } catch (error) {
    logger.error('Error in getDocumentType', { id, error })
    return { 
      success: false, 
      error: { message: error instanceof Error ? error.message : 'Failed to fetch document type' } 
    }
  }
}

/**
 * Get all document types
 * @param activeOnly - If true, only return active types. If false, return all.
 */
export async function getDocumentTypes(activeOnly: boolean = true) {
  const supabase = await createClient()
  
  try {
    // Get tenant from CURRENT SUBDOMAIN
    const tenantId = await getSubdomainTenantId()
    
    if (!tenantId) {
      logger.error('Invalid tenant subdomain in getDocumentTypes')
      return { success: false, error: { message: 'Invalid tenant context' }, data: [] }
    }

    let query = supabase
      .from('document_types')
      .select('*')
      .eq('tenant_id', tenantId)  // ✅ Filter by subdomain's tenant
      .order('name')
    
    // Filter by active status if requested
    if (activeOnly) {
      query = query.eq('is_active', true)
    }
    
    const { data, error } = await query
    
    if (error) {
      logger.error('Failed to fetch document types', { activeOnly, tenantId, error })
      return { success: false, error: { message: error.message }, data: [] }
    }
    
    return { success: true, data: data || [] }
  } catch (error) {
    logger.error('Error in getDocumentTypes', { activeOnly, error })
    return { 
      success: false, 
      error: { message: error instanceof Error ? error.message : 'Failed to fetch document types' },
      data: []
    }
  }
}

/**
 * Reset document type counter to 1
 * Admin only - only allowed if no documents exist for this type
 */
export async function resetDocumentTypeCounter(documentTypeId: string) {
  const startTime = Date.now()
  const supabase = await createClient()
  
  try {
    // Validate UUID
    const validation = uuidSchema.safeParse(documentTypeId)
    if (!validation.success) {
      return { 
        success: false, 
        error: { message: 'Invalid document type ID' } 
      }
    }

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError || !user) {
      logger.warn('Unauthorized counter reset attempt', { documentTypeId })
      return { 
        success: false, 
        error: { message: 'You must be logged in to reset counters' } 
      }
    }

    const userId = user.id
    const userEmail = user.email

    // Check admin status
          const sharedClient = createSharedClient()
      const { data: _su } = await sharedClient
        .schema('shared').from('users')
        .select('is_master_admin, tenant_id')
        .eq('id', user.id).single()
      let _isAdmin = _su?.is_master_admin ?? false
      if (_su && !_su.is_master_admin) {
        const { data: rr } = await supabase
          .schema('docs').from('user_roles')
          .select('role').eq('user_id', user.id)
          .eq('tenant_id', _su.tenant_id).single()
        _isAdmin = ['tenant_admin','master_admin'].includes(rr?.role ?? '')
      }
      const userData = { is_admin: _isAdmin, tenant_id: _su?.tenant_id, email: _su?.email ?? user.email }

    if (adminCheckError || !userData?.is_admin) {
      logger.warn('Non-admin attempted counter reset', { 
        userId, 
        userEmail,
        documentTypeId 
      })
      return { 
        success: false, 
        error: { message: 'Only administrators can reset counters' } 
      }
    }

    // Get tenant from CURRENT SUBDOMAIN
    const tenantId = await getSubdomainTenantId()

    if (!tenantId) {
      logger.error('Invalid tenant subdomain', { userId, userEmail })
      return { 
        success: false, 
        error: { message: 'Invalid tenant context' } 
      }
    }

    // Get document type to verify ownership
    const { data: docType, error: docTypeError } = await supabase
      .from('document_types')
      .select('id, name, prefix, tenant_id')
      .eq('id', documentTypeId)
      .eq('tenant_id', tenantId)
      .single()

    if (docTypeError || !docType) {
      logger.warn('Document type not found for reset', { 
        documentTypeId, 
        tenantId,
        error: docTypeError 
      })
      return { 
        success: false, 
        error: { message: 'Document type not found' } 
      }
    }

    // Check if any documents exist for this type
    const { count, error: countError } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('document_type_id', documentTypeId)
      .eq('tenant_id', tenantId)

    if (countError) {
      logger.error('Failed to count documents', { 
        documentTypeId, 
        error: countError 
      })
      return { 
        success: false, 
        error: { message: 'Failed to check existing documents' } 
      }
    }

    if (count && count > 0) {
      logger.warn('Cannot reset counter - documents exist', { 
        documentTypeId, 
        documentCount: count,
        typeName: docType.name 
      })
      return { 
        success: false, 
        error: { 
          message: `Cannot reset counter. ${count} document(s) exist for this type. Delete all documents first.` 
        } 
      }
    }

    // Reset the counter to 1
    const { error: updateError } = await supabase
      .from('document_types')
      .update({ 
        next_number: 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentTypeId)
      .eq('tenant_id', tenantId)

    if (updateError) {
      logger.error('Failed to reset counter', { 
        documentTypeId, 
        error: updateError 
      })
      return { 
        success: false, 
        error: { message: 'Failed to reset counter' } 
      }
    }

    // Log the action
    logger.info('Document type counter reset', {
      documentTypeId,
      typeName: docType.name,
      prefix: docType.prefix,
      userId,
      userEmail,
      tenantId,
      duration: Date.now() - startTime
    })

    // Create audit log entry
    await supabase
      .from('audit_log')
      .insert({
        action: 'document_type_counter_reset',
        performed_by: userId,
        performed_by_email: userEmail,
        details: {
          document_type_id: documentTypeId,
          document_type_name: docType.name,
          prefix: docType.prefix,
          reset_to: 1
        },
        tenant_id: tenantId
      })

    // Revalidate the page
    revalidatePath('/admin/document-types')
    
    return { success: true }
  } catch (error) {
    logger.error('Error in resetDocumentTypeCounter', { 
      documentTypeId, 
      error 
    })
    return { 
      success: false, 
      error: { message: error instanceof Error ? error.message : 'Failed to reset counter' } 
    }
  }
}
