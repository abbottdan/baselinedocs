'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Docs-specific tabs — no System Admin link
const TABS = [
  { href: '/admin/users',          label: 'User Management' },
  { href: '/admin/billing',        label: 'Billing' },
  { href: '/admin/settings',       label: 'Company Settings' },
  { href: '/admin/document-types', label: 'Document Types' },
  { href: '/admin/export',         label: 'Export' },
]

// Clarity Blue — BaselineDocs product accent
const ACTIVE_COLOR = '#2563EB'

export default function AdminNavTabs() {
  const pathname = usePathname()

  return (
    <div className="flex gap-1 border-b border-slate-200">
      {TABS.map(({ href, label }) => {
        const isActive = pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className="px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap"
            style={{
              color:        isActive ? ACTIVE_COLOR : '#64748b',
              borderBottom: isActive ? `2px solid ${ACTIVE_COLOR}` : '2px solid transparent',
            }}
          >
            {label}
          </Link>
        )
      })}
    </div>
  )
}
