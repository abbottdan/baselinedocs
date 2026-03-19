'use server'

import { createClient, createServiceRoleClient , createSharedClient} from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentSubdomain } from '@/lib/tenant'
import { checkBaselineReqsReferences, markBaselineReqsLinksBroken, type BaselineReqsLinksResult } from '@/lib/integrations/baselinereqs'

/**
 * Admin: Force delete any document regardless of status
 * Creates audit log entry before deletion
 */
export async function adminDeleteDocument(
  documentId: string,
  /**
   * Two-phase delete — same pattern as deleteDocument().
   * Pass false on the first call to surface BaselineReqs reference warnings.
   * Pass true to proceed after the user acknowledges.
   */
  acknowledgedRefs: boolean = false
) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    // Check if user is admin
          const sharedClient = createSharedClient()
      const { data: _su } = await sharedClient
        .schema('shared').from('users')
        .select('is_master_admin, tenant_id, email')
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

    if (!userData?.is_admin) {
      return { success: false, error: 'Not authorized - admin only' }
    }

    // Get document info before deletion (for audit log)
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single()

    if (docError || !document) {
      return { success: false, error: 'Document not found' }
    }

    // ── BaselineReqs integration: check for linked requirements ────────────
    const subdomain = await getCurrentSubdomain()
    let refsData: BaselineReqsLinksResult | null = null

    if (subdomain) {
      refsData = await checkBaselineReqsReferences(subdomain, documentId)
    }

    if (refsData?.linked && !acknowledgedRefs) {
      return {
        success: false,
        requiresAcknowledgement: true,
        refs: refsData,
        error: `This document is referenced by ${refsData.count} item${refsData.count === 1 ? '' : 's'} in BaselineReqs. Deleting it will mark those links as broken.`,
      }
    }
    // ── End BaselineReqs check ─────────────────────────────────────────────

    // Use service role client to bypass RLS
    const supabaseAdmin = createServiceRoleClient()

    // Create audit log BEFORE deletion (critical for record keeping)
    await supabaseAdmin
      .from('audit_log')
      .insert({
        document_id: documentId,
        action: 'admin_delete',
        performed_by: user.id,
        performed_by_email: user.email,
        tenant_id: document.tenant_id,
        details: {
          document_number: `${document.document_number}${document.version}`,
          status: document.status,
          title: document.title,
          is_production: document.is_production,
          deleted_at: new Date().toISOString(),
        },
      })

    // Delete associated files from storage
    const { data: files } = await supabase
      .from('document_files')
      .select('file_path')
      .eq('document_id', documentId)

    if (files && files.length > 0) {
      const filePaths = files.map(f => f.file_path)
      await supabase.storage
        .from('documents')
        .remove(filePaths)
    }

    // Delete document (cascade will handle document_files and approvers)
    // Audit log will remain due to ON DELETE SET NULL on document_id
    const { error: deleteError } = await supabaseAdmin
      .from('documents')
      .delete()
      .eq('id', documentId)

    if (deleteError) {
      console.error('Failed to delete document:', deleteError)
      return { success: false, error: 'Failed to delete document' }
    }

    revalidatePath('/documents')

    // ── BaselineReqs integration: mark any links to this doc as broken ─────
    if (subdomain) {
      markBaselineReqsLinksBroken(subdomain, documentId)
    }
    // ── End BaselineReqs ───────────────────────────────────────────────────
    
    return { 
      success: true, 
      message: `Document ${document.document_number}${document.version} permanently deleted`
    }
  } catch (error) {
    console.error('Admin delete document error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete document',
    }
  }
}

/**
 * Admin: Change document owner
 */
export async function changeDocumentOwner(documentId: string, newOwnerEmail: string) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    // Check if user is admin
          const sharedClient = createSharedClient()
      const { data: _su } = await sharedClient
        .schema('shared').from('users')
        .select('is_master_admin, tenant_id, email')
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

    if (!userData?.is_admin) {
      return { success: false, error: 'Not authorized - admin only' }
    }

    // Get new owner by email
    const { data: newOwner, error: ownerError } = await supabase
      .schema('shared')
      .from('users')
      .select('id, email')
      .eq('email', newOwnerEmail.toLowerCase())
      .single()

    if (ownerError || !newOwner) {
      return { success: false, error: 'User not found with that email address' }
    }

    // Get current document info
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, document_number, version, created_by, tenant_id')
      .eq('id', documentId)
      .single()

    if (docError || !document) {
      return { success: false, error: 'Document not found' }
    }

    // Don't change if already the owner
    if (document.created_by === newOwner.id) {
      return { success: false, error: 'User is already the owner' }
    }

    // Use service role client to bypass RLS
    const supabaseAdmin = createServiceRoleClient()

    // Update document owner
    const { error: updateError } = await supabaseAdmin
      .from('documents')
      .update({ created_by: newOwner.id })
      .eq('id', documentId)

    if (updateError) {
      console.error('Failed to change document owner:', updateError)
      return { success: false, error: 'Failed to change owner' }
    }

    // Create audit log
    await supabaseAdmin
      .from('audit_log')
      .insert({
        document_id: documentId,
        document_number: document.document_number,
        version: document.version,
        action: 'admin_change_owner',
        performed_by: user.id,
        performed_by_email: user.email,
        tenant_id: document.tenant_id,
        details: {
          document_number: `${document.document_number}${document.version}`,
          old_owner: (document.users as any)?.email || 'unknown',
          new_owner: newOwner.email,
        },
      })

    revalidatePath('/documents')
    revalidatePath(`/documents/${documentId}`)

    return { success: true, newOwnerEmail: newOwner.email }
  } catch (error) {
    console.error('Admin change owner error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to change owner',
    }
  }
}

/**
 * Admin: Rename document number
 */
export async function adminRenameDocument(documentId: string, newNumber: string) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    // Check if user is admin
          const sharedClient = createSharedClient()
      const { data: _su } = await sharedClient
        .schema('shared').from('users')
        .select('is_master_admin, tenant_id, email')
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

    if (!userData?.is_admin) {
      return { success: false, error: 'Not authorized - admin only' }
    }

    // Validate new number format (PREFIX-#####)
    const numberPattern = /^[A-Z]+-\d{5}$/
    if (!numberPattern.test(newNumber)) {
      return { success: false, error: 'Invalid document number format. Use PREFIX-##### (e.g., FORM-00001)' }
    }

    // Get current document info
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('document_number, version, tenant_id')
      .eq('id', documentId)
      .single()

    if (docError || !document) {
      return { success: false, error: 'Document not found' }
    }

    // Check if new number already exists
    const { data: existing } = await supabase
      .from('documents')
      .select('id')
      .eq('document_number', newNumber)
      .limit(1)

    if (existing && existing.length > 0) {
      return { success: false, error: `Document number ${newNumber} already exists` }
    }

    // Use service role client to bypass RLS
    const supabaseAdmin = createServiceRoleClient()

    // Update document number
    const { error: updateError } = await supabaseAdmin
      .from('documents')
      .update({ document_number: newNumber })
      .eq('id', documentId)

    if (updateError) {
      console.error('Failed to rename document:', updateError)
      return { success: false, error: 'Failed to rename document' }
    }

    // Create audit log
    await supabaseAdmin
      .from('audit_log')
      .insert({
        document_id: documentId,
        action: 'admin_rename',
        performed_by: user.id,
        performed_by_email: user.email,
        tenant_id: document.tenant_id,
        details: {
          old_number: `${document.document_number}${document.version}`,
          new_number: `${newNumber}${document.version}`,
        },
      })

    revalidatePath('/documents')
    revalidatePath(`/documents/${documentId}`)

    return { success: true }
  } catch (error) {
    console.error('Admin rename document error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to rename document',
    }
  }
}
