'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUser, isTenantAdmin } from '@/lib/tenant'
import { createSharedClient, createServiceRoleClient } from '@/lib/supabase/server'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExistingTenantUser = {
  id:        string
  email:     string
  full_name: string | null
}

// Docs-valid roles — inventory_manager is blocked by CHECK constraint on docs.user_roles
const VALID_ROLES = ['readonly', 'user', 'tenant_admin'] as const
type DocsRole = typeof VALID_ROLES[number]

// ─── getExistingTenantUsers ───────────────────────────────────────────────────
// Returns active shared.users members who do NOT yet have a docs.user_roles row.
// These appear in the "Add User" combo dropdown.
// Called server-side from page.tsx and passed as a prop — never called client-side.

export async function getExistingTenantUsers(): Promise<{
  data: ExistingTenantUser[]
  error: string | null
}> {
  const user = await getCurrentUser()
  if (!user) return { data: [], error: 'Not authenticated' }
  if (!await isTenantAdmin()) return { data: [], error: 'Insufficient permissions' }

  const sharedClient  = createSharedClient()
  const serviceClient = createServiceRoleClient()

  const { data: allTenantUsers } = await sharedClient
    .schema('shared')
    .from('users')
    .select('id, email, full_name')
    .eq('tenant_id', user.tenant_id)
    .eq('is_active', true)

  const { data: existingRoles } = await serviceClient
    .schema('docs')
    .from('user_roles')
    .select('user_id')
    .eq('tenant_id', user.tenant_id)

  const alreadyOnProduct = new Set((existingRoles ?? []).map(r => r.user_id))

  return {
    data:  (allTenantUsers ?? []).filter(u => !alreadyOnProduct.has(u.id)),
    error: null,
  }
}

// ─── addExistingUserToProduct ─────────────────────────────────────────────────
// Grants BaselineDocs access to an existing tenant member by inserting a
// docs.user_roles row. No auth email sent.

export async function addExistingUserToProduct(targetUserId: string, role: string) {
  try {
    const user = await getCurrentUser()
    if (!user) return { error: 'Not authenticated' }
    if (!await isTenantAdmin()) return { error: 'Insufficient permissions' }

    if (!VALID_ROLES.includes(role as DocsRole)) return { error: 'Invalid role' }

    const sharedClient  = createSharedClient()
    const serviceClient = createServiceRoleClient()

    // Verify target belongs to this tenant
    const { data: target } = await sharedClient
      .schema('shared')
      .from('users')
      .select('email, full_name')
      .eq('id', targetUserId)
      .eq('tenant_id', user.tenant_id)
      .single()

    if (!target) return { error: 'User not found in this organisation' }

    // Guard against duplicates
    const { data: existing } = await serviceClient
      .schema('docs')
      .from('user_roles')
      .select('user_id')
      .eq('user_id', targetUserId)
      .eq('tenant_id', user.tenant_id)
      .single()

    if (existing) return { error: 'User already has access to BaselineDocs' }

    const { error } = await serviceClient
      .schema('docs')
      .from('user_roles')
      .insert({ user_id: targetUserId, tenant_id: user.tenant_id, role })

    if (error) return { error: error.message }

    console.log(`[addExistingUserToProduct] ${target.email} added with role ${role} by ${user.email}`)
    revalidatePath('/admin/users')
    return { success: true }
  } catch (err: any) {
    console.error('[addExistingUserToProduct]', err)
    return { error: 'Unexpected server error. Please try again.' }
  }
}

// ─── inviteUser ───────────────────────────────────────────────────────────────
// Two changes from the old pattern:
//   1. redirectTo is built from the tenant subdomain + NEXT_PUBLIC_APP_DOMAIN
//   2. A docs.user_roles row is pre-created at invite time so the user can log
//      in immediately after accepting — without hitting the step-6 middleware block.

const InviteSchema = z.object({
  email:     z.string().email(),
  full_name: z.string().optional(),
  role:      z.enum(VALID_ROLES),
})

export async function inviteUser(input: {
  email:     string
  full_name?: string
  role:      string
}) {
  try {
    const user = await getCurrentUser()
    if (!user) return { error: 'Not authenticated' }
    if (!await isTenantAdmin()) return { error: 'Insufficient permissions' }

    const parsed = InviteSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

    const supabase = createServiceRoleClient()

    // Build redirectTo from tenant subdomain.
    // NEXT_PUBLIC_APP_DOMAIN must be set to 'baselinedocs.com' in Vercel.
    const subdomain = user.tenant?.subdomain
    const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN ?? 'baselinedocs.com'
    const baseUrl   = subdomain
      ? `https://${subdomain}.${appDomain}`
      : `https://${appDomain}`

    const { data, error } = await supabase.auth.admin.inviteUserByEmail(parsed.data.email, {
      data: {
        tenant_id: user.tenant_id,
        role:      parsed.data.role,
        full_name: parsed.data.full_name ?? '',
      },
      redirectTo: `${baseUrl}/auth/callback`,
    })

    if (error) return { error: error.message }

    // Pre-create the docs.user_roles row using the auth user ID returned by the invite.
    // This grants product access immediately so the user can log in as soon as they accept.
    // shared.users row is created by the handle_new_user DB trigger on first sign-in.
    if (data.user?.id) {
      const serviceClient = createServiceRoleClient()
      const { error: roleError } = await serviceClient
        .schema('docs')
        .from('user_roles')
        .upsert(
          { user_id: data.user.id, tenant_id: user.tenant_id, role: parsed.data.role },
          { onConflict: 'user_id,tenant_id' }
        )
      if (roleError) {
        // Non-fatal — log but don't fail the invite. Admin can add them via the UI as a fallback.
        console.error('[inviteUser] Failed to pre-create docs.user_roles row:', roleError)
      }
    }

    console.log(`[inviteUser] Invited ${parsed.data.email} with role ${parsed.data.role} by ${user.email}`)
    revalidatePath('/admin/users')
    return { success: true }
  } catch (err: any) {
    console.error('[inviteUser]', err)
    return { error: 'Unexpected server error. Please try again.' }
  }
}

// ─── updateUserRole ───────────────────────────────────────────────────────────
// Writes to docs.user_roles — NOT to shared.users (no role column there).
// Uses upsert so it works whether or not a row already exists.

export async function updateUserRole(targetUserId: string, newRole: string) {
  try {
    const user = await getCurrentUser()
    if (!user) return { error: 'Not authenticated' }
    if (!await isTenantAdmin()) return { error: 'Insufficient permissions' }

    if (!VALID_ROLES.includes(newRole as DocsRole)) return { error: 'Invalid role' }

    const sharedClient  = createSharedClient()
    const serviceClient = createServiceRoleClient()

    const { data: target } = await sharedClient
      .schema('shared')
      .from('users')
      .select('email')
      .eq('id', targetUserId)
      .eq('tenant_id', user.tenant_id)
      .single()

    if (!target) return { error: 'User not found' }

    const { data: oldRoleRow } = await serviceClient
      .schema('docs')
      .from('user_roles')
      .select('role')
      .eq('user_id', targetUserId)
      .eq('tenant_id', user.tenant_id)
      .single()

    const { error } = await serviceClient
      .schema('docs')
      .from('user_roles')
      .upsert(
        { user_id: targetUserId, tenant_id: user.tenant_id, role: newRole },
        { onConflict: 'user_id,tenant_id' }
      )

    if (error) return { error: error.message }

    console.log(`[updateUserRole] ${target.email} role changed to ${newRole} by ${user.email}`)
    revalidatePath('/admin/users')
    return { success: true }
  } catch (err: any) {
    console.error('[updateUserRole]', err)
    return { error: 'Unexpected server error. Please try again.' }
  }
}

// ─── deactivateUser ───────────────────────────────────────────────────────────
// Sets is_active = false on shared.users. The user immediately fails middleware step 2.

export async function deactivateUser(targetUserId: string) {
  try {
    const user = await getCurrentUser()
    if (!user) return { error: 'Not authenticated' }
    if (!await isTenantAdmin()) return { error: 'Insufficient permissions' }
    if (targetUserId === user.id) return { error: 'You cannot deactivate your own account' }

    const sharedClient = createSharedClient()

    const { data: target } = await sharedClient
      .schema('shared')
      .from('users')
      .select('email, is_master_admin')
      .eq('id', targetUserId)
      .eq('tenant_id', user.tenant_id)
      .single()

    if (!target) return { error: 'User not found' }
    if (target.is_master_admin) return { error: 'Cannot deactivate a master admin' }

    const { error } = await sharedClient
      .schema('shared')
      .from('users')
      .update({ is_active: false })
      .eq('id', targetUserId)
      .eq('tenant_id', user.tenant_id)

    if (error) return { error: error.message }

    console.log(`[deactivateUser] ${target.email} deactivated by ${user.email}`)
    revalidatePath('/admin/users')
    return { success: true }
  } catch (err: any) {
    console.error('[deactivateUser]', err)
    return { error: 'Unexpected server error. Please try again.' }
  }
}

// ─── importUsersFromCSV ───────────────────────────────────────────────────────
// Bulk invite via CSV. Expected columns: Full Name, Email, Role
// Role values must be canonical (readonly / user / tenant_admin).

export type ImportUsersResult = {
  success:  boolean
  imported: number
  failed:   number
  errors:   string[]
  error?:   string
}

export async function importUsersFromCSV(csvText: string): Promise<ImportUsersResult> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, imported: 0, failed: 0, errors: [], error: 'Not authenticated' }
    if (!await isTenantAdmin()) return { success: false, imported: 0, failed: 0, errors: [], error: 'Insufficient permissions' }

    const lines  = csvText.trim().split('\n').map(l => l.trim()).filter(Boolean)
    const header = lines[0]?.toLowerCase() ?? ''

    if (!header.includes('email')) {
      return { success: false, imported: 0, failed: 0, errors: [], error: 'CSV must include an Email column' }
    }

    const cols   = header.split(',').map(c => c.trim())
    const rows   = lines.slice(1)
    let imported = 0
    let failed   = 0
    const errors: string[] = []

    for (const row of rows) {
      const vals     = row.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
      const record   = Object.fromEntries(cols.map((c, i) => [c, vals[i] ?? '']))
      const email    = record['email'] ?? ''
      const fullName = record['full name'] ?? record['name'] ?? ''
      const rawRole  = (record['role'] ?? 'user').toLowerCase().replace(/\s+/g, '_')
      const role     = VALID_ROLES.includes(rawRole as DocsRole) ? rawRole : 'user'

      if (!email.includes('@')) {
        errors.push(`Row skipped — invalid email: "${email}"`)
        failed++
        continue
      }

      const result = await inviteUser({ email, full_name: fullName || undefined, role })
      if (result.error) {
        errors.push(`${email}: ${result.error}`)
        failed++
      } else {
        imported++
      }
    }

    return { success: true, imported, failed, errors }
  } catch (err: any) {
    console.error('[importUsersFromCSV]', err)
    return { success: false, imported: 0, failed: 0, errors: [], error: 'Unexpected error during import' }
  }
}
