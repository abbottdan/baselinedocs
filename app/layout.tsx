import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Navigation from '@/components/dashboard/Navigation'
import { createClient, createSharedClient } from '@/lib/supabase/server'
import { Toaster } from 'sonner'
import { TenantThemeProvider } from '@/components/TenantThemeProvider'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'BaselineDocs',
  description: 'Professional Document Control & Version Management',
  icons: {
    icon: [
      { url: '/icon.png',     sizes: '32x32',   type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  verification: {
    google: 'j4lxs7P85HywcD0KshopP0LymuTmUwHZQaacgY5Ixf8',
  },
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let isAdmin = false
  let fullName = ''
  let userRole = null

  if (user) {
    // CHANGED: query shared.users for identity fields — no 'role' or 'is_admin' column there.
    // is_admin is derived from docs.user_roles via the public.users compatibility view.
    const sharedClient = createSharedClient()
    const { data: sharedUser } = await sharedClient
      .schema('shared')
      .from('users')
      .select('full_name, is_master_admin')
      .eq('id', user.id)
      .single()

    fullName = sharedUser?.full_name || ''

    // Master admins are always admins
    if (sharedUser?.is_master_admin) {
      isAdmin = true
      userRole = 'Admin'
    } else {
      // Check role in docs.user_roles for regular users
      const { data: roleRow } = await supabase
        .schema('docs')
        .from('user_roles')
        .select('role')
        .eq('id', user.id)
        .single()

      const role = roleRow?.role || 'user'
      isAdmin = ['tenant_admin', 'master_admin'].includes(role)
      userRole = isAdmin ? 'Admin' : 'Normal'
    }
  }

  return (
    <html lang="en">
      <body className={inter.className}>
        <TenantThemeProvider>
          {user && <Navigation user={{ email: user.email || '', fullName }} isAdmin={isAdmin} userRole={userRole} />}
          <main className="min-h-screen">
            {children}
          </main>
          <Toaster position="top-right" />
        </TenantThemeProvider>
      </body>
    </html>
  )
}
