import { createClient, createServiceRoleClient , createSharedClient} from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { cookies } from 'next/headers'
import StorageLimitBanner from '@/components/admin/StorageLimitBanner'
import { redirect } from 'next/navigation'
import DocumentsSearchPage from './DocumentsSearchPage'
import {
  searchDocuments,
  getUsersForFilters,
  getProjectCodesForFilters,
  getDocumentTypesForFilters
} from '@/app/actions/advanced-search'
import type { AdvancedSearchFilters } from '@/lib/types/advanced-search'

// Disable caching
export const revalidate = 0

interface PageProps {
  searchParams: {
    selected?: string  // Document number for split-panel view
    q?: string
    createdAfter?: string
    createdBefore?: string
    updatedAfter?: string
    updatedBefore?: string
    releasedAfter?: string
    releasedBefore?: string
    types?: string
    statuses?: string
    projects?: string
    createdBy?: string
    releasedBy?: string
    isProduction?: string
    hasAttachments?: string
    myDocs?: string
    page?: string
    sortBy?: string
    sortOrder?: string
  }
}

export default async function DocumentsPage({ searchParams }: PageProps) {
  const supabase = await createClient()

  // Check authentication
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  
  if (userError || !user) {
    redirect('/')
  }

  // Get user's tenant and admin status (single query)
  const sharedClient = createSharedClient()
  const { data: _su } = await sharedClient
    .schema('shared')
    .from('users')
    .select('is_master_admin, tenant_id')
    .eq('id', user.id)
    .single()
  let _roleIsAdmin = false
  if (_su && !_su.is_master_admin) {
    const { data: rr } = await supabase
      .schema('docs').from('user_roles')
      .select('role').eq('user_id', user.id)
      .eq('tenant_id', _su.tenant_id).single()
    _roleIsAdmin = ['tenant_admin','master_admin'].includes(rr?.role ?? '')
  }
  const userData = { is_admin: _su?.is_master_admin || _roleIsAdmin, tenant_id: _su?.tenant_id }
  const isAdmin = userData?.is_admin || false

  // Get subdomain tenant (for multi-tenant support)
  const cookieStore = await cookies()
  const subdomainCookie = cookieStore.get('tenant_subdomain')
  const subdomain = subdomainCookie?.value

  let tenantId = userData?.tenant_id

  if (subdomain) {
    const { data: subdomainTenant } = await createPlatformClient()
        .schema('platform').from('tenants')
      .select('id')
      .eq('subdomain', subdomain)
      .single()
    
    if (subdomainTenant) {
      tenantId = subdomainTenant.id
    }
  }

  // ⭐ GET STORAGE INFO FOR BANNER ⭐
  const supabaseAdmin = createServiceRoleClient()

  // Get billing info
  const { data: billingData } = await createPlatformClient()
      .schema('platform').from('product_subscriptions')
    .select('plan, storage_limit_gb')
    .eq('tenant_id', tenantId)
    .single()

  // Calculate current storage (use admin to bypass RLS)
  const { data: files } = await supabaseAdmin
    .from('document_files')
    .select('file_size, documents!inner(tenant_id)')
    .eq('documents.tenant_id', tenantId)

  const currentStorageBytes = files?.reduce((sum, f) => sum + (f.file_size || 0), 0) || 0
  const currentStorageGB = currentStorageBytes / (1024 * 1024 * 1024)

  const plan = billingData?.plan || 'trial'
  const PLAN_STORAGE_GB: Record<string, number> = {
    trial: 1, starter: 5, professional: 25, enterprise: 100,
  }
  const storageLimitGB: number =
    billingData?.storage_limit_gb != null
      ? Number(billingData.storage_limit_gb)
      : (PLAN_STORAGE_GB[plan] ?? 1)

  // Parse search params into filters
  const filters: AdvancedSearchFilters = {
    searchQuery: searchParams.q,
    createdAfter: searchParams.createdAfter,
    createdBefore: searchParams.createdBefore,
    updatedAfter: searchParams.updatedAfter,
    updatedBefore: searchParams.updatedBefore,
    releasedAfter: searchParams.releasedAfter,
    releasedBefore: searchParams.releasedBefore,
    documentTypes: searchParams.types ? searchParams.types.split(',') : undefined,
    statuses: searchParams.statuses ? searchParams.statuses.split(',') : ['Draft', 'In Approval', 'Released'],
    projectCodes: searchParams.projects ? searchParams.projects.split(',') : undefined,
    createdBy: searchParams.createdBy,
    releasedBy: searchParams.releasedBy,
    isProduction: searchParams.isProduction ? searchParams.isProduction === 'true' : null,
    hasAttachments: searchParams.hasAttachments ? searchParams.hasAttachments === 'true' : null,
    myDocumentsOnly: searchParams.myDocs === 'true',
    page: searchParams.page ? parseInt(searchParams.page) : 1,
    pageSize: 50,
    sortBy: (searchParams.sortBy as any) || 'updated_at',
    sortOrder: (searchParams.sortOrder as any) || 'desc'
  }

  // Fetch data in parallel
  const [searchResults, users, projectCodes, documentTypes] = await Promise.all([
    searchDocuments(filters),
    getUsersForFilters(),
    getProjectCodesForFilters(),
    getDocumentTypesForFilters()
  ])

  return (
    <>
      {/* ⭐ STORAGE BANNER ⭐ */}
      <StorageLimitBanner 
        currentStorageGB={currentStorageGB}
        storageLimitGB={storageLimitGB}
        plan={plan}
      />

      <DocumentsSearchPage
        initialFilters={filters}
        initialResults={searchResults}
        documentTypes={documentTypes}
        users={users}
        projectCodes={projectCodes}
        isAdmin={isAdmin}
        currentUserId={user.id}
      />
    </>
  )
}
