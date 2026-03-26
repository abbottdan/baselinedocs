// app/trial-expired/page.tsx — ALL THREE PRODUCTS (identical)
// Add to isPublicPath() in middleware.ts: pathname.startsWith('/trial-expired')

import Link from 'next/link'

export const metadata = { title: 'Trial Ended' }

export default function TrialExpiredPage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⏰</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1E293B', marginBottom: 12 }}>
          Your trial has ended
        </h1>
        <p style={{ fontSize: 16, color: '#64748B', lineHeight: 1.6, marginBottom: 32 }}>
          Your 30-day free trial is over. Choose a plan to restore access for your team.
          Your data is safe and will be available as soon as you subscribe.
        </p>
        <Link
          href="/admin/billing"
          style={{
            display: 'inline-block',
            backgroundColor: '#1E293B',
            color: '#ffffff',
            padding: '12px 28px',
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          View Plans &amp; Subscribe
        </Link>
        <p style={{ fontSize: 13, color: '#94A3B8', marginTop: 24 }}>
          Questions?{' '}
          <a href="mailto:support@clearstridetools.com" style={{ color: '#475569', textDecoration: 'underline' }}>
            Contact support
          </a>
        </p>
      </div>
    </div>
  )
}
