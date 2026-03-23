'use client'

import { useState } from 'react'
import { importUsersFromCSV } from '@/app/actions/user-management'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Upload, Download, AlertCircle } from 'lucide-react'

// ─── ImportUsersDialog ────────────────────────────────────────────────────────
// Bulk-invite users via CSV. Expected columns: Full Name, Email, Role
// Role values: readonly | user | tenant_admin
//
// Note: AddUserDialog has been removed — user invitation is now handled
// inline in UserManagementTable via the combo input Add User panel.

export function ImportUsersDialog({ onUsersImported }: { onUsersImported?: () => void }) {
  const [open,        setOpen]        = useState(false)
  const [csvFile,     setCsvFile]     = useState<File | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  const handleDownloadTemplate = () => {
    const template = [
      'Full Name,Email,Role',
      'Jane Smith,jane.smith@example.com,user',
      'Bob Jones,bob.jones@example.com,readonly',
      'Alice Admin,alice@example.com,tenant_admin',
    ].join('\n')
    const blob = new Blob([template], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = 'user-import-template.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('Template Downloaded', { description: 'Fill in the template and upload it to import users' })
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.csv')) {
      toast.error('Invalid File', { description: 'Please select a .csv file' })
      return
    }
    setCsvFile(file)
  }

  const handleImport = async () => {
    if (!csvFile) return
    setIsImporting(true)
    try {
      const text   = await csvFile.text()
      const result = await importUsersFromCSV(text)
      if (result.success) {
        toast.success('Import Complete', {
          description: `${result.imported} user${result.imported !== 1 ? 's' : ''} invited${result.failed ? `, ${result.failed} failed` : ''}.`,
        })
        if (result.errors?.length) {
          result.errors.forEach(err => toast.error('Row Error', { description: err }))
        }
        setOpen(false)
        setCsvFile(null)
        onUsersImported?.()
      } else {
        toast.error('Import Failed', { description: result.error })
      }
    } catch {
      toast.error('Import Failed', { description: 'An unexpected error occurred' })
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={open => { setOpen(open); if (!open) setCsvFile(null) }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="h-4 w-4 mr-2" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Users from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file to invite multiple users at once.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Template download */}
          <div>
            <Label>Step 1: Download Template</Label>
            <div className="mt-2 p-3 bg-slate-50 rounded border border-slate-200">
              <p className="text-xs font-mono text-slate-600 mb-2">Full Name, Email, Role</p>
              <p className="text-xs text-slate-500 mb-2">
                Roles: <code className="bg-slate-100 px-1 rounded">user</code>{' '}
                <code className="bg-slate-100 px-1 rounded">readonly</code>{' '}
                <code className="bg-slate-100 px-1 rounded">tenant_admin</code>
              </p>
              <Button type="button" variant="outline" size="sm" onClick={handleDownloadTemplate}>
                <Download className="h-4 w-4 mr-2" />
                Download Template
              </Button>
            </div>
          </div>

          {/* File upload */}
          <div className="space-y-1">
            <Label htmlFor="csv-upload">Step 2: Upload CSV File</Label>
            <Input
              id="csv-upload"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
            />
            {csvFile && (
              <p className="text-xs text-emerald-700 mt-1">✓ {csvFile.name}</p>
            )}
          </div>

          <div className="flex gap-2 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
            <span>Users will be invited via email. Duplicate email addresses will be skipped.</span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => { setOpen(false); setCsvFile(null) }}
            disabled={isImporting}
          >
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!csvFile || isImporting}>
            {isImporting ? 'Importing…' : 'Import Users'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
