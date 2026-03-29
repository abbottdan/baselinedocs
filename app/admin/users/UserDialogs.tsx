'use client'

import { useState } from 'react'
import { addUser, importUsersFromCSV, type UserRole } from '@/app/actions/user-management'
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { UserPlus, Upload, Download, AlertCircle } from 'lucide-react'

export function AddUserDialog({ onUserAdded }: { onUserAdded?: () => void }) {
  const [open, setOpen] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('Normal')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false)
  const [upgradeInfo, setUpgradeInfo] = useState<{
    currentPlan: string
    userLimit: number
    currentUsers: number
  } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const result = await addUser({
        email,
        firstName,
        lastName,
        role
      })

      if (result.success) {
        toast.success('User Added', {
          description: result.message
        })
        setOpen(false)
        setFirstName('')
        setLastName('')
        setEmail('')
        setRole('Normal')
        onUserAdded?.()
      } else {
        // Check if this is a user limit error
        if ((result as any).requiresUpgrade) {
          setOpen(false)
          setShowUpgradeDialog(true)
          setUpgradeInfo({
            currentPlan: (result as any).currentPlan,
            userLimit: (result as any).userLimit,
            currentUsers: (result as any).currentUsers,
          })
        } else {
          toast.error('Failed to Add User', {
            description: result.error
          })
        }
      }
    } catch (error) {
      toast.error('Failed to Add User', {
        description: 'An unexpected error occurred'
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="h-4 w-4 mr-2" />
          Add User
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>
              Add a new user to your organization. They will receive an email invitation.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                  required
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="john.doe@company.com"
                required
              />
            </div>

            <div>
              <Label htmlFor="role">Role</Label>
              <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Normal">Normal</SelectItem>
                  <SelectItem value="Admin">Admin</SelectItem>
                  <SelectItem value="Read Only">Read Only</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-1">
                {role === 'Admin' && 'Can manage users and settings'}
                {role === 'Normal' && 'Can create and edit documents'}
                {role === 'Read Only' && 'Can only view documents'}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Adding...' : 'Add User'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    {/* Upgrade Required Dialog */}
    <AlertDialog open={showUpgradeDialog} onOpenChange={setShowUpgradeDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            User Limit Reached
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>
              Your <span className="font-semibold capitalize">{upgradeInfo?.currentPlan || 'current'}</span> plan 
              is limited to <span className="font-semibold">{upgradeInfo?.userLimit}</span> users.
            </p>
            <p>
              You currently have <span className="font-semibold">{upgradeInfo?.currentUsers}</span> active users.
            </p>
            <p className="text-foreground font-medium pt-2">
              Upgrade your plan to add more users and unlock additional features.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              onClick={() => {
                window.location.href = '/admin/billing'
              }}
            >
              Upgrade Plan
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}

export function ImportUsersDialog({ onUsersImported }: { onUsersImported?: () => void }) {
  const [open, setOpen] = useState(false)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  const handleDownloadTemplate = () => {
    const template = 'First Name,Last Name,Email,Role\nJohn,Doe,john.doe@example.com,Normal\nJane,Smith,jane.smith@example.com,Admin'
    const blob = new Blob([template], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'user-import-template.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    
    toast.success('Template Downloaded', {
      description: 'Fill in the template and upload it to import users'
    })
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.csv')) {
      toast.error('Invalid File', {
        description: 'Please select a CSV file'
      })
      return
    }

    setCsvFile(file)
  }

  const handleImport = async () => {
    if (!csvFile) return

    setIsImporting(true)

    try {
      const text = await csvFile.text()
      const result = await importUsersFromCSV(text)

      if (result.success) {
        toast.success('Import Complete', {
          description: result.message
        })

        if (result.errors.length > 0) {
          // Show errors in a separate toast
          toast.error('Some Users Failed', {
            description: `${result.failed} users could not be imported. Check console for details.`
          })
          console.error('Import errors:', result.errors)
        }

        setOpen(false)
        setCsvFile(null)
        onUsersImported?.()
      } else {
        toast.error('Import Failed', {
          description: result.error
        })
      }
    } catch (error) {
      toast.error('Import Failed', {
        description: 'An unexpected error occurred while reading the file'
      })
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="h-4 w-4 mr-2" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Import Users from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file to import multiple users at once
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* Download Template */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Download className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h4 className="font-medium text-blue-900">Step 1: Download Template</h4>
                <p className="text-sm text-blue-700 mt-1">
                  Download the CSV template and fill in your user data
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadTemplate}
                  className="mt-2"
                >
                  <Download className="h-3 w-3 mr-2" />
                  Download Template
                </Button>
              </div>
            </div>
          </div>

          {/* CSV Format Info */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-2">CSV Format</h4>
            <div className="text-sm text-gray-600 space-y-1 font-mono">
              <div>First Name, Last Name, Email, Role</div>
              <div className="text-xs text-gray-500">
                Roles: Admin, Normal, or Read Only
              </div>
            </div>
          </div>

          {/* File Upload */}
          <div>
            <Label htmlFor="csvFile">Step 2: Upload CSV File</Label>
            <Input
              id="csvFile"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="mt-1"
            />
            {csvFile && (
              <p className="text-sm text-green-600 mt-2">
                ✓ File selected: {csvFile.name}
              </p>
            )}
          </div>

          {/* Warning */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-800">
              <strong>Note:</strong> Users will be added to your organization. 
              Duplicate emails will be skipped with an error message.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setOpen(false)
              setCsvFile(null)
            }}
            disabled={isImporting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!csvFile || isImporting}
          >
            {isImporting ? 'Importing...' : 'Import Users'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

  )
}
