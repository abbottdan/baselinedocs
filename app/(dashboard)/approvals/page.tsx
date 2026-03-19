import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ApprovalsListClient from './ApprovalsListClient'

export default async function MyApprovalsPage() {
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/')
  }

  // Get all approvals for current user with document files
  const { data: approvals, error } = await supabase
    .from('approvers')
    .select(`
      *,
      document:documents!inner (
        id,
        document_number,
        version,
        title,
        description,
        status,
        is_production,
        created_at,
        project_code,
        created_by,
        document_type:document_types (
          name,
          prefix
        ),
        document_files (
          id,
          file_name,
          file_size
        )
      )
    `)
    .eq('user_email', user.email)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Fetch approvals error:', error)
  }

  const approvalsList = approvals || []

  // Filter out any approvals where document is null (extra safety)
  const validApprovals = approvalsList.filter(a => a.document !== null)

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">My Approvals</h1>
        <p className="text-gray-600 mt-2">
          Review and approve or reject documents assigned to you
        </p>
      </div>

      <ApprovalsListClient approvals={validApprovals} />
    </div>
  )
}
