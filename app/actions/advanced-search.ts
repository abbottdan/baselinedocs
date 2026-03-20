/**
 * Advanced Search Server Actions
 * app/actions/advanced-search.ts
 */

'use server'

import { createClient, createSharedClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { AdvancedSearchFilters, SearchResult } from '@/lib/types/advanced-search'
import { getSubdomainTenantId } from '@/lib/tenant'

/**
 * Main advanced search function
 * Builds dynamic query based on filters and returns paginated results
 */
export async function searchDocuments(
  filters: AdvancedSearchFilters
): Promise<SearchResult> {
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    throw new Error('Not authenticated')
  }

  // Get tenant based on CURRENT SUBDOMAIN (not user's home tenant)
  // This ensures master admins see the correct tenant's data
  const tenantId = await getSubdomainTenantId()

  if (!tenantId) {
    throw new Error('Invalid tenant subdomain')
  }

  // Build base query with joins for related data
  let query = createServiceRoleClient()
    .schema('docs')
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
      document_type:document_types(id, name, prefix)
    `, { count: 'exact' })
    .eq('tenant_id', tenantId)

  // Text search - search in document_number and title
  if (filters.searchQuery?.trim()) {
    const searchTerm = `%${filters.searchQuery.trim()}%`
    query = query.or(`document_number.ilike.${searchTerm},title.ilike.${searchTerm}`)
  }

  // Date range filters
  if (filters.createdAfter) {
    query = query.gte('created_at', filters.createdAfter)
  }
  if (filters.createdBefore) {
    // Add end of day
    const endOfDay = new Date(filters.createdBefore)
    endOfDay.setHours(23, 59, 59, 999)
    query = query.lte('created_at', endOfDay.toISOString())
  }
  
  if (filters.updatedAfter) {
    query = query.gte('updated_at', filters.updatedAfter)
  }
  if (filters.updatedBefore) {
    const endOfDay = new Date(filters.updatedBefore)
    endOfDay.setHours(23, 59, 59, 999)
    query = query.lte('updated_at', endOfDay.toISOString())
  }
  
  if (filters.releasedAfter) {
    query = query.gte('released_at', filters.releasedAfter)
  }
  if (filters.releasedBefore) {
    const endOfDay = new Date(filters.releasedBefore)
    endOfDay.setHours(23, 59, 59, 999)
    query = query.lte('released_at', endOfDay.toISOString())
  }

  // Multi-select filters
  if (filters.documentTypes && filters.documentTypes.length > 0) {
    query = query.in('document_type_id', filters.documentTypes)
  }
  
  if (filters.statuses && filters.statuses.length > 0) {
    query = query.in('status', filters.statuses)
  }
  
  if (filters.projectCodes && filters.projectCodes.length > 0) {
    query = query.in('project_code', filters.projectCodes)
  }

  // User filters
  if (filters.createdBy) {
    query = query.eq('created_by', filters.createdBy)
  }
  
  if (filters.releasedBy) {
    query = query.eq('released_by', filters.releasedBy)
  }

  // Production/Prototype filter
  if (filters.isProduction !== null && filters.isProduction !== undefined) {
    query = query.eq('is_production', filters.isProduction)
  }

  // My Documents filter
  if (filters.myDocumentsOnly) {
    query = query.eq('created_by', user.id)
  }

  // Sorting
  const sortBy = filters.sortBy || 'updated_at'
  const sortOrder = filters.sortOrder || 'desc'
  query = query.order(sortBy, { ascending: sortOrder === 'asc' })

  // Pagination
  const page = filters.page || 1
  const pageSize = filters.pageSize || 50
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  query = query.range(from, to)

  // Execute query
  const { data: documents, error, count } = await query

  if (error) {
    console.error('[Advanced Search] Query error:', error)
    throw new Error(`Search failed: ${error.message}`)
  }

  let filteredDocuments = documents || []

  // Post-process: Filter by hasAttachments (can't do efficiently in query)
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
    } else if (filters.hasAttachments === false) {
      // No documents returned but user wants docs without files - that's fine
    } else {
      // No documents and user wants docs with files - return empty
      filteredDocuments = []
    }
  }

  // Enrich with creator/releaser user info from shared.users
  const userIds = [...new Set([
    ...filteredDocuments.map((d: any) => d.created_by).filter(Boolean),
    ...filteredDocuments.map((d: any) => d.released_by).filter(Boolean),
  ])]
  let userMap: Record<string, { email: string; full_name: string | null }> = {}
  if (userIds.length > 0) {
    const sharedClient = createSharedClient()
    const { data: userRows } = await sharedClient
      .schema('shared')
      .from('users')
      .select('id, email, full_name')
      .in('id', userIds)
    userMap = Object.fromEntries((userRows || []).map((u: any) => [u.id, { email: u.email, full_name: u.full_name }]))
  }

  const enrichedDocuments = filteredDocuments.map((doc: any) => ({
    ...doc,
    created_by_user: doc.created_by ? userMap[doc.created_by] ?? null : null,
    released_by_user: doc.released_by ? userMap[doc.released_by] ?? null : null,
  }))

  const totalCount = count || 0
  const totalPages = Math.ceil(totalCount / pageSize)

  return {
    documents: enrichedDocuments,
    totalCount,
    page,
    pageSize,
    totalPages,
    hasMore: page < totalPages
  }
}

/**
 * Get all users for filter dropdown
 */
export async function getUsersForFilters() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const sharedClient = createSharedClient()
  const { data: userData } = await sharedClient
    .schema('shared')
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (!userData?.tenant_id) return []

  const { data: users } = await sharedClient
    .schema('shared')
    .from('users')
    .select('id, email, full_name')
    .eq('tenant_id', userData.tenant_id)
    .order('full_name', { ascending: true, nullsFirst: false })

  return users || []
}

/**
 * Get all unique project codes for filter dropdown
 */
export async function getProjectCodesForFilters() {
  const tenantId = await getSubdomainTenantId()
  if (!tenantId) return []

  const supabase = await createClient()
  const { data: documents } = await createServiceRoleClient()
    .schema('docs')
    .from('documents')
    .select('project_code')
    .eq('tenant_id', tenantId)
    .not('project_code', 'is', null)
    .order('project_code')

  // Get unique, sorted project codes
  const uniqueCodes = [...new Set(
    documents?.map(d => d.project_code).filter(Boolean) || []
  )].sort()
  
  return uniqueCodes as string[]
}

/**
 * Get all active document types for filter dropdown
 */
export async function getDocumentTypesForFilters() {
  // Use subdomain tenant context — more reliable than JWT tenant for master admins
  const tenantId = await getSubdomainTenantId()
  if (!tenantId) return []

  const sr = createServiceRoleClient()
  const { data: types } = await sr
    .schema('docs')
    .from('document_types')
    .select('id, name, prefix')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('prefix')

  return types || []
}
