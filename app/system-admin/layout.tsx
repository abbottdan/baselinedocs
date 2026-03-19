/**
 * System Admin Layout
 * app/system-admin/layout.tsx
 */

import { createClient, createSharedClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function SystemAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  // Check authentication
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/auth/login')
  }

  // Check master admin status
  const { data: userData } = await supabase
    .schema('shared')
    .from('users')
    .select('is_master_admin, full_name')
    .eq('id', user.id)
    .single()

  if (!userData?.is_master_admin) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">System Administration</h1>
              <p className="text-sm text-gray-600">
                Logged in as {userData.full_name} (Master Admin)
              </p>
            </div>
            <div className="flex gap-4">
              <a
                href="/dashboard"
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                ← Back to Dashboard
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      {children}
    </div>
  )
}
