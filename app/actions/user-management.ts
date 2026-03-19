// app/actions/user-management.ts
'use server'

import { createClient, createSharedClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { requireAdmin } from '@/lib/auth/require-admin'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logger, logServerAction, logError } from '@/lib/logger'
import { uuidSchema } from '@/lib/validation/schemas'
import { getSubdomainTenantId } from '@/lib/tenant'

// User role type
// Type exports for components
export type UserRole = 'Admin' | 'Normal' | 'Read Only' | 'Deactivated'

// Validation schema for user updates
const userUpdateSchema = z.object({
  role: z.enum(['Admin', 'Normal', 'Read Only', 'Deactivated']),
  reason: z.string().optional()
})

/**
 * Get all users (admin only, filtered by tenant)
 */

export async function getAllUsers() {
  const startTime = Date.now()
  const supabase = await createClient()
  const supabaseAdmin = createServiceRoleClient() // For cross-tenant access

  try {
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      logger.warn('Unauthorized user list access attempt')
      return {
        success: false,
        error: 'You must be logged in',
        data: []
      }
    }

    const userId = user.id
    const userEmail = user.email

    // Check admin status
    const { isAdmin, isMasterAdmin, tenantId: userTenantId, error: adminError } = await requireAdmin(userId, supabase)
    if (!isAdmin) {
      logger.warn('Non-admin attempted to access user list', { userId, userEmail })
      return { success: false, error: 'Only administrators can view user list', data: [] }
    }

    logger.debug('Fetching users for tenant', { userId, userEmail, tenantId: userTenantId, isMasterAdmin })

    // Get subdomain tenant (not user's home tenant)
    const targetTenantId = await getSubdomainTenantId()
    if (!targetTenantId) {
      return { success: false, error: 'Tenant not found' }
    }

    logger.info('getAllUsers - Filtering by tenant', { targetTenantId })

    // Use service role client to bypass RLS for cross-tenant access (master admin)
    // Regular client would be blocked by RLS when accessing other tenants
    const sharedAdmin = createSharedClient()
    let query = sharedAdmin
        .schema('shared')
        .from('users')
        .select(`
        id,
        email,
        full_name,
        is_master_admin,
        is_active,
        created_at,
        updated_at,
        last_sign_in_at,
        tenant_id
      `)

    // Filter by subdomain tenant
    query = query.eq('tenant_id', targetTenantId)

    const { data: users, error: fetchError } = await query.order('created_at', { ascending: false })

    if (fetchError) {
      logger.error('Failed to fetch users', {
        userId,
        error: fetchError
      })
      throw fetchError
    }

    // Batch fetch roles from docs.user_roles for all users in this tenant
    const { data: roleRows } = await supabase
      .schema('docs')
      .from('user_roles')
      .select('user_id, role')
      .eq('tenant_id', targetTenantId)
    const roleMap: Record<string, string> = Object.fromEntries(
      (roleRows || []).map(r => [r.user_id, r.role])
    )

    // Map DB roles to UI roles
    const DB_ROLE_TO_UI: Record<string, UserRole> = {
      master_admin:  'Admin',
      tenant_admin:  'Admin',
      user:          'Normal',
      readonly:      'Read Only',
    }

    // Get document counts for each user
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

        const dbRole = u.is_master_admin ? 'master_admin' : (roleMap[u.id] ?? 'user')
        const uiRole: UserRole = DB_ROLE_TO_UI[dbRole] ?? 'Normal'

        return {
          ...u,
          is_admin: u.is_master_admin || ['tenant_admin', 'master_admin'].includes(dbRole),
          role: uiRole,
          document_count: docCount || 0,
          approval_count: approvalCount || 0,
        }
      })
    )

    const duration = Date.now() - startTime
    logger.info('User list fetched successfully', {
      userId,
      userCount: usersWithStats.length,
      tenantId: userTenantId,
      isMasterAdmin,
      duration
    })

    return {
      success: true,
      data: usersWithStats
    }
  } catch (error: any) {
    const duration = Date.now() - startTime
    logger.error('Failed to fetch users', {
      error: error.message,
      stack: error.stack,
      duration
    })

    return {
      success: false,
      error: error.message || 'Failed to fetch users',
      data: []
    }
  }
}

/**
 * Update user role (admin only)
 */
export async function updateUserRole(
  targetUserId: string,
  newRole: UserRole,
  reason?: string
) {
  const startTime = Date.now()
  const supabase = await createClient()
  const supabaseAdmin = createServiceRoleClient()

  try {
    // Get subdomain tenant context
    const targetTenantId = await getSubdomainTenantId()
    if (!targetTenantId) return { success: false, error: 'Invalid tenant context' }
    // Validate UUID
    const { success: uuidValid } = uuidSchema.safeParse(targetUserId)
    if (!uuidValid) {
      return { success: false, error: 'Invalid user ID' }
    }

    // Validate inputs
    const { success, data, error: validationError } = userUpdateSchema.safeParse({ role: newRole, reason })
    if (!success) {
      return { success: false, error: validationError.errors[0].message }
    }

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return { success: false, error: 'You must be logged in' }
    }

    const userId = user.id
    const userEmail = user.email

    // Check admin status
    const { isAdmin: _isAdminCheck, error: _adminRoleErr } = await requireAdmin(userId, supabase)
    if (!_isAdminCheck) {
      logger.warn('Non-admin attempted to change user role', { userId, userEmail })
      return { success: false, error: 'Only administrators can change user roles' }
    }

    // Get target user details
    const { data: targetUser, error: targetError } = await supabaseAdmin
      .schema('shared')
      .from('users')
      .select('email, full_name')
      .eq('id', targetUserId)
      .single()

    if (targetError || !targetUser) {
      logger.error('User lookup failed', {
        targetUserId,
        errorCode: targetError?.code,  
        errorMessage: targetError?.message,
        dataIsNull: !targetUser
      })
      return { success: false, error: `User not found (${targetError?.code || 'no data'})` }
    }

    logger.info('Updating user role', {
      adminId: userId,
      adminEmail: userEmail,
      targetUserId,
      targetEmail: targetUser.email,
      oldRole: null, // fetched separately from docs.user_roles if needed
      newRole: data.role,
      reason: data.reason
    })

    // Update role in docs.user_roles (shared.users has no role column)
    // Map UI role to DB role
    const dbRoleMap: Record<string, string> = {
      'Admin':      'tenant_admin',
      'Normal':     'user',
      'Read Only':  'readonly',
      'Deactivated': 'user',
    }
    const newDbRole = dbRoleMap[data.role] ?? 'user'

    const { error: updateError } = await supabaseAdmin
      .schema('docs')
      .from('user_roles')
      .upsert({
        user_id: targetUserId,
        tenant_id: targetTenantId,
        role: newDbRole,
      }, { onConflict: 'user_id,tenant_id' })

    // If deactivating, also set is_active=false on shared.users
    if (data.role === 'Deactivated') {
      await supabaseAdmin
        .schema('shared')
        .from('users')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', targetUserId)
    } else {
      // Ensure user is active
      await supabaseAdmin
        .schema('shared')
        .from('users')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('id', targetUserId)
    }

    if (updateError) {
      logger.error('Failed to update user role', {
        adminId: userId,
        targetUserId,
        error: updateError
      })
      throw updateError
    }

    // Log the role change in audit log (future enhancement)
    // For now, just server logs

    const duration = Date.now() - startTime
    logger.info('User role updated successfully', {
      adminId: userId,
      targetUserId,
      targetEmail: targetUser.email,
      newRole: data.role,
      duration
    })

    revalidatePath('/admin/users')

    return {
      success: true,
      message: `Updated ${targetUser.full_name || targetUser.email}'s role to ${data.role}`
    }
  } catch (error: any) {
    const duration = Date.now() - startTime
    logger.error('Failed to update user role', {
      error: error.message,
      stack: error.stack,
      duration
    })

    return {
      success: false,
      error: error.message || 'Failed to update user role'
    }
  }
}

/**
 * Add a new user (admin only)
 */
export async function addUser(data: {
  email: string
  firstName: string
  lastName: string
  role: UserRole
}) {
  const startTime = Date.now()
  const supabase = await createClient()
  const supabaseAdmin = createServiceRoleClient() // For admin API operations

  try {
    // Validate input
    const schema = z.object({
      email: z.string().email('Invalid email address'),
      firstName: z.string().min(1, 'First name is required').max(100),
      lastName: z.string().min(1, 'Last name is required').max(100),
      role: z.enum(['Admin', 'Normal', 'Read Only', 'Deactivated'])
    })

    const validation = schema.safeParse(data)
    if (!validation.success) {
      return {
        success: false,
        error: validation.error.errors[0].message
      }
    }

    // Get current user and verify admin
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return { success: false, error: 'You must be logged in' }
    }

    const { data: userData } = await supabase
      .schema('shared')
      .from('users')
      .select('is_master_admin, tenant_id')
      .eq('id', user.id)
      .single()

    let _isAdminAdd = userData?.is_master_admin ?? false
    if (userData && !userData.is_master_admin) {
      const { data: _rr } = await supabase.schema('docs').from('user_roles')
        .select('role').eq('user_id', user.id).eq('tenant_id', userData.tenant_id).single()
      _isAdminAdd = ['tenant_admin', 'master_admin'].includes(_rr?.role ?? '')
    }
    if (!_isAdminAdd) {
      return { success: false, error: 'Only administrators can add users' }
    }

    // Get subdomain tenant (not user's home tenant)
    const { cookies } = await import('next/headers')
    const cookieStore = await cookies()
    const subdomainCookie = cookieStore.get('tenant_subdomain')
    const subdomain = subdomainCookie?.value

    if (!subdomain) {
      return { success: false, error: 'Unable to determine tenant context' }
    }

    // Get the subdomain's tenant ID
    const targetTenantId = await getSubdomainTenantId()
    if (!targetTenantId) {
      return { success: false, error: 'Tenant not found' }
    }

    // Enhanced debugging version for user limit check
    // Replace lines 383-421 in app/actions/user-management.ts

    console.log('🔍 [User Limit Check] Starting user limit validation')
    console.log('🔍 [User Limit Check] Subdomain:', subdomain)
    console.log('🔍 [User Limit Check] Target Tenant ID:', targetTenantId)

    // Get tenant's user limit from platform.product_subscriptions
    const { data: billingData, error: billingError } = await createPlatformClient()
      .schema('platform')
      .from('product_subscriptions')
      .select('plan, user_limit')
      .eq('tenant_id', targetTenantId)
      .eq('product', 'baselinedocs')
      .single()

    console.log('🔍 [User Limit Check] Billing query result:', {
      billingData,
      billingError: billingError?.message
    })

    if (!billingData) {
      console.error('❌ [User Limit Check] No billing data found for tenant:', targetTenantId)
      return { success: false, error: 'Unable to determine plan limits' }
    }

    const currentPlan = billingData.plan
    const userLimit = billingData.user_limit

    console.log('🔍 [User Limit Check] Plan details:', {
      currentPlan,
      userLimit,
      userLimitType: typeof userLimit
    })

    // Enhanced debug - shows EACH user being counted
    // Replace the user count query section (around lines 413-424)

    // Count users in tenant (include all except Deactivated role)
    console.log('🔍 [User Limit Check] Counting existing users...')
    console.log('🔍 [User Limit Check] Query: tenant_id =', targetTenantId, ', role !=', 'Deactivated')

    const { count: userCount, error: countError, data: debugUsers } = await supabaseAdmin
      .schema('shared')
      .from('users')
      .select('id, email, is_active', { count: 'exact' })
      .eq('tenant_id', targetTenantId)
      .eq('is_active', true)

    // LOG EVERY SINGLE USER
    console.log('🔍 [User Limit Check] User count result:', {
      userCount,
      countError: countError?.message,
      actualUsers: debugUsers?.length
    })

    console.log('🔍 [User Limit Check] FULL USER LIST:')
    debugUsers?.forEach((u, index) => {
      console.log(`  ${index + 1}. ${u.email} | Active: ${u.is_active}`)
    })

    console.log('🔍 [User Limit Check] Summary:', {
      totalFound: debugUsers?.length,
      countReturned: userCount,
      shouldMatch: debugUsers?.length === userCount
    })

    if (countError) {
      console.error('❌ [User Limit Check] Failed to count users:', countError)
      logger.error('Failed to count users', { error: countError })
      return { success: false, error: 'Failed to check user limits' }
    }

    console.log('🔍 [User Limit Check] Comparison:', {
      userCount,
      userLimit,
      wouldBlock: userCount !== null && userCount >= userLimit,
      calculation: `${userCount} >= ${userLimit} = ${userCount !== null && userCount >= userLimit}`
    })

    // Log the check for debugging
    logger.info('User limit check', {
      currentPlan,
      userLimit,
      userCount,
      targetTenantId,
      attemptingToAdd: data.email
    })

    if (userCount !== null && userCount >= userLimit) {
      const planNames: Record<string, string> = {
        trial: 'Trial',
        starter: 'Starter',
        professional: 'Professional',
        enterprise: 'Enterprise'
      }

      console.log('🚫 [User Limit Check] LIMIT REACHED - Blocking user creation')
      console.log('🚫 [User Limit Check] Details:', {
        plan: currentPlan,
        planName: planNames[currentPlan],
        limit: userLimit,
        current: userCount,
        attemptedEmail: data.email
      })

      logger.warn('User limit reached', {
        plan: currentPlan,
        limit: userLimit,
        current: userCount,
        attemptedBy: user.email,
        attemptedEmail: data.email
      })

      return {
        success: false,
        error: `Your ${planNames[currentPlan] || currentPlan} plan is limited to ${userLimit} users. Please upgrade your plan to add more users.`,
        requiresUpgrade: true,
        currentPlan,
        userLimit,
        currentUsers: userCount
      }
    }

    console.log('✅ [User Limit Check] PASSED - User count within limit')
    console.log('✅ [User Limit Check] Proceeding with user creation...')


    // Check if user already exists in public.users
    const { data: existingUser } = await supabase
      .schema('shared')
      .from('users')
      .select('id, email')
      .eq('email', validation.data.email.toLowerCase())
      .single()

    if (existingUser) {
      return {
        success: false,
        error: 'A user with this email address already exists'
      }
    }

    // Check if user exists in auth.users (may have been deleted from public.users)
    // Use service role client for admin operations
    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers()
    const existingAuthUser = authUsers?.users.find(
      u => u.email?.toLowerCase() === validation.data.email.toLowerCase()
    )

    let authUserId: string

    if (existingAuthUser) {
      // User exists in auth but not in public.users - reuse the auth user
      authUserId = existingAuthUser.id

      // Update their metadata
      await supabaseAdmin.auth.admin.updateUserById(existingAuthUser.id, {
        email_confirm: true,
        user_metadata: {
          full_name: `${validation.data.firstName} ${validation.data.lastName}`,
          first_name: validation.data.firstName,
          last_name: validation.data.lastName
        }
      })

      logger.info('Reusing existing auth user', {
        email: validation.data.email,
        authUserId: existingAuthUser.id
      })
    } else {
      // Create new auth user with service role client
      const { data: authUser, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
        email: validation.data.email.toLowerCase(),
        email_confirm: true, // Auto-confirm email
        user_metadata: {
          full_name: `${validation.data.firstName} ${validation.data.lastName}`,
          first_name: validation.data.firstName,
          last_name: validation.data.lastName
        }
      })

      if (createAuthError || !authUser.user) {
        logger.error('Failed to create auth user', { error: createAuthError })
        return {
          success: false,
          error: createAuthError?.message || 'Failed to create user account'
        }
      }

      authUserId = authUser.user.id
    }

    // Create user record in shared.users (no role/is_admin columns there)
    const { error: insertError } = await supabaseAdmin
      .schema('shared')
      .from('users')
      .insert({
        id: authUserId,
        email: validation.data.email.toLowerCase(),
        full_name: `${validation.data.firstName} ${validation.data.lastName}`,
        tenant_id: targetTenantId,
        is_master_admin: false,
        is_active: validation.data.role !== 'Deactivated'
      })

    if (insertError) {
      logger.error('Failed to create user record', { error: insertError })
      if (!existingAuthUser) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId)
      }
      return {
        success: false,
        error: 'Failed to create user record'
      }
    }

    // Write role to docs.user_roles (separate from shared.users)
    const dbRole = validation.data.role === 'Admin' ? 'tenant_admin'
      : validation.data.role === 'Read Only' ? 'readonly'
      : validation.data.role === 'Deactivated' ? 'user'
      : 'user'

    await supabaseAdmin
      .schema('docs')
      .from('user_roles')
      .upsert({
        user_id: authUserId,
        tenant_id: targetTenantId,
        role: dbRole,
      }, { onConflict: 'user_id,tenant_id' })

    // Get tenant info for welcome email
    const { data: tenantData } = await createPlatformClient()
      .schema('platform')
      .from('tenants')
      .select('id, subdomain, company_name')
      .eq('id', targetTenantId)
      .single()

    // Send welcome email (non-blocking, don't fail if email fails)
    if (tenantData) {
      try {
        const { sendWelcomeEmail } = await import('@/lib/email-notifications')
        await sendWelcomeEmail(
          validation.data.email.toLowerCase(),
          `${validation.data.firstName} ${validation.data.lastName}`,
          tenantData.subdomain,
          tenantData.company_name || tenantData.subdomain,
          tenantData.id
        )
      } catch (emailError) {
        logger.warn('Failed to send welcome email (non-critical)', {
          email: validation.data.email,
          error: emailError
        })
        // Don't fail user creation if email fails
      }
    }

    logger.info('User added successfully', {
      addedBy: user.email,
      newUserEmail: validation.data.email,
      role: validation.data.role,
      duration: Date.now() - startTime
    })

    revalidatePath('/admin/users')

    return {
      success: true,
      message: `User ${validation.data.email} added successfully`
    }
  } catch (error: any) {
    const duration = Date.now() - startTime
    logger.error('Failed to add user', {
      error: error.message,
      stack: error.stack,
      duration
    })

    return {
      success: false,
      error: error.message || 'Failed to add user'
    }
  }
}

/**
 * Import users from CSV (admin only)
 */
export async function importUsersFromCSV(csvData: string) {
  const startTime = Date.now()
  const supabase = await createClient()

  try {
    // Get current user and verify admin
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return {
        success: false,
        error: 'You must be logged in',
        imported: 0,
        failed: 0,
        errors: []
      }
    }

    const { data: userData } = await supabase
      .schema('shared')
      .from('users')
      .select('is_master_admin, tenant_id')
      .eq('id', user.id)
      .single()

    let _isAdminImport = userData?.is_master_admin ?? false
    if (userData && !userData.is_master_admin) {
      const { data: _rr } = await supabase.schema('docs').from('user_roles')
        .select('role').eq('user_id', user.id).eq('tenant_id', userData.tenant_id).single()
      _isAdminImport = ['tenant_admin', 'master_admin'].includes(_rr?.role ?? '')
    }
    if (!_isAdminImport) {
      return {
        success: false,
        error: 'Only administrators can import users',
        imported: 0,
        failed: 0,
        errors: []
      }
    }

    // Parse CSV
    const lines = csvData.trim().split('\n')
    if (lines.length < 2) {
      return {
        success: false,
        error: 'CSV file is empty or has no data rows',
        imported: 0,
        failed: 0,
        errors: []
      }
    }

    // Skip header row
    const dataRows = lines.slice(1)

    let imported = 0
    let failed = 0
    const errors: string[] = []

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i].trim()
      if (!row) continue // Skip empty rows

      const columns = row.split(',').map(col => col.trim().replace(/^["']|["']$/g, ''))

      if (columns.length < 4) {
        failed++
        errors.push(`Row ${i + 2}: Invalid format - expected 4 columns`)
        continue
      }

      const [firstName, lastName, email, role] = columns

      // Validate role
      if (!['Admin', 'Normal', 'Read Only'].includes(role)) {
        failed++
        errors.push(`Row ${i + 2}: Invalid role "${role}" - must be Admin, Normal, or Read Only`)
        continue
      }

      // Try to add user
      const result = await addUser({
        email,
        firstName,
        lastName,
        role: role as UserRole
      })

      if (result.success) {
        imported++
      } else {
        failed++
        errors.push(`Row ${i + 2} (${email}): ${result.error}`)
      }
    }

    logger.info('CSV import completed', {
      importedBy: user.email,
      imported,
      failed,
      duration: Date.now() - startTime
    })

    revalidatePath('/admin/users')

    return {
      success: true,
      imported,
      failed,
      errors,
      message: `Import complete: ${imported} users added, ${failed} failed`
    }
  } catch (error: any) {
    const duration = Date.now() - startTime
    logger.error('Failed to import users from CSV', {
      error: error.message,
      stack: error.stack,
      duration
    })

    return {
      success: false,
      error: error.message || 'Failed to import users',
      imported: 0,
      failed: 0,
      errors: []
    }
  }
}

/**
 * Generate CSV template for user import
 */
function generateUserImportTemplate(): string {
  return 'First Name,Last Name,Email,Role\nJohn,Doe,john.doe@example.com,Normal\nJane,Smith,jane.smith@example.com,Admin'
}

