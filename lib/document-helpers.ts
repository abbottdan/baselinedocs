// lib/document-helpers.ts
import { createClient , createSharedClient} from '@/lib/supabase/server'
import { getSubdomainTenantId } from '@/lib/tenant'

export interface DocumentVersion {
  id: string
  document_number: string
  version: string
  title: string
  description: string | null
  status: 'Draft' | 'In Approval' | 'Released' | 'Obsolete'
  is_production: boolean
  project_code: string | null
  created_by: string
  created_at: string
  updated_at: string
  released_at: string | null
  released_by: string | null
  document_type_id: string
  tenant_id: string
  document_type?: {
    name: string
    prefix: string
  }
  creator?: {
    email: string
    full_name: string
  }
  releaser?: {
    email: string
    full_name: string
  }
  document_files?: any[]
  approvers?: any[]
}

export interface DocumentVersionsData {
  documentNumber: string
  title: string
  latestReleased: DocumentVersion | null
  wipVersions: DocumentVersion[]
  allVersions: DocumentVersion[]
}

/**
 * Fetch all versions of a document by document number
 */
export async function fetchDocumentVersions(
  documentNumber: string,
  userId: string
): Promise<DocumentVersionsData | null> {
  const supabase = await createClient()

  // Get tenant from CURRENT SUBDOMAIN (not user's home tenant)
  const tenantId = await getSubdomainTenantId()

  if (!tenantId) {
    return null
  }

  // Fetch all versions of this document within the subdomain's tenant
  const { data: versions, error } = await supabase
    .from('documents')
    .select(`
      *,
      document_type:document_types(name, prefix),
      created_by,
      released_by,
      document_files(*),
      approvers!approvers_document_id_fkey(*)
    `)
    .eq('document_number', documentNumber)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching document versions:', error)
    return null
  }

  if (!versions || versions.length === 0) {
    return null
  }

  // Sort versions properly - prototype first (vA, vB, vC), then production (v1, v2, v3)
  const sortedVersions = [...versions].sort((a, b) => {
    const aVersion = a.version.substring(1) // Remove 'v'
    const bVersion = b.version.substring(1)
    
    // Check if numeric (production) or alpha (prototype)
    const aIsNumeric = /^\d+$/.test(aVersion)
    const bIsNumeric = /^\d+$/.test(bVersion)
    
    // If one is prototype and one is production, prototype comes first
    if (!aIsNumeric && bIsNumeric) return -1
    if (aIsNumeric && !bIsNumeric) return 1
    
    // Both are same type, sort within type
    if (aIsNumeric && bIsNumeric) {
      return parseInt(aVersion) - parseInt(bVersion)
    } else {
      return aVersion.localeCompare(bVersion)
    }
  })

  // Find latest released version
  const releasedVersions = sortedVersions.filter(v => v.status === 'Released')
  const latestReleased = releasedVersions.length > 0 
    ? releasedVersions[releasedVersions.length - 1] 
    : null

  // Find WIP versions (Draft or In Approval)
  const wipVersions = sortedVersions
    .filter(v => v.status === 'Draft' || v.status === 'In Approval')
    .reverse() // Most recent first

  return {
    documentNumber,
    title: versions[0].title, // All versions have same title
    latestReleased,
    wipVersions,
    allVersions: sortedVersions
  }
}

/**
 * Fetch a specific version by document number and version
 */
export async function fetchSpecificVersion(
  documentNumber: string,
  version: string
): Promise<DocumentVersion | null> {
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Get tenant from CURRENT SUBDOMAIN (not user's home tenant)
  const tenantId = await getSubdomainTenantId()

  if (!tenantId) return null

  const { data, error } = await supabase
    .from('documents')
    .select(`
      *,
      document_type:document_types(name, prefix),
      created_by,
      released_by,
      document_files(*),
      approvers!approvers_document_id_fkey(*)
    `)
    .eq('document_number', documentNumber)
    .eq('version', version)
    .eq('tenant_id', tenantId)
    .single()

  if (error || !data) {
    console.error('Error fetching specific version:', error)
    return null
  }

  return data
}
