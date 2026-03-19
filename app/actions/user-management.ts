/**
 * app/actions/user-management.ts — BaselineDocs
 *
 * CHANGED: All is_admin / users.role checks replaced with:
 *   - isMasterAdmin() from lib/tenant for quick boolean checks
 *   - createSharedClient().schema('shared').from('users') for user identity
 *   - supabase.schema('docs').from('user_roles') for role checks
 *   - Users are now fetched from shared.users, not public.users
 */
'use server'

import { createClient, createSharedClient, createServiceRoleClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { getSubdomainTenantId, isMasterAdmin } from '@/lib/tenant'

export type UserRole = 'Admin' | 'Normal' | 'Read Only' | 'Deactivated'

const userUpdateSchema = z.object({
  role: z.enum(['Admin', 'Normal', 'Read Only', 'Deactivated']),
  reason: z.string().optional()
})

// Maps old UI role strings to new role system
const UI_ROLE_TO_DB: Record<UserRole, string> = {
  'Admin':      'tenant_admin',
  'Normal':     'user',
  'Read Only':  'readonly',
  'Deactivated':'user',  // deactivated is handled via is_active flag
}

const DB_ROLE_TO_UI: Record<string, UserRole> = {
  'master_admin': 'Admin',
  'tenant_admin': 'Admin',
  'user':         'Normal',
  'readonly':     'Read Only',
}

export async function getAllUsers() {
  const supabase     = await createClient()
  const sharedClient = createSharedClient()

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return { success: false, error: 'You must be logged in', data: [] }
    }

    // Check admin status via shared.users
    const { data: sharedUser } = await sharedClient
      .schema('shared')
      .from('users')
      .select('is_master_admin, tenant_id')
      .eq('id', user.id)
      .single()

    if (!sharedUser) return { success: false, error: 'User not found', data: [] }

    let isAdmin = sharedUser.is_master_admin
    if (!isAdmin) {
      const { data: roleRow } = await supabase
        .schema('docs')
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('tenant_id', sharedUser.tenant_id)
        .single()
      isAdmin = ['tenant_admin', 'master_admin'].includes(roleRow?.role ?? '')
    }

    if (!isAdmin) {
      logger.warn('Non-admin attempted to access user list', {
        userId: user.id, userEmail: user.email
      })
      return { success: false, error: 'Only administrators can view user list', data: [] }
    }

    const targetTenantId = await getSubdomainTenantId()
    if (!targetTenantId) return { success: false, error: 'Tenant not found', data: [] }

    // Fetch users from shared.users
    const { data: users, error: fetchError } = await sharedClient
      .schema('shared')
      .from('users')
      .select('id, email, full_name, is_master_admin, is_active, created_at, updated_at, last_sign_in_at, tenant_id')
      .eq('tenant_id', targetTenantId)
      .order('created_at', { ascending: false })

    if (fetchError) throw fetchError

    // Fetch roles from docs.user_roles for all users
    const userIds = (users || []).map(u => u.id)
    const { data: roleRows } = await supabase
      .schema('docs')
      .from('user_roles')
      .select('user_id, role')
      .in('user_id', userIds)
      .eq('tenant_id', targetTenantId)

    const roleMap = Object.fromEntries(
      (roleRows || []).map(r => [r.user_id, r.role])
    )

    // Get document + approval counts
    const supabaseAdmin = createServiceRoleClient()
    const usersWithStats = await Promise.all(
      (users || []).map(async (u) => {
        const { count: docCount } = await supabase
          .from('documents')
          .select('id', { count: 'exact', head: true })
          .eq('created_by', u.id)

        const { count: approvalCount } = await supabase
          .from('approvers')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', u.id)

        const dbRole = u.is_master_admin ? 'master_admin' : (roleMap[u.id] || 'user')
        const uiRole = DB_ROLE_TO_UI[dbRole] || 'Normal'

        return {
          ...u,
          is_admin: ['tenant_admin', 'master_admin'].includes(dbRole),
          role: uiRole,
          document_count: docCount || 0,
          approval_count: approvalCount || 0,
        }
      })
    )

    return { success: true, data: usersWithStats }
  } catch (error: any) {
    logger.error('Failed to fetch users', { error: error.message })
    return { success: false, error: error.message || 'Failed to fetch users', data: [] }
  }
}

export async function updateUserRole(
  targetUserId: string,
  newRole: UserRole,
  reason?: string
) {
  const supabase     = await createClient()
  const sharedClient = createSharedClient()

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return { success: false, error: 'You must be logged in' }

    const { data: sharedUser } = await sharedClient
      .schema('shared')
      .from('users')
      .select('is_master_admin, tenant_id')
      .eq('id', user.id)
      .single()

    if (!sharedUser) return { success: false, error: 'User not found' }

    let isAdmin = sharedUser.is_master_admin
    if (!isAdmin) {
      const { data: roleRow } = await supabase
        .schema('docs')
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('tenant_id', sharedUser.tenant_id)
        .single()
      isAdmin = ['tenant_admin', 'master_admin'].includes(roleRow?.role ?? '')
    }

    if (!isAdmin) return { success: false, error: 'Only administrators can update roles' }

    const targetTenantId = await getSubdomainTenantId()
    if (!targetTenantId) return { success: false, error: 'Tenant not found' }

    const supabaseAdmin = createServiceRoleClient()

    // Handle deactivation as is_active flag on shared.users
    if (newRole === 'Deactivated') {
      const { error } = await supabaseAdmin
        .schema('shared')
        .from('users')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', targetUserId)
      if (error) throw error
    } else {
      // Re-activate if previously deactivated
      await supabaseAdmin
        .schema('shared')
        .from('users')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('id', targetUserId)

      // Update role in docs.user_roles
      const dbRole = UI_ROLE_TO_DB[newRole]
      const { error } = await supabaseAdmin
        .schema('docs')
        .from('user_roles')
        .upsert({
          user_id:   targetUserId,
          tenant_id: targetTenantId,
          role:      dbRole,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id,user_id' })
      if (error) throw error
    }

    revalidatePath('/admin/users')
    return { success: true }
  } catch (error: any) {
    logger.error('Failed to update user role', { error: error.message })
    return { success: false, error: error.message || 'Failed to update role' }
  }
}

export async function addUser(data: {
  email: string
  firstName: string
  lastName: string
  role: UserRole
}) {
  const supabase     = await createClient()
  const sharedClient = createSharedClient()
  const supabaseAdmin = createServiceRoleClient()

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return { success: false, error: 'You must be logged in' }

    const { data: sharedUser } = await sharedClient
      .schema('shared')
      .from('users')
      .select('is_master_admin, tenant_id')
      .eq('id', user.id)
      .single()

    if (!sharedUser) return { success: false, error: 'User not found' }

    let isAdmin = sharedUser.is_master_admin
    if (!isAdmin) {
      const { data: roleRow } = await supabase
        .schema('docs')
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('tenant_id', sharedUser.tenant_id)
        .single()
      isAdmin = ['tenant_admin', 'master_admin'].includes(roleRow?.role ?? '')
    }

    if (!isAdmin) return { success: false, error: 'Only administrators can add users' }

    const targetTenantId = await getSubdomainTenantId()
    if (!targetTenantId) return { success: false, error: 'Tenant not found' }

    const emailLower = data.email.toLowerCase()

    // Check if auth user already exists
    const { data: existingAuthList } = await supabaseAdmin.auth.admin.listUsers()
    const existingAuthUser = existingAuthList?.users?.find(u => u.email === emailLower)

    let authUserId: string

    if (existingAuthUser) {
      authUserId = existingAuthUser.id
    } else {
      const { data: newAuthUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: emailLower,
        email_confirm: true,
        user_metadata: {
          full_name:  `${data.firstName} ${data.lastName}`,
          tenant_id:  targetTenantId,
        },
      })
      if (createError || !newAuthUser?.user) {
        return { success: false, error: createError?.message || 'Failed to create auth user' }
      }
      authUserId = newAuthUser.user.id
    }

    // Upsert into shared.users
    const { error: upsertError } = await supabaseAdmin
      .schema('shared')
      .from('users')
      .upsert({
        id:         authUserId,
        tenant_id:  targetTenantId,
        email:      emailLower,
        full_name:  `${data.firstName} ${data.lastName}`,
        is_active:  true,
      }, { onConflict: 'id' })

    if (upsertError) return { success: false, error: 'Failed to create user record' }

    // Insert role into docs.user_roles
    const dbRole = UI_ROLE_TO_DB[data.role] || 'user'
    const { error: roleError } = await supabaseAdmin
      .schema('docs')
      .from('user_roles')
      .upsert({
        user_id:   authUserId,
        tenant_id: targetTenantId,
        role:      dbRole,
      }, { onConflict: 'tenant_id,user_id' })

    if (roleError) return { success: false, error: 'Failed to assign role' }

    revalidatePath('/admin/users')
    return { success: true }
  } catch (error: any) {
    logger.error('Failed to add user', { error: error.message })
    return { success: false, error: error.message || 'Failed to add user' }
  }
}

export async function importUsersFromCSV(csvData: string) {
  const supabase     = await createClient()
  const sharedClient = createSharedClient()

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return { success: false, error: 'Not authenticated', imported: 0, failed: 0, errors: [] }
    }

    const { data: sharedUser } = await sharedClient
      .schema('shared')
      .from('users')
      .select('is_master_admin, tenant_id')
      .eq('id', user.id)
      .single()

    if (!sharedUser) {
      return { success: false, error: 'User not found', imported: 0, failed: 0, errors: [] }
    }

    let isAdmin = sharedUser.is_master_admin
    if (!isAdmin) {
      const { data: roleRow } = await supabase
        .schema('docs')
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('tenant_id', sharedUser.tenant_id)
        .single()
      isAdmin = ['tenant_admin', 'master_admin'].includes(roleRow?.role ?? '')
    }

    if (!isAdmin) {
      return { success: false, error: 'Only administrators can import users', imported: 0, failed: 0, errors: [] }
    }

    const lines = csvData.trim().split('\n')
    if (lines.length < 2) {
      return { success: false, error: 'CSV file is empty or has no data rows', imported: 0, failed: 0, errors: [] }
    }

    const dataRows = lines.slice(1)
    let imported = 0
    let failed = 0
    const errors: string[] = []

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i].trim()
      if (!row) continue

      const columns = row.split(',').map(col => col.trim().replace(/^["']|["']$/g, ''))
      if (columns.length < 4) {
        failed++
        errors.push(`Row ${i + 2}: Invalid format - expected 4 columns (First Name, Last Name, Email, Role)`)
        continue
      }

      const [firstName, lastName, email, role] = columns

      if (!['Admin', 'Normal', 'Read Only'].includes(role)) {
        failed++
        errors.push(`Row ${i + 2}: Invalid role "${role}" - must be Admin, Normal, or Read Only`)
        continue
      }

      const result = await addUser({ email, firstName, lastName, role: role as UserRole })

      if (result.success) {
        imported++
      } else {
        failed++
        errors.push(`Row ${i + 2} (${email}): ${result.error}`)
      }
    }

    revalidatePath('/admin/users')
    return {
      success: true,
      imported,
      failed,
      errors,
      message: `Import complete: ${imported} users added, ${failed} failed`
    }
  } catch (error: any) {
    logger.error('Failed to import users from CSV', { error: error.message })
    return { success: false, error: error.message || 'Failed to import users', imported: 0, failed: 0, errors: [] }
  }
}
