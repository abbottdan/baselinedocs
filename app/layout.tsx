import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Navigation from '@/components/dashboard/Navigation'
import { createClient } from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { getCurrentSubdomain } from '@/lib/tenant'
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
  let companyLogo: string | null = null
  if (user) {
    const { data: userData } = await supabase
      .from('users')
      .select('is_admin, full_name, role')
      .eq('id', user.id)
      .single()
    
    isAdmin = userData?.is_admin || false
    fullName = userData?.full_name || ''
    userRole = userData?.role || null

    // Fetch company logo from platform tenants (server-side, replaces client-side tenants query)
    const { data: tenantRow } = await createPlatformClient()
      .schema('platform')
      .from('tenants')
      .select('logo_url')
      .eq('subdomain', await getCurrentSubdomain())
      .single()
    companyLogo = tenantRow?.logo_url ?? null
  }

  return (
    <html lang="en">
      <body className={inter.className}>
        <TenantThemeProvider>
          {user && <Navigation user={{ email: user.email || '', fullName }} isAdmin={isAdmin} companyLogo={companyLogo} userRole={userRole} />}
          <main className="min-h-screen">
            {children}
          </main>
          <Toaster position="top-right" />
        </TenantThemeProvider>
      </body>
    </html>
  )
}
