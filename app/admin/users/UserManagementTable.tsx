'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  inviteUser,
  updateUserRole,
  deactivateUser,
  addExistingUserToProduct,
  type ExistingTenantUser,
} from '@/app/actions/user-management'
import ImportUsersDialog from '@/components/admin/ImportUsersDialog'
import { Badge, ConfirmDialog } from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, FormError } from '@/components/ui/form-fields'
import { UserPlus, HelpCircle } from 'lucide-react'
import Link from 'next/link'

type UserRow = {
  id:              string
  email:           string
  full_name:       string | null
  role:            string
  is_active:       boolean
  is_master_admin: boolean
  created_at:      string
  last_sign_in_at: string | null
}

// Docs does NOT include inventory_manager — blocked by CHECK constraint on docs.user_roles
const ROLE_OPTIONS = [
  { value: 'readonly',     label: 'Read Only' },
  { value: 'user',         label: 'User' },
  { value: 'tenant_admin', label: 'Tenant Admin' },
]

const ROLE_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  master_admin: 'danger',
  tenant_admin: 'default',
  user:         'neutral',
  readonly:     'neutral',
}

// Clarity Blue — BaselineDocs product accent
const ACCENT = '#2563EB'

interface UserManagementTableProps {
  users:               UserRow[]
  currentUserId:       string
  existingTenantUsers: ExistingTenantUser[]
}

export default function UserManagementTable({
  users,
  currentUserId,
  existingTenantUsers,
}: UserManagementTableProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Invite panel
  const [showInvite,  setShowInvite]  = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteRole,  setInviteRole]  = useState('user')

  // Combo input state
  const [query,            setQuery]            = useState('')
  const [showDropdown,     setShowDropdown]     = useState(false)
  const [selectedExisting, setSelectedExisting] = useState<ExistingTenantUser | null>(null)
  const [inviteFullName,   setInviteFullName]   = useState('')
  const comboRef = useRef<HTMLDivElement>(null)

  // Deactivate confirm
  const [deactivateTarget, setDeactivateTarget] = useState<UserRow | null>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Derived combo values
  const filtered = query.length >= 1
    ? existingTenantUsers.filter(u =>
        u.email.toLowerCase().includes(query.toLowerCase()) ||
        (u.full_name ?? '').toLowerCase().includes(query.toLowerCase())
      )
    : existingTenantUsers

  const isNewEmail = query.includes('@') &&
    !existingTenantUsers.some(u => u.email.toLowerCase() === query.toLowerCase())

  const canSubmit = !!(selectedExisting || isNewEmail)

  function handleSelectExisting(u: ExistingTenantUser) {
    setSelectedExisting(u)
    setQuery(u.full_name ? `${u.full_name} (${u.email})` : u.email)
    setShowDropdown(false)
  }

  function handleQueryChange(val: string) {
    setQuery(val)
    setSelectedExisting(null)
    setShowDropdown(true)
  }

  function resetInviteForm() {
    setQuery('')
    setSelectedExisting(null)
    setInviteFullName('')
    setInviteRole('user')
    setInviteError(null)
    setShowDropdown(false)
  }

  function handleInvite() {
    setInviteError(null)

    if (selectedExisting) {
      // Existing tenant member — insert docs.user_roles row only, no email
      startTransition(async () => {
        const result = await addExistingUserToProduct(selectedExisting.id, inviteRole)
        if (result.error) {
          setInviteError(result.error)
        } else {
          toast.success(`${selectedExisting.email} added to BaselineDocs`)
          setShowInvite(false)
          resetInviteForm()
          router.refresh()
        }
      })
    } else if (isNewEmail) {
      // New user — send Supabase auth invite
      startTransition(async () => {
        const result = await inviteUser({
          email:     query.trim(),
          full_name: inviteFullName || undefined,
          role:      inviteRole,
        })
        if (result.error) {
          setInviteError(result.error)
        } else {
          toast.success(`Invitation sent to ${query.trim()}`)
          setShowInvite(false)
          resetInviteForm()
          router.refresh()
        }
      })
    } else {
      setInviteError('Enter an email address or select an existing user.')
    }
  }

  function handleRoleChange(userId: string, newRole: string) {
    startTransition(async () => {
      const result = await updateUserRole(userId, newRole)
      if (result.error) toast.error(result.error)
      else { toast.success('Role updated'); router.refresh() }
    })
  }

  function handleDeactivate() {
    if (!deactivateTarget) return
    startTransition(async () => {
      const result = await deactivateUser(deactivateTarget.id)
      if (result.error) toast.error(result.error)
      else {
        toast.success(`${deactivateTarget.email} deactivated`)
        setDeactivateTarget(null)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-5">

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-slate-800">Users</h2>
            <Link
              href="/help#role-permissions"
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-[#2563EB] transition-colors"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              Role permissions
            </Link>
          </div>
          <p className="text-sm text-slate-500">{users.length} member{users.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportUsersDialog />
          <Button
            onClick={() => {
              setShowInvite(s => !s)
              if (showInvite) resetInviteForm()
            }}
          >
            <UserPlus className="w-4 h-4" />
            Add User
          </Button>
        </div>
      </div>

      {/* Add User panel */}
      {showInvite && (
        <div
          className="rounded border p-5 space-y-4"
          style={{ backgroundColor: '#EFF6FF', borderColor: ACCENT }}
        >
          <div>
            <h3 className="font-semibold text-slate-800">Add User</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Search for an existing team member from another ClearStride product, or enter a new email to send an invitation.
            </p>
          </div>

          {/* Combo input */}
          <div ref={comboRef} className="relative">
            <Field label="Email or name">
              <Input
                value={query}
                onChange={e => handleQueryChange(e.target.value)}
                onFocus={() => setShowDropdown(true)}
                placeholder="Search by name or email, or type a new address…"
                autoComplete="off"
              />
            </Field>

            {showDropdown && (filtered.length > 0 || isNewEmail) && (
              <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded shadow-md overflow-hidden">
                {filtered.length > 0 && (
                  <>
                    <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 bg-slate-50">
                      Existing team members
                    </p>
                    {filtered.map(u => (
                      <button
                        key={u.id}
                        type="button"
                        onMouseDown={e => { e.preventDefault(); handleSelectExisting(u) }}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors"
                      >
                        <p className="text-sm font-medium text-slate-800">{u.full_name ?? u.email}</p>
                        {u.full_name && <p className="text-xs text-slate-400">{u.email}</p>}
                      </button>
                    ))}
                  </>
                )}
                {isNewEmail && (
                  <>
                    <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 bg-slate-50">
                      New user
                    </p>
                    <button
                      type="button"
                      onMouseDown={e => { e.preventDefault(); setShowDropdown(false) }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors"
                    >
                      <p className="text-sm font-medium text-slate-800">Invite <span style={{ color: ACCENT }}>{query}</span></p>
                      <p className="text-xs text-slate-400">Send a Supabase invitation email</p>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Full Name — only for new email invites */}
          {isNewEmail && !selectedExisting && (
            <Field label="Full name (optional)">
              <Input
                value={inviteFullName}
                onChange={e => setInviteFullName(e.target.value)}
                placeholder="Jane Smith"
              />
            </Field>
          )}

          {/* Role */}
          <Field label="Role">
            <Select value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
              {ROLE_OPTIONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </Select>
          </Field>

          {/* Contextual hint */}
          {selectedExisting && (
            <p className="text-xs text-emerald-700">
              <strong>{selectedExisting.full_name ?? selectedExisting.email}</strong> already has a ClearStride account — no invitation email will be sent.
            </p>
          )}
          {isNewEmail && !selectedExisting && (
            <p className="text-xs text-slate-500">
              A Supabase invitation email will be sent to <strong>{query}</strong>.
            </p>
          )}

          {inviteError && <FormError>{inviteError}</FormError>}

          <div className="flex gap-3">
            <Button onClick={handleInvite} disabled={isPending || !canSubmit}>
              {isPending
                ? 'Saving…'
                : selectedExisting
                  ? 'Add to BaselineDocs'
                  : 'Send Invitation'}
            </Button>
            <Button
              variant="outline"
              onClick={() => { setShowInvite(false); resetInviteForm() }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="bg-white rounded border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left px-6 py-3 font-semibold text-slate-600">User</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Role</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Status</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Last Sign In</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Joined</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {users.map(u => (
              <tr key={u.id} className={`hover:bg-slate-50 ${!u.is_active ? 'opacity-50' : ''}`}>

                {/* User */}
                <td className="px-6 py-3">
                  <p className="font-medium text-slate-800">{u.full_name ?? u.email}</p>
                  {u.full_name && <p className="text-xs text-slate-400">{u.email}</p>}
                </td>

                {/* Role */}
                <td className="px-4 py-3">
                  {u.is_master_admin || u.id === currentUserId ? (
                    <Badge variant={ROLE_VARIANT[u.role] ?? 'neutral'}>
                      {u.is_master_admin ? 'Master Admin' : u.role.replace('_', ' ')}
                    </Badge>
                  ) : (
                    <Select
                      value={u.role}
                      onChange={e => handleRoleChange(u.id, e.target.value)}
                      disabled={isPending}
                      className="w-40 text-xs"
                    >
                      {ROLE_OPTIONS.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </Select>
                  )}
                </td>

                {/* Status */}
                <td className="px-4 py-3">
                  <Badge variant={u.is_active ? 'success' : 'neutral'}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </td>

                {/* Last sign in */}
                <td className="px-4 py-3">
                  {u.last_sign_in_at ? (
                    <div className="text-sm text-slate-700">
                      {new Date(u.last_sign_in_at).toLocaleDateString()}
                      <div className="text-xs text-slate-400">
                        {new Date(u.last_sign_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-full bg-amber-50 text-amber-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      Pending
                    </span>
                  )}
                </td>

                {/* Joined */}
                <td className="px-4 py-3 text-xs text-slate-400">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>

                {/* Actions */}
                <td className="px-5 py-3 text-right">
                  {!u.is_master_admin && u.id !== currentUserId && u.is_active && (
                    <button
                      onClick={() => setDeactivateTarget(u)}
                      disabled={isPending}
                      className="text-xs text-slate-400 hover:text-red-500 transition-colors"
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}

            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-400">
                  No users yet. Add your first team member above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Deactivate confirm */}
      {deactivateTarget && (
        <ConfirmDialog
          title="Deactivate user?"
          description={`${deactivateTarget.full_name ?? deactivateTarget.email} will lose access immediately. You can reactivate them later.`}
          confirmLabel="Deactivate"
          confirmVariant="danger"
          onConfirm={handleDeactivate}
          onCancel={() => setDeactivateTarget(null)}
        />
      )}
    </div>
  )
}
