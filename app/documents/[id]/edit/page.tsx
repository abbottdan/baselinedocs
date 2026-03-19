import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { getSubdomainTenantId } from '@/lib/tenant'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import EditDocumentForm from './EditDocumentForm'

interface PageProps {
  params: {
    id: string
  }
}

export default async function EditDocumentPage({ params }: PageProps) {
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/auth/login')
  }

  // Get tenant from CURRENT SUBDOMAIN
  const subdomainTenantId = await getSubdomainTenantId()
  
  if (!subdomainTenantId) {
    notFound()
  }

  // Get document with approvers
  const { data: document, error } = await supabase
    .schema('docs')
    .from('documents')
    .select(`
      *,
      document_type:document_types(id, name, prefix),
      document_files(*),
      approvers!approvers_document_id_fkey(*)
    `)
    .eq('id', params.id)
    .single()

  if (error || !document) {
    notFound()
  }

  // Verify tenant access - document must belong to CURRENT SUBDOMAIN's tenant
  if (document.tenant_id !== subdomainTenantId) {
    notFound()
  }

  // Check permissions
  if (document.created_by !== user.id) {
    redirect('/documents')
  }

  if (document.status !== 'Draft') {
    redirect(`/documents/${params.id}`)
  }

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle>Edit Document</CardTitle>
          <CardDescription>
            Modify document details and file attachments
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EditDocumentForm 
            document={document}
          />
        </CardContent>
      </Card>
    </div>
  )
}
