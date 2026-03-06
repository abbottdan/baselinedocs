'use client'

import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Clock, User, FileText, CheckCircle, XCircle, Edit, Trash, Upload, Download, UserPlus, UserMinus, Send, ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react'
import type { AuditLogEntry } from '@/app/actions/audit'

interface AuditTrailProps {
  auditLogs: AuditLogEntry[]
  documentNumber?: string
}

// Map actions to display names and icons
const actionConfig: Record<string, { label: string; icon: any; color: string }> = {
  // Document lifecycle
  'created': { label: 'Created', icon: FileText, color: 'text-blue-600' },
  'updated': { label: 'Updated', icon: Edit, color: 'text-gray-600' },
  'document_deleted': { label: 'Draft Deleted', icon: Trash, color: 'text-red-600' },
  'released': { label: 'Released', icon: CheckCircle, color: 'text-green-600' },
  'document_obsoleted': { label: 'Obsoleted', icon: FileText, color: 'text-gray-600' },

  // Files
  'file_uploaded': { label: 'File Uploaded', icon: Upload, color: 'text-green-600' },
  'file_deleted': { label: 'File Deleted', icon: Download, color: 'text-red-600' },
  'file_scan_completed': { label: 'Virus Scan Completed', icon: ShieldAlert, color: 'text-green-600' },
  'file_scan_failed': { label: 'Virus Scan Failed', icon: ShieldAlert, color: 'text-red-600' },

  // Approvals
  'submitted_for_approval': { label: 'Submitted', icon: Send, color: 'text-yellow-600' },
  'approved': { label: 'Approved', icon: CheckCircle, color: 'text-green-600' },
  'rejected': { label: 'Rejected', icon: XCircle, color: 'text-red-600' },
  'withdrawn_from_approval': { label: 'Withdrawn', icon: XCircle, color: 'text-orange-600' },
  'approver_added': { label: 'Approver Added', icon: UserPlus, color: 'text-blue-600' },
  'approver_removed': { label: 'Approver Removed', icon: UserMinus, color: 'text-orange-600' },

  // Versions
  'version_created': { label: 'New Version', icon: FileText, color: 'text-blue-600' },
  'promoted_to_production': { label: 'Promoted', icon: FileText, color: 'text-purple-600' },
  'converted_to_production': { label: 'Converted to Production', icon: FileText, color: 'text-purple-600' },

  // Admin actions
  'admin_status_change': { label: 'Status Changed (Admin)', icon: ShieldAlert, color: 'text-red-600' },
  'admin_delete': { label: 'Deleted (Admin)', icon: Trash, color: 'text-red-600' },
  'admin_rename': { label: 'Renamed (Admin)', icon: Edit, color: 'text-red-600' },
  'admin_change_owner': { label: 'Owner Changed (Admin)', icon: UserPlus, color: 'text-red-600' },
}

function formatDate(dateString: string) {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateForExport(dateString: string) {
  return new Date(dateString).toISOString().replace('T', ' ').substring(0, 19)
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV(auditLogs: AuditLogEntry[], documentNumber: string) {
  const headers = ['Date (UTC)', 'Action', 'Performed By', 'Details']

  const rows = auditLogs.map(entry => {
    const config = actionConfig[entry.action]
    const label = config?.label ?? entry.action

    const detailParts: string[] = []
    if (entry.details?.document_number) detailParts.push(entry.details.document_number)
    if (entry.details?.old_status && entry.details?.new_status)
      detailParts.push(`${entry.details.old_status} → ${entry.details.new_status}`)
    if (entry.details?.old_number && entry.details?.new_number)
      detailParts.push(`${entry.details.old_number} → ${entry.details.new_number}`)
    if (entry.details?.rejection_reason)
      detailParts.push(`Reason: ${entry.details.rejection_reason}`)
    if (entry.details?.comments)
      detailParts.push(`Comment: ${entry.details.comments}`)
    if (entry.details?.file_name)
      detailParts.push(`File: ${entry.details.file_name}`)

    return [
      formatDateForExport(entry.created_at),
      label,
      entry.performed_by_email,
      detailParts.join('; '),
    ]
  })

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `audit-log-${documentNumber}-${new Date().toISOString().split('T')[0]}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

// ── PDF export (print-to-PDF via a hidden window) ─────────────────────────────
function exportPDF(auditLogs: AuditLogEntry[], documentNumber: string) {
  const config = (action: string) => actionConfig[action] ?? { label: action }

  const rows = auditLogs.map(entry => {
    const label = config(entry.action).label

    const detailParts: string[] = []
    if (entry.details?.old_status && entry.details?.new_status)
      detailParts.push(`${entry.details.old_status} → ${entry.details.new_status}`)
    if (entry.details?.old_number && entry.details?.new_number)
      detailParts.push(`${entry.details.old_number} → ${entry.details.new_number}`)
    if (entry.details?.rejection_reason)
      detailParts.push(`Reason: ${entry.details.rejection_reason}`)
    if (entry.details?.comments)
      detailParts.push(`Comment: ${entry.details.comments}`)
    if (entry.details?.file_name)
      detailParts.push(`File: ${entry.details.file_name}`)

    return `
      <tr>
        <td>${formatDateForExport(entry.created_at)}</td>
        <td>${label}</td>
        <td>${entry.performed_by_email}</td>
        <td>${detailParts.join('<br>') || '—'}</td>
      </tr>`
  }).join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Audit Log — ${documentNumber}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 11px; color: #111; margin: 32px; }
    h1 { font-size: 16px; margin-bottom: 4px; }
    p.meta { color: #666; font-size: 10px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f3f4f6; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #e5e7eb; }
    td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    @media print { body { margin: 16px; } }
  </style>
</head>
<body>
  <h1>Audit Log — ${documentNumber}</h1>
  <p class="meta">Exported ${new Date().toLocaleString()} · ${auditLogs.length} entries</p>
  <table>
    <thead>
      <tr>
        <th style="width:18%">Date (UTC)</th>
        <th style="width:18%">Action</th>
        <th style="width:22%">Performed By</th>
        <th>Details</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 400)
}

function AuditLogEntryRow({ entry, isLast }: { entry: AuditLogEntry; isLast: boolean }) {
  const config = actionConfig[entry.action] || {
    label: entry.action,
    icon: Clock,
    color: 'text-gray-600',
  }

  const Icon = config.icon

  return (
    <div className="flex gap-3 pb-3 last:pb-0">
      {/* Timeline dot and line */}
      <div className="flex flex-col items-center">
        <div className={`rounded-full p-1.5 bg-gray-100 ${config.color}`}>
          <Icon className="h-3 w-3" />
        </div>
        {!isLast && <div className="w-0.5 h-full bg-gray-200 mt-1" />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium">{config.label}</span>
              <span className="text-xs text-gray-500">by {entry.performed_by_email.split('@')[0]}</span>
            </div>
          </div>
          <time className="text-xs text-gray-400 whitespace-nowrap" suppressHydrationWarning>
            {formatDate(entry.created_at)}
          </time>
        </div>

        {/* Additional details - only show important ones */}
        {entry.details && (
          <div className="mt-0.5 text-xs text-gray-600 space-y-1">
            {entry.details.document_number && (
              <p className="text-gray-500">
                <span className="font-medium">{entry.details.document_number}</span>
              </p>
            )}
            {entry.details.old_status && entry.details.new_status && (
              <p className="text-orange-700 font-medium">
                {entry.details.old_status} → {entry.details.new_status}
              </p>
            )}
            {entry.details.old_number && entry.details.new_number && (
              <p className="text-orange-700 font-medium">
                {entry.details.old_number} → {entry.details.new_number}
              </p>
            )}
            {entry.details.old_owner && entry.details.new_owner && (
              <p className="text-orange-700 font-medium">
                {entry.details.old_owner} → {entry.details.new_owner}
              </p>
            )}
            {entry.details.comments && (
              <p className="italic text-gray-500 line-clamp-2">&quot;{entry.details.comments}&quot;</p>
            )}
            {entry.details.rejection_reason && (
              <div className="mt-1 p-1.5 bg-red-50 border border-red-200 rounded">
                <p className="text-red-700 line-clamp-2">{entry.details.rejection_reason}</p>
              </div>
            )}
            {entry.details.file_name && (
              <p className="text-gray-500 truncate">{entry.details.file_name}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function AuditTrailClient({ auditLogs, documentNumber = 'document' }: AuditTrailProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const displayLogs = isExpanded ? auditLogs : auditLogs.slice(0, 3)
  const hasMore = auditLogs.length > 3

  if (auditLogs.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />
            Audit Trail
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-gray-500">No activity recorded yet</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />
            Audit Trail
            <Badge variant="secondary" className="text-xs font-normal">
              {auditLogs.length} {auditLogs.length === 1 ? 'action' : 'actions'}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {/* Export buttons */}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => exportCSV(auditLogs, documentNumber)}
              title="Export as CSV"
            >
              <Download className="h-3 w-3" />
              CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => exportPDF(auditLogs, documentNumber)}
              title="Export as PDF"
            >
              <Download className="h-3 w-3" />
              PDF
            </Button>
            {/* Expand/collapse */}
            {hasMore && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="h-7 text-xs"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="h-3 w-3 mr-1" />
                    Show Less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3 mr-1" />
                    Show All ({auditLogs.length})
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-0">
          {displayLogs.map((entry, index) => (
            <AuditLogEntryRow
              key={entry.id}
              entry={entry}
              isLast={index === displayLogs.length - 1}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
