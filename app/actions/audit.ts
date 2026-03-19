'use server'

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export interface AuditLogEntry {
  id: string
  document_id: string
  action: string
  performed_by: string
  performed_by_email: string
  created_at: string
  details: any
}

/**
 * Get audit log for a specific document
 * Returns all audit entries for all versions of the document (by document_number)
 */
export async function getDocumentAuditLog(documentId: string) {
  try {
    const supabase = await createClient()
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'Not authenticated', data: [] }
    }

    // First, get the document to find its document_number
    const { data: document, error: docError } = await supabase
      .schema('docs')
      .from('documents')
      .select('document_number')
      .eq('id', documentId)
      .single()

    if (docError || !document) {
      return { success: false, error: 'Document not found', data: [] }
    }

    // Get all documents with this document_number (all versions)
    const { data: allVersions, error: versionsError } = await supabase
      .schema('docs')
      .from('documents')
      .select('id')
      .eq('document_number', document.document_number)

    if (versionsError) {
      return { success: false, error: 'Failed to fetch versions', data: [] }
    }

    const documentIds = allVersions?.map(v => v.id) || []

    if (documentIds.length === 0) {
      return { success: true, data: [] }
    }

    // Fetch audit logs for all versions of this document
    const { data: logs, error: logsError } = await supabase
      .from('audit_log')
      .select('*')
      .in('document_id', documentIds)
      .order('created_at', { ascending: false })

    if (logsError) {
      console.error('Error fetching audit logs:', logsError)
      return { success: false, error: 'Failed to fetch audit logs', data: [] }
    }

    return { success: true, data: logs || [] }
  } catch (error) {
    console.error('Error in getDocumentAuditLog:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to fetch audit logs',
      data: [] 
    }
  }
}
