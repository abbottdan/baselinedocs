import { redirect } from 'next/navigation'
import { getCurrentUser, currentUserHasRole } from '@/lib/tenant'
import AdminNavTabs from './AdminNavTabs'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/auth/login')
  if (!await currentUserHasRole('tenant_admin')) redirect('/dashboard')

  const subdomain = user.tenant?.subdomain

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8FAFC', paddingTop: 32, paddingBottom: 32 }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 16px' }}>
        <div className="space-y-6">

          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Administration</h1>
            <p className="text-sm text-slate-500 mt-0.5">Manage your organisation settings and users</p>
          </div>

          {/* Cross-product switcher */}
          {subdomain && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-400 uppercase tracking-wide text-[10px]">Also manage:</span>
              <a
                href={`https://${subdomain}.${process.env.NEXT_PUBLIC_REQS_DOMAIN ?? 'baselinereqs.com'}/admin/users`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-600 hover:border-[#DC2626] hover:text-[#DC2626] transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626]" />
                BaselineReqs
              </a>
              <a
                href={`https://${subdomain}.${process.env.NEXT_PUBLIC_INVENTORY_DOMAIN ?? 'baselineinventory.com'}/admin/users`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-600 hover:border-[#15803D] hover:text-[#15803D] transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#15803D]" />
                BaselineInventory
              </a>
            </div>
          )}

          {/* Tab bar */}
          <AdminNavTabs />

          {children}
        </div>
      </div>
    </div>
  )
}
