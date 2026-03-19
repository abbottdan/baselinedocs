/**
 * app/system-admin/layout.tsx — BaselineDocs
 * CHANGED: queries shared.users.is_master_admin instead of public.users
 */
import { createSharedClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function SystemAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const sharedClient = createSharedClient()
  const { data: sharedUser } = await sharedClient
    .schema('shared')
    .from('users')
    .select('is_master_admin, full_name')
    .eq('id', user.id)
    .single()

  if (!sharedUser?.is_master_admin) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">System Administration</h1>
              <p className="text-sm text-gray-600">
                Logged in as {sharedUser.full_name} (Master Admin)
              </p>
            </div>
            <div className="flex gap-4">
              <a href="/dashboard" className="text-sm text-blue-600 hover:text-blue-700">
                ← Back to Dashboard
              </a>
            </div>
          </div>
        </div>
      </div>
      {children}
    </div>
  )
}
