'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download, FileText, ClipboardList, Loader2 } from 'lucide-react'

interface ExportCardProps {
  title: string
  description: string
  details: string[]
  endpoint: string
  filename: string
  icon: React.ReactNode
}

function ExportCard({ title, description, details, endpoint, icon }: ExportCardProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleExport = async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(endpoint)

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Export failed (${res.status})`)
      }

      // Trigger browser download from the streamed response
      const blob = await res.blob()
      const contentDisposition = res.headers.get('Content-Disposition') || ''
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/)
      const downloadName = filenameMatch?.[1] ?? 'export.csv'

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = downloadName
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="p-2 bg-blue-50 rounded-lg text-blue-600 flex-shrink-0">
            {icon}
          </div>
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="text-sm text-gray-600 space-y-1 mb-4">
          {details.map((d, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-gray-400 mt-0.5">•</span>
              {d}
            </li>
          ))}
        </ul>

        {error && (
          <p className="text-sm text-red-600 mb-3">{error}</p>
        )}

        <Button
          onClick={handleExport}
          disabled={loading}
          variant="outline"
          className="gap-2"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {loading ? 'Preparing...' : 'Download CSV'}
        </Button>
      </CardContent>
    </Card>
  )
}

export default function AdminExportPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Data Export</h2>
        <p className="text-sm text-gray-600 mt-1">
          Export your organization's data as CSV files. All exports include every record
          regardless of status or date — suitable for archiving or migration.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <ExportCard
          title="Document Archive"
          description="All document records across every version and status."
          details={[
            'Document number, version, title, description',
            'Document type, status, classification (Prototype / Production)',
            'Project code, created by, released by',
            'Created, updated, and released timestamps',
            'All statuses included: Draft, In Approval, Released, Obsolete',
          ]}
          endpoint="/api/admin/export/documents"
          filename="documents-export.csv"
          icon={<FileText className="h-5 w-5" />}
        />

        <ExportCard
          title="Audit Log Archive"
          description="Complete history of every action taken on every document."
          details={[
            'Timestamp, action type, and performing user for every event',
            'Covers all document lifecycle events: create, edit, submit, approve, release',
            'Includes file uploads, rejections, version creation, and admin actions',
            'Sorted newest first',
          ]}
          endpoint="/api/admin/export/audit-log"
          filename="audit-log.csv"
          icon={<ClipboardList className="h-5 w-5" />}
        />
      </div>

      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="pt-4 pb-4">
          <p className="text-sm text-amber-800">
            <strong>Note:</strong> These exports contain document metadata and activity history only.
            Attached files are stored in Supabase Storage and are not included in these CSVs.
            Contact support if you need a full file archive.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
