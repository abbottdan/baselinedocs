'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Shield } from 'lucide-react'

const baseTabs = [
  { href: '/admin/users', label: 'User Management' },
  { href: '/admin/billing', label: 'Billing' },
  { href: '/admin/settings', label: 'Company Settings' },
  { href: '/admin/document-types', label: 'Document Types' },
  { href: '/admin/export', label: 'Export' },
]

interface AdminNavTabsProps {
  isMasterAdmin: boolean
}

export default function AdminNavTabs({ isMasterAdmin }: AdminNavTabsProps) {
  const pathname = usePathname()

  const tabs = baseTabs.filter(tab => {
    return true
  })

  return (
    <div className="mb-6">
      <nav className="flex space-x-4 border-b border-gray-200">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href)
          
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-700 hover:text-blue-600 hover:border-b-2 hover:border-blue-300'
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
        
        {/* System Admin tab - only for master admins */}
        {isMasterAdmin && (
          <Link
            href="/system-admin"
            className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1 ${
              pathname.startsWith('/system-admin')
                ? 'text-purple-600 border-b-2 border-purple-600'
                : 'text-gray-700 hover:text-purple-600 hover:border-b-2 hover:border-purple-300'
            }`}
          >
            <Shield className="h-4 w-4" />
            System Admin
          </Link>
        )}
      </nav>
    </div>
  )
}
