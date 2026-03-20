'use server'

import { createClient, createServiceRoleClient , createSharedClient} from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logger, logError, logServerAction } from '@/lib/logger'
import { addApproverSchema, removeApproverSchema, approveDocumentSchema, rejectDocumentSchema } from '@/lib/validation/schemas'
import { validateJSON } from '@/lib/validation/validate'
import { sanitizeString, sanitizeEmail } from '@/lib/security/sanitize'
import { 
  sendApprovalRequestEmail,
  sendApprovalCompleteEmail,
  sendDocumentRejectedEmail
} from '@/lib/email-notifications'

// ==========================================
// Types
// ==========================================

export type ApproverStatus = 'Pending' | 'Approved' | 'Rejected'

export interface Approver {
  id: string
  document_id: string
  user_id: string
  user_email: string
  status: ApproverStatus
  comments: string | null
  action_date: string | null
  created_at: string
}

// ==========================================
// Action: Add Approver to Document
// ==========================================

export async function addApprover(documentId: string, userId: string, userEmail: string) {
  const startTime = Date.now()
  let currentUserId: string | undefined

  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      logger.warn({ authError, documentId }, 'Add approver attempted without authentication')
      return { success: false, error: 'Not authenticated' }
    }

    currentUserId = user.id
    logger.info({ userId: currentUserId, documentId, approverId: userId, action: 'addApprover' }, 'Adding approver')

    // Validate input
    const validation = validateJSON(
      { document_id: documentId, user_id: userId, user_email: userEmail },
      addApproverSchema
    )

    if (!validation.success) {
      logger.warn('Add approver validation failed', {
        userId: currentUserId,
        documentId,
        error: validation.error,
      })
      return { success: false, error: validation.error }
    }

    // Sanitize email
    const cleanEmail = sanitizeEmail(userEmail)
    if (!cleanEmail) {
      return { success: false, error: 'Invalid email address' }
    }

    // Check document ownership and status
    const { data: document, error: docError } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .select('id, created_by, status, tenant_id')
      .eq('id', documentId)
      .single()

    if (docError || !document) {
      logger.error('Document not found for adding approver', {
        userId: currentUserId,
        documentId,
        error: docError,
      })
      return { success: false, error: 'Document not found' }
    }

    if (document.created_by !== user.id) {
      logger.warn('Unauthorized attempt to add approver', {
        userId: currentUserId,
        documentId,
        ownerId: document.created_by,
      })
      return { success: false, error: 'Only document creator can add approvers' }
    }

    if (document.status !== 'Draft') {
      logger.warn('Attempt to add approver to non-draft document', {
        userId: currentUserId,
        documentId,
        status: document.status,
      })
      return { success: false, error: 'Can only add approvers to Draft documents' }
    }

    // Check if approver already exists
    const { data: existing } = await createServiceRoleClient()
      .schema('docs')
      .from('approvers')
      .select('id')
      .eq('document_id', documentId)
      .eq('user_id', userId)
      .maybeSingle()

    if (existing) {
      logger.warn('Approver already exists', {
        userId: currentUserId,
        documentId,
        approverId: userId,
      })
      return { success: false, error: 'This user is already an approver' }
    }

    // Use service role client to bypass RLS (we've already verified permissions above)
    const supabaseAdmin = createServiceRoleClient()

    // Add approver
    const { error: insertError } = await supabaseAdmin
      .schema('docs')
      .from('approvers')
      .insert({
        document_id: documentId,
        user_id: userId,
        user_email: cleanEmail,
        status: 'Pending',
        tenant_id: document.tenant_id
      })

    if (insertError) {
      logError(insertError, {
        action: 'addApprover',
        userId: currentUserId,
        documentId,
        approverId: userId,
      })
      return { success: false, error: 'Failed to add approver' }
    }

    logger.info('Approver added successfully', {
      userId: currentUserId,
      documentId,
      approverId: userId,
      approverEmail: cleanEmail,
    })

    // Create audit log
    await supabaseAdmin
      .schema('docs')
      .from('audit_log')
      .insert({
        document_id: documentId,
        action: 'approver_added',
        performed_by: user.id,
        performed_by_email: user.email,
        details: { 
          approver_email: cleanEmail 
        },
        tenant_id: document.tenant_id
      })

    revalidatePath(`/documents/${documentId}`)
    
    const duration = Date.now() - startTime
    logServerAction('addApprover', {
      userId: currentUserId,
      documentId,
      success: true,
      duration,
    })

    return { success: true }
  } catch (error) {
    const duration = Date.now() - startTime
    logError(error, {
      action: 'addApprover',
      userId: currentUserId,
      documentId,
      duration,
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to add approver'
    }
  }
}

// ==========================================
// Action: Remove Approver from Document
// ==========================================

export async function removeApprover(documentId: string, approverId: string) {
  const startTime = Date.now()
  let userId: string | undefined

  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      logger.warn('Remove approver attempted without authentication', { authError, documentId, approverId })
      return { success: false, error: 'Not authenticated' }
    }

    userId = user.id
    logger.info('Removing approver', { userId, documentId, approverId, action: 'removeApprover' })

    // Validate input
    const validation = validateJSON(
      { document_id: documentId, approver_id: approverId },
      removeApproverSchema
    )

    if (!validation.success) {
      logger.warn('Remove approver validation failed', {
        userId,
        documentId,
        approverId,
        error: validation.error,
      })
      return { success: false, error: validation.error }
    }

    // Check document ownership and status
    const { data: document, error: docError } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .select('id, created_by, status')
      .eq('id', documentId)
      .single()

    if (docError || !document) {
      logger.error('Document not found for removing approver', {
        userId,
        documentId,
        error: docError,
      })
      return { success: false, error: 'Document not found' }
    }

    if (document.created_by !== user.id) {
      logger.warn('Unauthorized attempt to remove approver', {
        userId,
        documentId,
        approverId,
        ownerId: document.created_by,
      })
      return { success: false, error: 'Only document creator can remove approvers' }
    }

    if (document.status !== 'Draft') {
      logger.warn('Attempt to remove approver from non-draft document', {
        userId,
        documentId,
        approverId,
        status: document.status,
      })
      return { success: false, error: 'Can only remove approvers from Draft documents' }
    }

    // Get approver details before deleting (for audit log and verification)
    const { data: approver, error: approverError } = await createServiceRoleClient()
      .schema('docs')
      .from('approvers')
      .select('user_email, document_id, tenant_id')
      .eq('id', approverId)
      .eq('document_id', documentId)
      .maybeSingle()

    if (approverError) {
      logger.error('Error fetching approver for removal', {
        userId,
        documentId,
        approverId,
        error: approverError,
      })
      return { success: false, error: 'Failed to fetch approver' }
    }

    if (!approver) {
      logger.warn('Approver not found for removal', {
        userId,
        documentId,
        approverId,
      })
      return { success: false, error: 'Approver not found' }
    }

    // Remove approver - use regular client (RLS should allow creator to delete)
    const { error: deleteError } = await createServiceRoleClient()
      .schema('docs')
      .from('approvers')
      .delete()
      .eq('id', approverId)

    if (deleteError) {
      logError(deleteError, {
        action: 'removeApprover',
        userId,
        documentId,
        approverId,
      })
      return { success: false, error: 'Failed to remove approver' }
    }

    // Verify deletion succeeded
    const { data: stillExists } = await createServiceRoleClient()
      .schema('docs')
      .from('approvers')
      .select('id')
      .eq('id', approverId)
      .maybeSingle()

    if (stillExists) {
      logger.error('Approver still exists after delete attempt', {
        userId,
        documentId,
        approverId,
      })
      return { success: false, error: 'Failed to remove approver - still exists' }
    }

    logger.info('Approver removed successfully', {
      userId,
      documentId,
      approverId,
      approverEmail: approver.user_email,
    })

    // Create audit log
    await createServiceRoleClient()
      .schema('docs')
      .from('audit_log')
      .insert({
        document_id: documentId,
        action: 'approver_removed',
        performed_by: user.id,
        performed_by_email: user.email,
        tenant_id: approver.tenant_id,
        details: { 
          approver_email: approver.user_email 
        }
      })

    revalidatePath(`/documents/${documentId}`)
    revalidatePath('/documents')
    
    const duration = Date.now() - startTime
    logServerAction('removeApprover', {
      userId,
      documentId,
      approverId,
      success: true,
      duration,
    })

    return { success: true }
  } catch (error) {
    const duration = Date.now() - startTime
    logError(error, {
      action: 'removeApprover',
      userId,
      documentId,
      approverId,
      duration,
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to remove approver'
    }
  }
}

// ==========================================
// Action: Submit Document for Approval
// ==========================================

export async function submitForApproval(documentId: string) {
  const startTime = Date.now()
  let userId: string | undefined

  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      logger.warn('Submit for approval attempted without authentication', { authError, documentId })
      return { success: false, error: 'Not authenticated' }
    }

    userId = user.id
    logger.info('Submitting document for approval', { userId, documentId, action: 'submitForApproval' })

    // Get document with approvers count
    const { data: document, error: docError } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .select('*, approvers:approvers(count)')
      .eq('id', documentId)
      .single()

    if (docError || !document) {
      logger.error('Document not found for submission', {
        userId,
        documentId,
        error: docError,
      })
      return { success: false, error: 'Document not found' }
    }

    if (document.created_by !== user.id) {
      logger.warn('Unauthorized submission attempt', {
        userId,
        documentId,
        ownerId: document.created_by,
      })
      return { success: false, error: 'Not authorized' }
    }

    if (document.status !== 'Draft') {
      logger.warn('Attempt to submit non-draft document', {
        userId,
        documentId,
        status: document.status,
      })
      return { success: false, error: 'Only Draft documents can be submitted' }
    }

    // Check if there are approvers
    const approverCount = document.approvers?.[0]?.count || 0
    
    if (approverCount === 0) {
      logger.warn('Attempt to submit without approvers', {
        userId,
        documentId,
      })
      return { 
        success: false, 
        error: 'Cannot submit without approvers. Add at least one approver or use Release instead.' 
      }
    }

    // Update document status - use service role client as RLS blocks status changes
    const supabaseAdmin = createServiceRoleClient()
    const { error: updateError } = await supabaseAdmin
      .schema('docs')
      .from('documents')
      .update({ status: 'In Approval' })
      .eq('id', documentId)

    if (updateError) {
      logError(updateError, {
        action: 'submitForApproval',
        userId,
        documentId,
      })
      return { success: false, error: 'Failed to submit document' }
    }

    // Reset all approvers to Pending (important for resubmissions after rejection)
    await createServiceRoleClient()
      .schema('docs')
      .from('approvers')
      .update({
        status: 'Pending',
        comments: null,
        action_date: null
      })
      .eq('document_id', documentId)

    logger.info('Document submitted for approval', {
      userId,
      documentId,
      documentNumber: `${document.document_number}${document.version}`,
      approverCount,
    })

    // Log approval workflow event
    logger.info({msg: 'Approval Submitted', 
      documentId,
      documentNumber: `${document.document_number}${document.version}`,
      userId,
      approverCount,
    })

    // Create audit log
    await supabaseAdmin
      .schema('docs')
      .from('audit_log')
      .insert({
        document_id: documentId,
        version: document.version,
        action: 'submitted_for_approval',
        performed_by: user.id,
        performed_by_email: user.email,
        tenant_id: document.tenant_id,
        details: { 
          document_number: `${document.document_number}${document.version}`,
          approver_count: approverCount
        }
      })

    revalidatePath(`/documents/${documentId}`)
    revalidatePath('/documents')
    revalidatePath('/dashboard')
    
    const duration = Date.now() - startTime
    logServerAction('submitForApproval', {
      userId,
      documentId,
      approverCount,
      success: true,
      duration,
    })

    // Send email notifications to all approvers
    try {
      // Fetch approvers for this document
      const { data: approversList } = await createServiceRoleClient()
        .schema('docs')
        .from('approvers')
        .select('user_id, user_email')
        .eq('document_id', documentId)
      
      if (approversList && approversList.length > 0) {
        const sharedClient = createSharedClient()
          const { data: currentUser } = await sharedClient
            .schema('shared')
            .from('users')
            .select('email, full_name')
            .eq('id', user.id)
            .single()

        for (const approver of approversList) {
          await sendApprovalRequestEmail(approver.user_id, {
            documentNumber: document.document_number,
            documentVersion: document.version,
            documentTitle: document.title,
            documentId: document.id,
            submittedBy: currentUser?.full_name || currentUser?.email || 'Unknown'
          })
        }
        logger.info(`Sent approval request emails to ${approversList.length} approvers`, { documentId })
      }
    } catch (emailError) {
      // Log but don't fail - emails are best effort
      logger.error('Failed to send approval request emails', { documentId, error: emailError })
    }


    return { success: true }
  } catch (error) {
    const duration = Date.now() - startTime
    logError(error, {
      action: 'submitForApproval',
      userId,
      documentId,
      duration,
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to submit document'
    }
  }
}

// ==========================================
// Action: Approve Document
// ==========================================

export async function approveDocument(documentId: string, comments?: string) {
  const startTime = Date.now()
  let userId: string | undefined

  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      logger.warn('Approve document attempted without authentication', { authError, documentId })
      return { success: false, error: 'Not authenticated' }
    }

    userId = user.id
    logger.info('Approving document', { userId, documentId, action: 'approveDocument' })

    // Sanitize comments
    const cleanComments = comments ? sanitizeString(comments) : null

    // Get document
    const { data: document, error: docError } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single()

    if (docError || !document) {
      logger.error('Document not found for approval', {
        userId,
        documentId,
        error: docError,
      })
      return { success: false, error: 'Document not found' }
    }

    if (document.status !== 'In Approval') {
      logger.warn('Attempt to approve document not in approval', {
        userId,
        documentId,
        status: document.status,
      })
      return { success: false, error: 'Document is not in approval status' }
    }

    // Check if user is an approver
    const { data: approver, error: approverError } = await createServiceRoleClient()
      .schema('docs')
      .from('approvers')
      .select('*')
      .eq('document_id', documentId)
      .eq('user_id', user.id)
      .single()

    if (approverError || !approver) {
      logger.warn('Non-approver attempted to approve', {
        userId,
        documentId,
      })
      return { success: false, error: 'You are not assigned as an approver for this document' }
    }

    if (approver.status !== 'Pending') {
      logger.warn('Approver already responded', {
        userId,
        documentId,
        currentStatus: approver.status,
      })
      return { success: false, error: 'You have already responded to this approval request' }
    }

    // Update approver status
    const { error: updateError } = await createServiceRoleClient()
      .schema('docs')
      .from('approvers')
      .update({
        status: 'Approved',
        comments: cleanComments,
        action_date: new Date().toISOString()
      })
      .eq('id', approver.id)

    if (updateError) {
      logError(updateError, {
        action: 'approveDocument',
        userId,
        documentId,
      })
      return { success: false, error: 'Failed to approve document' }
    }

    logger.info('Approval recorded', {
      userId,
      documentId,
      approverId: approver.id,
    })

    // Log approval event
    logger.info({msg: 'Document Approved', 
      documentId,
      documentNumber: `${document.document_number}${document.version}`,
      approverId: user.id,
      userId,
      comments: cleanComments || undefined,
    })

    // Create audit log
    await createServiceRoleClient()
      .schema('docs')
      .from('audit_log')
      .insert({
        document_id: documentId,
        action: 'approved',
        performed_by: user.id,
        performed_by_email: user.email,
        tenant_id: document.tenant_id,
        details: { 
          document_number: `${document.document_number}${document.version}`,
          comments: cleanComments
        }
      })

    // Check if all approvers have approved by querying directly
    const { data: approvers, error: approversError } = await createServiceRoleClient()
      .schema('docs')
      .from('approvers')
      .select('status')
      .eq('document_id', documentId)
    
    if (approversError) {
      logger.error('Failed to fetch approvers for completion check', {
        userId,
        documentId,
        error: approversError
      })
      return { success: false, error: 'Failed to check approval status' }
    }

    const totalApprovers = approvers?.length || 0
    const approvedCount = approvers?.filter(a => a.status === 'Approved').length || 0
    const allApproved = totalApprovers > 0 && approvedCount === totalApprovers

    logger.info('Approval check', {
      userId,
      documentId,
      totalApprovers,
      approvedCount,
      allApproved
    })

    if (allApproved) {
      logger.info('All approvers approved, releasing document', {
        userId,
        documentId,
        documentNumber: `${document.document_number}${document.version}`,
      })

      // All approved - release the document - use service role client
      const supabaseAdmin = createServiceRoleClient()
      await supabaseAdmin
        .schema('docs')
        .from('documents')
        .update({
          status: 'Released',
          released_at: new Date().toISOString(),
          released_by: user.id
        })
        .eq('id', documentId)

      // Handle obsolescence: make immediate predecessor obsolete
      const { getImmediatePredecessor } = await import('./versions')
      
      // Special case: Production v1 should obsolete the last Released prototype
      if (document.is_production && document.version === 'v1') {
        // Find last released prototype version
        const { data: lastPrototype } = await supabaseAdmin
          .schema('docs')
          .from('documents')
          .select('id, version, status, tenant_id')
          .eq('document_number', document.document_number)
          .eq('is_production', false)
          .eq('status', 'Released')
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle()
        
        if (lastPrototype) {
          logger.info('Obsoleting last prototype version for production v1', {
            userId,
            documentId,
            prototypeId: lastPrototype.id,
            prototypeVersion: lastPrototype.version,
          })
          
          await supabaseAdmin
            .schema('docs')
            .from('documents')
            .update({ status: 'Obsolete' })
            .eq('id', lastPrototype.id)
          
          // Log obsolescence
          await supabaseAdmin
            .schema('docs')
            .from('audit_log')
            .insert({
              document_id: lastPrototype.id,
              action: 'document_obsoleted',
              performed_by: user.id,
              performed_by_email: user.email,
              tenant_id: lastPrototype.tenant_id,
              details: {
                document_number: `${lastPrototype.version}`,
                obsoleted_by_version: document.version,
                reason: 'superseded_by_production'
              },
            })
        }
      } else {
        // Normal case: find immediate predecessor
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
      }

      // Log release event
      logger.info({msg: 'Document Released', 
        documentId,
        documentNumber: `${document.document_number}${document.version}`,
        userId,
      })

      // Create release audit log
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
            document_number: `${document.document_number}${document.version}`,
            release_method: 'approved'
          }
        })
    }

    revalidatePath(`/documents/${documentId}`)
    revalidatePath('/documents')
    revalidatePath('/dashboard')
    revalidatePath('/approvals')
    
    const duration = Date.now() - startTime
    logServerAction('approveDocument', {
      userId,
      documentId,
      allApproved: allApproved === true,
      success: true,
      duration,
    })

    // Send approval completed email to creator
    if (allApproved && document.status === 'Released') {
      try {
        await sendApprovalCompleteEmail(document.created_by, {
          documentNumber: document.document_number,
          documentVersion: document.version,
          documentTitle: document.title,
          documentId: document.id
        })
        logger.info('Sent approval completed email to creator', { documentId, creatorId: document.created_by })
      } catch (emailError) {
        logger.error('Failed to send approval completed email', { documentId, error: emailError })
      }
    }

    return { 
      success: true, 
      allApproved: allApproved === true 
    }
  } catch (error) {
    const duration = Date.now() - startTime
    logError(error, {
      action: 'approveDocument',
      userId,
      documentId,
      duration,
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to approve document'
    }
  }
}

// ==========================================
// Action: Reject Document
// ==========================================

export async function rejectDocument(documentId: string, rejectionReason: string) {
  const startTime = Date.now()
  let userId: string | undefined

  try {
    const supabase = await createClient()

    // Sanitize and validate rejection reason
    const cleanReason = sanitizeString(rejectionReason)
    if (!cleanReason || cleanReason.trim().length === 0) {
      return { success: false, error: 'Rejection reason is required' }
    }

    if (cleanReason.length > 1000) {
      return { success: false, error: 'Rejection reason must be less than 1000 characters' }
    }

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      logger.warn('Reject document attempted without authentication', { authError, documentId })
      return { success: false, error: 'Not authenticated' }
    }

    userId = user.id
    logger.info('Rejecting document', { userId, documentId, action: 'rejectDocument' })

    // Get document
    const { data: document, error: docError } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single()

    if (docError || !document) {
      logger.error('Document not found for rejection', {
        userId,
        documentId,
        error: docError,
      })
      return { success: false, error: 'Document not found' }
    }

    if (document.status !== 'In Approval') {
      logger.warn('Attempt to reject document not in approval', {
        userId,
        documentId,
        status: document.status,
      })
      return { success: false, error: 'Document is not in approval status' }
    }

    // Check if user is an approver
    const { data: approver, error: approverError } = await createServiceRoleClient()
      .schema('docs')
      .from('approvers')
      .select('*')
      .eq('document_id', documentId)
      .eq('user_id', user.id)
      .single()

    if (approverError || !approver) {
      logger.warn('Non-approver attempted to reject', {
        userId,
        documentId,
      })
      return { success: false, error: 'You are not assigned as an approver for this document' }
    }

    if (approver.status !== 'Pending') {
      logger.warn('Approver already responded', {
        userId,
        documentId,
        currentStatus: approver.status,
      })
      return { success: false, error: 'You have already responded to this approval request' }
    }

    // Update approver status
    const { error: updateApproverError } = await createServiceRoleClient()
      .schema('docs')
      .from('approvers')
      .update({
        status: 'Rejected',
        comments: cleanReason,
        action_date: new Date().toISOString()
      })
      .eq('id', approver.id)

    if (updateApproverError) {
      logError(updateApproverError, {
        action: 'rejectDocument',
        userId,
        documentId,
      })
      return { success: false, error: 'Failed to reject document' }
    }

    // Return document to Draft status - use service role client
    const supabaseAdmin = createServiceRoleClient()
    const { error: updateDocError } = await supabaseAdmin
      .schema('docs')
      .from('documents')
      .update({ status: 'Draft' })
      .eq('id', documentId)

    if (updateDocError) {
      logError(updateDocError, {
        action: 'rejectDocumentUpdateStatus',
        userId,
        documentId,
      })
      return { success: false, error: 'Failed to update document status' }
    }

    // Reset all other approvers to Pending (for resubmission)
    await createServiceRoleClient()
      .schema('docs')
      .from('approvers')
      .update({
        status: 'Pending',
        comments: null,
        action_date: null
      })
      .eq('document_id', documentId)
      .neq('id', approver.id)

    // Log rejection event
    logger.info({msg: 'Document Rejected', 
      documentId,
      documentNumber: `${document.document_number}${document.version}`,
      approverId: user.id,
      userId,
      comments: cleanReason,
    })

    // Create audit log
    await createServiceRoleClient()
      .schema('docs')
      .from('audit_log')
      .insert({
        document_id: documentId,
        action: 'rejected',
        performed_by: user.id,
        performed_by_email: user.email,
        tenant_id: document.tenant_id,
        details: { 
          document_number: `${document.document_number}${document.version}`,
          rejection_reason: cleanReason
        }
      })

    revalidatePath(`/documents/${documentId}`)
    revalidatePath('/documents')
    revalidatePath('/dashboard')
    revalidatePath('/approvals')
    
    const duration = Date.now() - startTime
    logServerAction('rejectDocument', {
      userId,
      documentId,
      success: true,
      duration,
    })

    // Send rejection email to creator
    try {
      const sharedClient = createSharedClient()
        const { data: currentUser } = await sharedClient
          .schema('shared')
          .from('users')
          .select('email, full_name')
          .eq('id', user.id)
          .single()
      
      await sendDocumentRejectedEmail(document.created_by, {
        documentNumber: document.document_number,
        documentVersion: document.version,
        documentTitle: document.title,
        documentId: document.id,
        rejectedBy: currentUser?.full_name || currentUser?.email || 'Unknown',
        rejectionReason: cleanReason
      })
      logger.info('Sent rejection email to creator', { documentId, creatorId: document.created_by })
    } catch (emailError) {
      logger.error('Failed to send rejection email', { documentId, error: emailError })
    }

    return { success: true }
  } catch (error) {
    const duration = Date.now() - startTime
    logError(error, {
      action: 'rejectDocument',
      userId,
      documentId,
      duration,
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reject document'
    }
  }
}

// ==========================================
// Action: Get My Approvals
// ==========================================

export async function getMyApprovals() {
  const startTime = Date.now()
  let userId: string | undefined

  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      logger.warn('Get my approvals attempted without authentication', { authError })
      return { success: false, error: 'Not authenticated', data: [] }
    }

    userId = user.id
    logger.debug('Fetching approvals', { userId, action: 'getMyApprovals' })

    // Get all approvals for current user
    const { data: approvals, error } = await createServiceRoleClient()
      .schema('docs')
      .from('approvers')
      .select(`
        *,
        document:documents (
          id,
          document_number,
          version,
          title,
          status,
          is_production,
          created_at,
          created_by
        )
      `)
      .eq('user_email', user.email)
      .order('created_at', { ascending: false })

    if (error) {
      logError(error, {
        action: 'getMyApprovals',
        userId,
      })
      return { success: false, error: 'Failed to fetch approvals', data: [] }
    }

    const duration = Date.now() - startTime
    logger.debug('Approvals fetched', {
      userId,
      approvalCount: approvals?.length || 0,
      duration,
    })

    return { success: true, data: approvals || [] }
  } catch (error) {
    const duration = Date.now() - startTime
    logError(error, {
      action: 'getMyApprovals',
      userId,
      duration,
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch approvals',
      data: []
    }
  }
}

/**
 * Withdraw a document from approval (return to Draft)
 */
export async function withdrawFromApproval(documentId: string) {
  const startTime = Date.now()
  let userId: string | undefined

  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      logger.warn('Withdraw attempted without authentication', { authError, documentId })
      return { success: false, error: 'Not authenticated' }
    }

    userId = user.id

    // Get document
    const { data: document, error: docError } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .select('*, created_by')
      .eq('id', documentId)
      .single()

    if (docError || !document) {
      logger.error('Document not found for withdrawal', {
        userId,
        documentId,
        error: docError,
      })
      return { success: false, error: 'Document not found' }
    }

    // Check authorization
    if (document.created_by !== user.id) {
      logger.warn('Unauthorized withdrawal attempt', {
        userId,
        documentId,
        ownerId: document.created_by,
      })
      return { success: false, error: 'Not authorized' }
    }

    // Check status
    if (document.status !== 'In Approval') {
      logger.warn('Attempt to withdraw document not in approval', {
        userId,
        documentId,
        status: document.status,
      })
      return { success: false, error: 'Document is not in approval' }
    }

    // Return to Draft status
    const supabaseAdmin = createServiceRoleClient()
    const { error: updateError } = await supabaseAdmin
      .schema('docs')
      .from('documents')
      .update({ status: 'Draft' })
      .eq('id', documentId)

    if (updateError) {
      logError(updateError, {
        action: 'withdrawFromApproval',
        userId,
        documentId,
      })
      return { success: false, error: 'Failed to withdraw document' }
    }

    // Reset all approvers to Pending
    await createServiceRoleClient()
      .schema('docs')
      .from('approvers')
      .update({
        status: 'Pending',
        comments: null,
        action_date: null
      })
      .eq('document_id', documentId)

    // Create audit log
    await supabaseAdmin
      .schema('docs')
      .from('audit_log')
      .insert({
        document_id: documentId,
        action: 'withdrawn_from_approval',
        performed_by: user.id,
        performed_by_email: user.email,
        tenant_id: document.tenant_id,
        details: {
          document_number: `${document.document_number}${document.version}`
        }
      })

    logger.info('Document withdrawn from approval', {
      userId,
      documentId,
      documentNumber: `${document.document_number}${document.version}`,
    })

    revalidatePath(`/documents/${documentId}`)
    revalidatePath('/documents')
    revalidatePath('/approvals')

    const duration = Date.now() - startTime
    logServerAction('withdrawFromApproval', {
      userId,
      documentId,
      success: true,
      duration,
    })

    return { success: true }
  } catch (error: any) {
    logError(error, {
      action: 'withdrawFromApproval',
      userId,
      documentId,
      duration: Date.now() - startTime,
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to withdraw document',
    }
  }
}
