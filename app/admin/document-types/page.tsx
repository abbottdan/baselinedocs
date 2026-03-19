import { redirect } from 'next/navigation';
import { createClient, createSharedClient } from '@/lib/supabase/server'
import { getDocumentTypes } from '@/app/actions/document-types';
import DocumentTypesTable from '@/components/document-types/DocumentTypesTable';
import Link from 'next/link';

export default async function DocumentTypesPage() {
  const supabase = await createClient();
  
  // Check authentication
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect('/');
  }

  // Check admin access
  const { data: userData } = await supabase
    .schema('shared')
    .from('users')
    .select('is_master_admin')
    .eq('id', user.id)
    .single();

  if (!userData?.is_admin) {
    redirect('/dashboard');
  }

  // Get document types
  const result = await getDocumentTypes(false);
  const documentTypes = result.success ? result.data || [] : [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Document Types</h1>
              <p className="mt-2 text-slate-600">
                Configure document type prefixes and numbering for the system
              </p>
            </div>
            <Link
              href="/admin/document-types/new"
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <svg
                className="-ml-1 mr-2 h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Add Document Type
            </Link>
          </div>
        </div>

        {/* Info Card */}
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
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
            <div className="ml-3 flex-1">
              <p className="text-sm text-blue-700">
                <strong>Document types define the prefixes and numbering for documents.</strong> For
                example, "Form" with prefix "FORM" will create documents like FORM-00001vA. Inactive
                types won't appear in document creation but existing documents remain valid.
              </p>
            </div>
          </div>
        </div>

        {/* Document Types Table */}
        <div className="bg-white shadow-md rounded-lg overflow-hidden">
          {documentTypes.length === 0 ? (
            <div className="text-center py-12">
              <svg
                className="mx-auto h-12 w-12 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-slate-900">No document types</h3>
              <p className="mt-1 text-sm text-slate-500">
                Get started by creating your first document type.
              </p>
              <div className="mt-6">
                <Link
                  href="/admin/document-types/new"
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
                >
                  <svg
                    className="-ml-1 mr-2 h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  Add Document Type
                </Link>
              </div>
            </div>
          ) : (
            <DocumentTypesTable documentTypes={documentTypes} />
          )}
        </div>
      </div>
    </div>
  );
}
