/**
 * app/actions/advanced-search.ts
 * CHANGED: Removed FK hints (documents_created_by_fkey etc.) from the select query.
 * PostgREST cannot reliably resolve cross-schema FK hints in the cache.
 * Creator/releaser user info is now fetched in a separate query and merged in.
 */
'use server'

import { createClient, createSharedClient } from '@/lib/supabase/server'
import type { AdvancedSearchFilters, SearchResult } from '@/lib/types/advanced-search'
import { getSubdomainTenantId } from '@/lib/tenant'

export async function searchDocuments(
  filters: AdvancedSearchFilters
): Promise<SearchResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const tenantId = await getSubdomainTenantId()
  if (!tenantId) throw new Error('Invalid tenant subdomain')

  // Build base query — NO FK hints, no user joins
  let query = supabase
    .from('documents')
    .select(`
      id,
      document_number,
      version,
      title,
      description,
      status,
      is_production,
      project_code,
      created_at,
      updated_at,
      released_at,
      created_by,
      released_by,
      document_type:document_types!inner(id, name, prefix)
    `, { count: 'exact' })
    .eq('tenant_id', tenantId)

  if (filters.searchQuery?.trim()) {
    const searchTerm = `%${filters.searchQuery.trim()}%`
    query = query.or(`document_number.ilike.${searchTerm},title.ilike.${searchTerm}`)
  }

  if (filters.createdAfter)  query = query.gte('created_at', filters.createdAfter)
  if (filters.createdBefore) {
    const endOfDay = new Date(filters.createdBefore)
    endOfDay.setHours(23, 59, 59, 999)
    query = query.lte('created_at', endOfDay.toISOString())
  }
  if (filters.updatedAfter)  query = query.gte('updated_at', filters.updatedAfter)
  if (filters.updatedBefore) {
    const endOfDay = new Date(filters.updatedBefore)
    endOfDay.setHours(23, 59, 59, 999)
    query = query.lte('updated_at', endOfDay.toISOString())
  }
  if (filters.releasedAfter)  query = query.gte('released_at', filters.releasedAfter)
  if (filters.releasedBefore) {
    const endOfDay = new Date(filters.releasedBefore)
    endOfDay.setHours(23, 59, 59, 999)
    query = query.lte('released_at', endOfDay.toISOString())
  }

  if (filters.documentTypes?.length)  query = query.in('document_type_id', filters.documentTypes)
  if (filters.statuses?.length)        query = query.in('status', filters.statuses)
  if (filters.projectCodes?.length)    query = query.in('project_code', filters.projectCodes)
  if (filters.createdBy)  query = query.eq('created_by', filters.createdBy)
  if (filters.releasedBy) query = query.eq('released_by', filters.releasedBy)
  if (filters.isProduction !== null && filters.isProduction !== undefined)
    query = query.eq('is_production', filters.isProduction)
  if (filters.myDocumentsOnly) query = query.eq('created_by', user.id)

  const sortBy    = filters.sortBy    || 'updated_at'
  const sortOrder = filters.sortOrder || 'desc'
  query = query.order(sortBy, { ascending: sortOrder === 'asc' })

  const page     = filters.page     || 1
  const pageSize = filters.pageSize || 50
  const from     = (page - 1) * pageSize
  const to       = from + pageSize - 1
  query = query.range(from, to)

  const { data: documents, error, count } = await query

  if (error) {
    console.error('[Advanced Search] Query error:', error)
    throw new Error(`Search failed: ${error.message}`)
  }

  let filteredDocuments = documents || []

  // Fetch user info separately — avoids cross-schema FK hint issues entirely
  const userIds = [
    ...new Set([
      ...filteredDocuments.map(d => d.created_by).filter(Boolean),
      ...filteredDocuments.map(d => d.released_by).filter(Boolean),
    ])
  ]

  let userMap: Record<string, { email: string; full_name: string | null }> = {}
  if (userIds.length > 0) {
    const sharedClient = createSharedClient()
    const { data: users } = await sharedClient
      .schema('shared')
      .from('users')
      .select('id, email, full_name')
      .in('id', userIds)

    userMap = Object.fromEntries((users || []).map(u => [u.id, u]))
  }

  // Merge user info onto documents
  filteredDocuments = filteredDocuments.map(doc => ({
    ...doc,
    created_by_user:  doc.created_by  ? userMap[doc.created_by]  || null : null,
    released_by_user: doc.released_by ? userMap[doc.released_by] || null : null,
  }))

  // Post-process: hasAttachments filter
  if (filters.hasAttachments !== null && filters.hasAttachments !== undefined) {
    const documentIds = filteredDocuments.map(d => d.id)
    if (documentIds.length > 0) {
      const { data: fileCounts } = await supabase
        .from('document_files')
        .select('document_id')
        .in('document_id', documentIds)

      const docsWithFiles = new Set(fileCounts?.map(f => f.document_id) || [])
      filteredDocuments = filteredDocuments.filter(doc => {
        const hasFiles = docsWithFiles.has(doc.id)
        return filters.hasAttachments ? hasFiles : !hasFiles
      })
    } else if (filters.hasAttachments === true) {
      filteredDocuments = []
    }
  }

  const totalCount  = count || 0
  const totalPages  = Math.ceil(totalCount / pageSize)

  return { documents: filteredDocuments, totalCount, page, pageSize, totalPages, hasMore: page < totalPages }
}

export async function getUsersForFilters() {
  const supabase    = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const tenantId = await getSubdomainTenantId()
  if (!tenantId) return []

  const sharedClient = createSharedClient()
  const { data: users } = await sharedClient
    .schema('shared')
    .from('users')
    .select('id, email, full_name')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('full_name', { ascending: true, nullsFirst: false })

  return users || []
}

export async function getProjectCodesForFilters() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const tenantId = await getSubdomainTenantId()
  if (!tenantId) return []

  const { data: documents } = await supabase
    .from('documents')
    .select('project_code')
    .eq('tenant_id', tenantId)
    .not('project_code', 'is', null)
    .order('project_code')

  const uniqueCodes = [...new Set(
    documents?.map(d => d.project_code).filter(Boolean) || []
  )].sort()

  return uniqueCodes as string[]
}

export async function getDocumentTypesForFilters() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const tenantId = await getSubdomainTenantId()
  if (!tenantId) return []

  const { data: types } = await supabase
    .from('document_types')
    .select('id, name, prefix')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('prefix')

  return types || []
}
