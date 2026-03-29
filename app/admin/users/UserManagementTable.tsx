'use client'

import { useEffect, useState } from 'react'
import { getAllUsers, updateUserRole, type UserRole } from '@/app/actions/user-management'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { Shield, User, Eye, XCircle } from 'lucide-react'
import { AddUserDialog, ImportUsersDialog } from './UserDialogs'

interface UserData {
  id: string
  email: string
  full_name: string | null
  is_admin: boolean
  role: UserRole | null
  is_active: boolean
  created_at: string
  last_sign_in_at: string | null
  document_count: number
  approval_count: number
}

interface RoleChangeDialog {
  userId: string
  userName: string
  currentRole: UserRole
  newRole: UserRole
}

export default function UserManagementTable() {
  const [users, setUsers] = useState<UserData[]>([])
  const [loading, setLoading] = useState(true)
  const [changeDialog, setChangeDialog] = useState<RoleChangeDialog | null>(null)
  const [reason, setReason] = useState('')

  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    setLoading(true)
    try {
      const result = await getAllUsers()
      
      if (result.success) {
        setUsers(result.data || [])
      } else {
        const error = result.error as any
        const errorMessage = typeof error === 'string' 
          ? error 
          : error?.message || 'Unknown error'
        
        toast.error('Failed to Load Users', {
          description: errorMessage
        })
      }
    } catch (error) {
      console.error('Exception loading users:', error)
      toast.error('Failed to Load Users', {
        description: 'An unexpected error occurred'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleRoleChange = (userId: string, userName: string, currentRole: UserRole, newRole: string) => {
    setChangeDialog({
      userId,
      userName,
      currentRole,
      newRole: newRole as UserRole
    })
    setReason('')
  }

  const confirmRoleChange = async () => {
    if (!changeDialog) return

    const result = await updateUserRole(
      changeDialog.userId,
      changeDialog.newRole,
      reason || undefined
    )

    if (result.success) {
      toast.success('Role Updated', {
        description: `${changeDialog.userName} is now ${changeDialog.newRole}`
      })
      loadUsers()
    } else {
      const error = result.error as any
      const errorMessage = typeof error === 'string'
        ? error
        : error?.message || 'Unknown error'
        
      toast.error('Update Failed', {
        description: errorMessage
      })
    }

    setChangeDialog(null)
  }

  const getRoleBadge = (role: UserRole | null, isAdmin: boolean) => {
    const effectiveRole = role || (isAdmin ? 'Admin' : 'Normal')
    
    // Map to icon keys
    const roleKey = effectiveRole === 'Read Only' ? 'read_only' : effectiveRole.toLowerCase()
    
    const badges: Record<string, { icon: any, color: string, label: string }> = {
      admin: { icon: Shield, color: 'bg-purple-100 text-purple-800', label: 'Admin' },
      normal: { icon: User, color: 'bg-green-100 text-green-800', label: 'Normal' },
      read_only: { icon: Eye, color: 'bg-blue-100 text-blue-800', label: 'Read Only' },
      deactivated: { icon: XCircle, color: 'bg-gray-100 text-gray-800', label: 'Deactivated' }
    }

    const badge = badges[roleKey]
    
    if (!badge) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800">
          Unknown Role
        </span>
      )
    }
    
    const Icon = badge.icon

    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${badge.color}`}>
        <Icon className="h-4 w-4" />
        {badge.label}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading users...</p>
      </div>
    )
  }

  return (
    <>
      {/* Action Buttons */}
      <div className="mb-4 flex gap-2 justify-end">
        <AddUserDialog onUserAdded={loadUsers} />
        <ImportUsersDialog onUsersImported={loadUsers} />
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Active
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Documents
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Approvals
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Joined
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Change Role
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users.map((user) => {
                const currentRole = user.role || (user.is_admin ? 'Admin' : 'Normal')
                
                return (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {user.full_name || 'Unnamed User'}
                        </div>
                        <div className="text-sm text-gray-500">{user.email}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getRoleBadge(user.role, user.is_admin)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {user.is_active ? (
                        <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {user.last_sign_in_at ? (
                        <div className="text-sm text-gray-900">
                          {new Date(user.last_sign_in_at).toLocaleDateString()}
                          <div className="text-xs text-gray-500">
                            {new Date(user.last_sign_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-full bg-amber-100 text-amber-800">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {user.document_count}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {user.approval_count}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Select
                        value={currentRole}
                        onValueChange={(newRole) => 
                          handleRoleChange(user.id, user.full_name || user.email, currentRole, newRole)
                        }
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Admin">Admin</SelectItem>
                          <SelectItem value="Normal">Normal</SelectItem>
                          <SelectItem value="Read Only">Read Only</SelectItem>
                          <SelectItem value="Deactivated">Deactivated</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {users.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No users found</p>
          </div>
        )}
      </div>

      {/* Role Change Confirmation Dialog */}
      {changeDialog && (
        <AlertDialog open={!!changeDialog} onOpenChange={() => setChangeDialog(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Change User Role</AlertDialogTitle>
              <AlertDialogDescription className="space-y-3">
                <p>
                  You are about to change <strong>{changeDialog.userName}</strong>'s role 
                  from <strong>{changeDialog.currentRole}</strong> to <strong>{changeDialog.newRole}</strong>.
                </p>
                
                {changeDialog.newRole === 'Deactivated' && (
                  <div className="bg-red-50 border border-red-200 p-3 rounded-md">
                    <p className="text-sm text-red-800 font-semibold">
                      ⚠️ This user will lose all access to the system.
                    </p>
                  </div>
                )}

                {changeDialog.newRole === 'Read Only' && (
                  <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-md">
                    <p className="text-sm text-yellow-800 font-semibold">
                      ℹ️ This user will only be able to view documents, not create or edit.
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <label htmlFor="reason" className="text-sm font-medium text-gray-700">
                    Reason (optional)
                  </label>
                  <textarea
                    id="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why is this change being made?"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                  />
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmRoleChange}>
                Confirm Change
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  )
}
