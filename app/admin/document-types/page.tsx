/**
 * app/admin/document-types/page.tsx — BaselineDocs
 * CHANGED: Admin check via shared.users + docs.user_roles
 */
import { createClient, createSharedClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getDocumentTypes } from '@/app/actions/document-types'
import DocumentTypesTable from '@/components/document-types/DocumentTypesTable'
import Link from 'next/link'

export default async function DocumentTypesPage() {
  const supabase     = await createClient()
  const sharedClient = createSharedClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const { data: sharedUser } = await sharedClient
    .schema('shared')
    .from('users')
    .select('tenant_id, is_master_admin, is_active')
    .eq('id', user.id)
    .single()

  if (!sharedUser?.is_active) redirect('/dashboard')

  if (!sharedUser.is_master_admin) {
    const { data: roleRow } = await supabase
      .schema('docs')
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('tenant_id', sharedUser.tenant_id)
      .single()
    if (!['tenant_admin', 'master_admin'].includes(roleRow?.role ?? '')) {
      redirect('/dashboard')
    }
  }

  const result = await getDocumentTypes(false)
  const documentTypes = result.success ? result.data : []

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Document Types</h2>
          <p className="mt-1 text-gray-600">Configure document type prefixes and numbering</p>
        </div>
        <Link
          href="/admin/document-types/new"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          + New Document Type
        </Link>
      </div>
      <DocumentTypesTable documentTypes={documentTypes || []} />
    </div>
  )
}
