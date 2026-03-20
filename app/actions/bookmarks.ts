'use server'

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getSubdomainTenantId } from '@/lib/tenant'
import { revalidatePath } from 'next/cache'

/**
 * Toggle bookmark for a document
 * If bookmarked, removes it. If not bookmarked, adds it.
 */
export async function toggleBookmark(documentNumber: string) {
  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    // Get sub-domain's tenant_id
    const subdomainTenantId = await getSubdomainTenantId()
    
    if (!subdomainTenantId) {
      return { success: false, error: 'User tenant not found' }
    }

    // Check if bookmark already exists
    const { data: existing } = await supabase
      .from('document_bookmarks')
      .select('id')
      .eq('user_id', user.id)
      .eq('document_number', documentNumber)
      .eq('tenant_id', subdomainTenantId)
      .single()

    if (existing) {
      // Remove bookmark
      const { error: deleteError } = await supabase
        .from('document_bookmarks')
        .delete()
        .eq('id', existing.id)

      if (deleteError) {
        console.error('Failed to remove bookmark:', deleteError)
        return { success: false, error: 'Failed to remove bookmark' }
      }

      revalidatePath('/documents')
      revalidatePath('/bookmarks')
      return { success: true, bookmarked: false }
    } else {
      // Add bookmark
      const { error: insertError } = await supabase
        .from('document_bookmarks')
        .insert({
          user_id: user.id,
          document_number: documentNumber,
          tenant_id: subdomainTenantId,
        })

      if (insertError) {
        console.error('Failed to add bookmark:', insertError)
        return { success: false, error: 'Failed to add bookmark' }
      }

      revalidatePath('/documents')
      revalidatePath('/bookmarks')
      return { success: true, bookmarked: true }
    }
  } catch (error) {
    console.error('Toggle bookmark error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to toggle bookmark',
    }
  }
}

/**
 * Get all bookmarked documents for current user
 * Returns latest Released version for each bookmarked document number
 */
export async function getBookmarkedDocuments() {
  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'Not authenticated' }
    }

    // Get current sub-domain's tenant_id
    const subdomainTenantId = await getSubdomainTenantId()
    
    if (!subdomainTenantId) {
      return { success: false, error: 'User tenant not found' }
    }

    // Get user's bookmarks
    const { data: bookmarks, error: bookmarksError } = await supabase
      .from('document_bookmarks')
      .select('document_number')
      .eq('user_id', user.id)
      .eq('tenant_id', subdomainTenantId)

    if (bookmarksError) {
      console.error('Failed to fetch bookmarks:', bookmarksError)
      return { success: false, error: 'Failed to fetch bookmarks' }
    }

    if (!bookmarks || bookmarks.length === 0) {
      return { success: true, documents: [] }
    }

    const documentNumbers = bookmarks.map(b => b.document_number)

    // Get latest Released version for each bookmarked document number
    // We need to find the most recent Released document for each document_number
    const { data: documents, error: docsError } = await createServiceRoleClient()
      .schema('docs')
      .from('documents')
      .select(`
        *,
        document_types (name, prefix),
        created_by
      `)
      .in('document_number', documentNumbers)
      .eq('status', 'Released')
      .order('updated_at', { ascending: false })

    if (docsError) {
      console.error('Failed to fetch documents:', docsError)
      return { success: false, error: 'Failed to fetch documents' }
    }

    // Filter to get only the latest version for each document_number
    const latestDocuments = new Map()
    documents?.forEach(doc => {
      if (!latestDocuments.has(doc.document_number)) {
        latestDocuments.set(doc.document_number, doc)
      }
    })

    return { 
      success: true, 
      documents: Array.from(latestDocuments.values())
    }
  } catch (error) {
    console.error('Get bookmarked documents error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch bookmarked documents',
    }
  }
}

/**
 * Check if a document is bookmarked by current user
 */
export async function isDocumentBookmarked(documentNumber: string): Promise<boolean> {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    const { data } = await supabase
      .from('document_bookmarks')
      .select('id')
      .eq('user_id', user.id)
      .eq('document_number', documentNumber)
      .single()

    return !!data
  } catch {
    return false
  }
}
