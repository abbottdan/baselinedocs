'use server'

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getSubdomainTenantId } from '@/lib/tenant'
import { revalidatePath } from 'next/cache'

/**
 * Toggle bookmark for a document version.
 * documentId is the UUID of the specific document version.
 */
export async function toggleBookmark(documentId: string) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'Not authenticated' }

    const subdomainTenantId = await getSubdomainTenantId()
    if (!subdomainTenantId) return { success: false, error: 'Tenant not found' }

    const sr = createServiceRoleClient()

    // Check if bookmark already exists
    const { data: existing } = await sr
      .schema('docs')
      .from('document_bookmarks')
      .select('id')
      .eq('user_id', user.id)
      .eq('document_id', documentId)
      .eq('tenant_id', subdomainTenantId)
      .maybeSingle()

    if (existing) {
      const { error: deleteError } = await sr
        .schema('docs')
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
      const { error: insertError } = await sr
        .schema('docs')
        .from('document_bookmarks')
        .insert({
          user_id: user.id,
          document_id: documentId,
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
    return { success: false, error: error instanceof Error ? error.message : 'Failed to toggle bookmark' }
  }
}

/**
 * Get all bookmarked documents for the current user.
 * Returns the bookmarked document versions.
 */
export async function getBookmarkedDocuments() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'Not authenticated' }

    const subdomainTenantId = await getSubdomainTenantId()
    if (!subdomainTenantId) return { success: false, error: 'Tenant not found' }

    const sr = createServiceRoleClient()

    // Get user's bookmarked document_ids
    const { data: bookmarks, error: bookmarksError } = await sr
      .schema('docs')
      .from('document_bookmarks')
      .select('document_id')
      .eq('user_id', user.id)
      .eq('tenant_id', subdomainTenantId)

    if (bookmarksError) {
      console.error('Failed to fetch bookmarks:', bookmarksError)
      return { success: false, error: 'Failed to fetch bookmarks' }
    }

    if (!bookmarks || bookmarks.length === 0) return { success: true, documents: [] }

    const documentIds = bookmarks.map(b => b.document_id)

    // Fetch the bookmarked document versions
    const { data: documents, error: docsError } = await sr
      .schema('docs')
      .from('documents')
      .select('*, document_types(name, prefix)')
      .in('id', documentIds)
      .order('updated_at', { ascending: false })

    if (docsError) {
      console.error('Failed to fetch documents:', docsError)
      return { success: false, error: 'Failed to fetch documents' }
    }

    return { success: true, documents: documents || [] }
  } catch (error) {
    console.error('Get bookmarked documents error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch bookmarked documents' }
  }
}

/**
 * Check if a specific document version is bookmarked by current user.
 */
export async function isDocumentBookmarked(documentId: string): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    const subdomainTenantId = await getSubdomainTenantId()
    if (!subdomainTenantId) return false

    const { data } = await createServiceRoleClient()
      .schema('docs')
      .from('document_bookmarks')
      .select('id')
      .eq('user_id', user.id)
      .eq('document_id', documentId)
      .eq('tenant_id', subdomainTenantId)
      .maybeSingle()

    return !!data
  } catch {
    return false
  }
}
