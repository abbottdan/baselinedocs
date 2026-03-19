import { createClient, createServiceRoleClient, createSharedClient } from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { getSubdomainTenantId } from '@/lib/tenant'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FileText, Clock, User, CheckCircle, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getGreetingWithName } from '@/lib/utils/greetings'
import RecentActivityFeed from '@/components/dashboard/RecentActivityFeed'

// Disable caching but allow dynamic rendering
export const revalidate = 0

export default async function DashboardPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  // Get user's full name
  const sharedClient = createSharedClient()
    const { data: userData } = await sharedClient
      .schema('shared')
      .from('users')
      .select('full_name, tenant_id, is_master_admin, is_active')
      .eq('id', user.id)
      .single()

  // Get tenant from CURRENT SUBDOMAIN
  const tenantId = await getSubdomainTenantId()

  // Get tenant info (company name and timezone)
  let tenant = null
  if (tenantId) {
    const platformClient = createPlatformClient()
    const { data: tenantData } = await platformClient
      .schema('platform')
      .from('tenants')
      .select('id, company_name, subdomain, logo_url, timezone')
      .eq('id', userData?.tenant_id)
      .single()
    
    tenant = tenantData
  }

  // Server-side greeting with timezone
  const greeting = getGreetingWithName(userData?.full_name, tenant?.timezone)

  // Get total documents count (filtered by subdomain tenant)
  const { count: totalDocuments } = await supabase
    .schema('docs')
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)

  // Get documents pending approval (where I'm an approver with Pending status and document is In Approval)
  const { data: pendingApprovals } = await supabase
    .from('approvers')
    .select('document_id, document:documents!inner(status, tenant_id)')
    .eq('user_email', user.email)
    .eq('status', 'Pending')
    .eq('document.status', 'In Approval')
    .eq('document.tenant_id', tenantId)

  const pendingApprovalsCount = pendingApprovals?.length || 0

  // Get my documents (documents I created in this tenant)
  const { count: myDocumentsCount } = await supabase
    .schema('docs')
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', user.id)
    .eq('tenant_id', tenantId)

  // Get released documents count (in this tenant)
  const { count: releasedDocumentsCount } = await supabase
    .schema('docs')
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'Released')
    .eq('tenant_id', tenantId)

  return (
    <div className="space-y-6">
      {/* Header with Greeting and New Document Button */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {greeting}
          </h1>
          {tenant?.company_name && (
            <p className="text-lg font-semibold text-blue-600 mb-1">
              {tenant.company_name}
            </p>
          )}
          <p className="text-gray-600">
            Here's what's happening with your documents
          </p>
        </div>
        <Link href="/documents/new">
          <Button className="bg-blue-600 hover:bg-blue-700">
            <Plus className="mr-2 h-4 w-4" />
            New Document
          </Button>
        </Link>
      </div>

      {/* Statistics Cards - Add class for tour targeting */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 dashboard-stats">
        {/* Total Documents */}
        <Link href="/documents">
          <Card className="hover:shadow-lg cursor-pointer transition-all hover:border-blue-300">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center justify-between">
                Total Documents
                <FileText className="h-4 w-4 text-gray-500" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">{totalDocuments || 0}</div>
              <p className="text-xs text-gray-500 mt-1">Click to view all</p>
            </CardContent>
          </Card>
        </Link>

        {/* Pending Approvals */}
        <Link href="/approvals">
          <Card className="hover:shadow-lg cursor-pointer transition-all hover:border-blue-300">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center justify-between">
                Pending Approvals
                <Clock className="h-4 w-4 text-gray-500" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">{pendingApprovalsCount}</div>
              <p className="text-xs text-gray-500 mt-1">Awaiting your review</p>
            </CardContent>
          </Card>
        </Link>

        {/* My Documents */}
        <Link href="/documents?filter=my">
          <Card className="hover:shadow-lg cursor-pointer transition-all hover:border-blue-300">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center justify-between">
                My Documents
                <User className="h-4 w-4 text-gray-500" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">{myDocumentsCount || 0}</div>
              <p className="text-xs text-gray-500 mt-1">Documents you created</p>
            </CardContent>
          </Card>
        </Link>

        {/* Released Documents */}
        <Link href="/documents?status=Released">
          <Card className="hover:shadow-lg cursor-pointer transition-all hover:border-blue-300">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center justify-between">
                Released Documents
                <CheckCircle className="h-4 w-4 text-gray-500" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">{releasedDocumentsCount || 0}</div>
              <p className="text-xs text-gray-500 mt-1">Active documents</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Recent Activity */}
      <RecentActivityFeed />
    </div>
  )
}
