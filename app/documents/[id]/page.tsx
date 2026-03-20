import { createClient, createServiceRoleClient, createSharedClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { fetchDocumentVersions } from '@/lib/document-helpers'
import { getSubdomainTenantId, getCurrentSubdomain } from '@/lib/tenant'
import { checkBaselineReqsReferencesForAllVersions } from '@/lib/integrations/baselinereqs'
import DocumentDetailPanel from '../DocumentDetailPanel'
import DocumentActionsPanel from '../DocumentActionsPanel'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PageProps {
  params: { id: string }
}

export default async function DocumentDetailPage({ params }: PageProps) {
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth/login')
  }

  // Check if user is admin
  const sharedClient = createSharedClient()
    const { data: sharedUser } = await sharedClient
      .schema('shared')
      .from('users')
      .select('is_master_admin, tenant_id, is_active')
      .eq('id', user.id)
      .single()
    // Derive is_admin for backwards compat
    let _roleRow: any = null
    if (sharedUser && !sharedUser.is_master_admin) {
      const { data: rr } = await createServiceRoleClient()
        .schema('docs').from('user_roles')
        .select('role').eq('user_id', user.id)
        .eq('tenant_id', sharedUser.tenant_id).single()
      _roleRow = rr
    }
    const userData = {
      is_admin: sharedUser?.is_master_admin || ['tenant_admin','master_admin'].includes(_roleRow?.role ?? ''),
      is_master_admin: sharedUser?.is_master_admin ?? false,
      tenant_id: sharedUser?.tenant_id,
    }

  if (!userData) {
    redirect('/auth/login')
  }

  const isAdmin = userData?.is_admin || false

  // Get tenant from CURRENT SUBDOMAIN
  const subdomainTenantId = await getSubdomainTenantId()
  const subdomain = await getCurrentSubdomain()
  
  if (!subdomainTenantId) {
    notFound()
  }

  // Fetch the document to get its document_number
  const { data: document } = await createServiceRoleClient()
    .schema('docs')
    .from('documents')
    .select('document_number, tenant_id')
    .eq('id', params.id)
    .single()

  if (!document) {
    notFound()
  }

  // Verify tenant access - document must belong to CURRENT SUBDOMAIN's tenant
  if (document.tenant_id !== subdomainTenantId) {
    notFound()
  }

  // Fetch all versions of this document
  const documentData = await fetchDocumentVersions(document.document_number, user.id)

  if (!documentData) {
    notFound()
  }

  // Get available users for approver assignment (if admin or creator)
  const { data: availableUsers } = await createSharedClient()
      .schema('shared')
      .from('users')
      .select('id, email, full_name')
      .eq('tenant_id', subdomainTenantId)
      .eq('is_active', true)
      .order('full_name')

  // Fetch audit logs for ALL versions of this document (cross-version history)
  const { data: auditLogs, error: auditError } = await createServiceRoleClient()
    .schema('docs')
    .from('audit_log')
    .select('*')
    .eq('tenant_id', document.tenant_id)
    .in('document_id', documentData.allVersions.map(v => v.id))
    .order('created_at', { ascending: false })
    .limit(50)
  
  // Log for debugging
  if (auditError) {
    console.error('Audit log query error:', auditError)
  } else {
    console.log('Audit logs fetched:', {
      documentNumber: document.document_number,
      tenantId: document.tenant_id,
      count: auditLogs?.length || 0
    })
  }

  // ── BaselineReqs badge: aggregate references across ALL versions of this document.
  // BaselineReqs stores links by URL, and each version has its own UUID/URL.
  // A requirement linked to vA stays linked to that URL even after v1 is released,
  // so we check every version ID and merge the results to show the full picture.
  // Cached for 5 minutes via Next.js fetch cache.
  let baselineReqsRefs = null
  if (subdomain && documentData.allVersions.length > 0) {
    const allVersionIds = documentData.allVersions.map((v) => v.id)
    baselineReqsRefs = await checkBaselineReqsReferencesForAllVersions(subdomain, allVersionIds, 300)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header with back button */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Button
            variant="ghost"
            asChild
            className="mb-0"
          >
            <Link href="/documents" className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Documents
            </Link>
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left: Document Details */}
          <div>
            <DocumentDetailPanel
              documentData={documentData}
              availableUsers={availableUsers || []}
              isAdmin={isAdmin}
              currentUserId={user.id}
              currentUserEmail={user.email || ''}
              baselineReqsRefs={baselineReqsRefs}
            />
          </div>

          {/* Right: Actions & History */}
          <div>
            <DocumentActionsPanel
              documentData={documentData}
              auditLogs={auditLogs || []}
              isAdmin={isAdmin}
              currentUserId={user.id}
              currentUserEmail={user.email || ''}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
