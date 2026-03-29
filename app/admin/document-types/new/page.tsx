import { requireAdmin } from '@/lib/auth/require-admin'
import { redirect } from 'next/navigation';
import { createClient , createSharedClient, createServiceRoleClient} from '@/lib/supabase/server';
import DocumentTypeForm from '@/components/document-types/DocumentTypeForm';

export default async function NewDocumentTypePage() {
  const supabase = await createClient();
  
  // Check authentication
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect('/');
  }

  // Check admin access — allows master_admin and tenant_admin
  const { isAdmin, isMasterAdmin, tenantId: userTenantId } = await requireAdmin(user!.id, supabase)
  if (!isAdmin) {
    redirect('/dashboard')
  }
  const userData = {
    is_admin: isAdmin,
    is_master_admin: isMasterAdmin,
    tenant_id: userTenantId,
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Add Document Type</h1>
          <p className="mt-2 text-slate-600">
            Create a new document type with a unique prefix for numbering
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white shadow-md rounded-lg p-6">
          <DocumentTypeForm mode="create" />
        </div>
      </div>
    </div>
  );
}
