import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getSubdomainTenantId } from '@/lib/tenant'
import NewDocumentForm from '../../../documents/new/NewDocumentForm'

export const metadata = {
  title: 'Create New Document',
  description: 'Create a new document with auto-generated numbering'
}

export default async function NewDocumentPage() {
  const supabase = await createClient()

  // Check authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  // Get tenant from CURRENT SUBDOMAIN
  const tenantId = await getSubdomainTenantId()
  
  if (!tenantId) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center py-12">
            <h3 className="text-sm font-medium text-gray-900">Invalid tenant context</h3>
            <p className="mt-1 text-sm text-gray-500">Please try refreshing the page.</p>
          </div>
        </div>
      </div>
    )
  }

  // Get active document types for THIS TENANT
  const { data: documentTypes, error: typesError } = await supabase
    .schema('docs')
    .from('document_types')
    .select('*')
    .eq('tenant_id', tenantId)  // ✅ Filter by subdomain's tenant
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (typesError) {
    console.error('Error fetching document types:', typesError)
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Create New Document
          </h1>
          <p className="mt-2 text-gray-600">
            Document numbers are automatically generated based on the document type you select.
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          {documentTypes && documentTypes.length > 0 ? (
            <NewDocumentForm documentTypes={documentTypes} />
          ) : (
            <div className="text-center py-12">
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">
                No document types available
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Please contact an administrator to set up document types.
              </p>
            </div>
          )}
        </div>

        {/* Help Text */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-blue-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-blue-800">
                Document Creation Tips
              </h3>
              <div className="mt-2 text-sm text-blue-700">
                <ul className="list-disc list-inside space-y-1">
                  <li>Choose <strong>Prototype</strong> for development and testing documents</li>
                  <li>Choose <strong>Production</strong> for operational documents (requires approval)</li>
                  <li>Project codes are optional but help organize related documents</li>
                  <li>Files can be uploaded now or added later</li>
                  <li>Documents start in <strong>Draft</strong> status and can be edited until released</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
