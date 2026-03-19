// app/actions/company-settings.ts
'use server'

import { createClient , createSharedClient} from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { getSubdomainTenantId } from '@/lib/tenant'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

// Color fields removed — app colors are now fixed to the ClearStride brand system.
const companySettingsSchema = z.object({
  company_name: z.string().min(1, 'Company name is required').max(100),
  logo_url: z.string().url().nullable().optional(),
  auto_rename_files: z.boolean(),
  timezone: z.string().min(1, 'Timezone is required'),
})

/**
 * Upload company logo to Supabase Storage
 */
export async function uploadCompanyLogo(formData: FormData) {
  const supabase = await createClient()

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError || !user) {
      return { success: false, error: 'You must be logged in' }
    }

    const sharedClient = createSharedClient()
      const { data: _su } = await sharedClient
        .schema('shared').from('users')
        .select('is_master_admin, tenant_id')
        .eq('id', user.id).single()
      let _isAdmin = _su?.is_master_admin ?? false
      if (_su && !_su.is_master_admin) {
        const { data: rr } = await supabase.schema('docs').from('user_roles')
          .select('role').eq('user_id', user.id).eq('tenant_id', _su.tenant_id).single()
        _isAdmin = ['tenant_admin','master_admin'].includes(rr?.role ?? '')
      }
      const userData = { is_admin: _isAdmin }

    if (!userData?.is_admin) {
      return { success: false, error: 'Only administrators can upload logos' }
    }

    const tenantId = formData.get('tenantId') as string
    const subdomainTenantId = await getSubdomainTenantId()
    
    if (tenantId !== subdomainTenantId) {
      return { success: false, error: 'Tenant ID does not match subdomain tenant ID' }
    }

    if (!tenantId) {
      return { success: false, error: 'Tenant ID required' }
    }

    const file = formData.get('logo') as File
    
    if (!file) {
      return { success: false, error: 'No file provided' }
    }

    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml']
    if (!validTypes.includes(file.type)) {
      return { success: false, error: 'Invalid file type. Only PNG, JPG, and SVG are allowed' }
    }

    if (file.size > 5 * 1024 * 1024) {
      return { success: false, error: 'File size must be less than 5MB' }
    }

    const { data: tenant } = await createPlatformClient()
        .schema('platform')
        .from('tenants')
      .select('subdomain')
      .eq('id', tenantId)
      .single()

    if (!tenant) {
      return { success: false, error: 'Tenant not found' }
    }

    const fileExt = file.name.split('.').pop()
    const fileName = `${tenant.subdomain}-logo.${fileExt}`
    const filePath = `logos/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('company-logos')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true,
      })

    if (uploadError) {
      console.error('Logo upload error:', uploadError)
      return { success: false, error: uploadError.message || 'Failed to upload logo' }
    }

    const { data: { publicUrl } } = supabase.storage
      .from('company-logos')
      .getPublicUrl(filePath)

    const { error: updateError } = await createPlatformClient()
        .schema('platform')
        .from('tenants')
      .update({ 
        logo_url: publicUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', tenantId)

    if (updateError) {
      console.error('Update tenant error:', updateError)
      return { success: false, error: 'Failed to save logo URL' }
    }

    revalidatePath('/')
    revalidatePath('/dashboard')
    revalidatePath('/admin/settings')

    return { 
      success: true,
      logoUrl: publicUrl,
      message: 'Logo uploaded successfully'
    }

  } catch (error: any) {
    console.error('Upload logo error:', error)
    return { 
      success: false, 
      error: error.message || 'Failed to upload logo' 
    }
  }
}

/**
 * Update company settings
 * Note: color fields (primary_color, secondary_color, background colors) have been
 * removed. Those columns still exist in the DB schema but are no longer written to
 * from the app. A future migration can drop them once confirmed stable.
 */
export async function updateCompanySettings(data: {
  tenantId: string
  company_name: string
  logo_url: string | null
  auto_rename_files: boolean
  timezone: string
}) {
  const supabase = await createClient()

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    if (userError || !user) {
      return { success: false, error: 'You must be logged in' }
    }

    const validation = companySettingsSchema.safeParse(data)
    if (!validation.success) {
      return { 
        success: false, 
        error: validation.error.errors[0].message 
      }
    }

    const sharedClient = createSharedClient()
      const { data: _su } = await sharedClient
        .schema('shared').from('users')
        .select('is_master_admin, tenant_id')
        .eq('id', user.id).single()
      let _isAdmin = _su?.is_master_admin ?? false
      if (_su && !_su.is_master_admin) {
        const { data: rr } = await supabase.schema('docs').from('user_roles')
          .select('role').eq('user_id', user.id).eq('tenant_id', _su.tenant_id).single()
        _isAdmin = ['tenant_admin','master_admin'].includes(rr?.role ?? '')
      }
      const userData = { is_admin: _isAdmin }

    if (!userData?.is_admin) {
      return { success: false, error: 'Only administrators can update company settings' }
    }

    const { error: updateError } = await createPlatformClient()
        .schema('platform')
        .from('tenants')
      .update({
        company_name: validation.data.company_name,
        logo_url: validation.data.logo_url,
        auto_rename_files: validation.data.auto_rename_files,
        timezone: validation.data.timezone,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.tenantId)

    if (updateError) {
      console.error('Update tenant error:', updateError)
      throw updateError
    }

    revalidatePath('/')
    revalidatePath('/dashboard')
    revalidatePath('/admin/settings')

    return { 
      success: true,
      message: 'Company settings updated successfully'
    }

  } catch (error: any) {
    console.error('Update company settings error:', error)
    return { 
      success: false, 
      error: error.message || 'Failed to update company settings' 
    }
  }
}

/**
 * Get current tenant settings
 */
export async function getCompanySettings() {
  const supabase = await createClient()

  try {
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return { success: false, error: 'Not authenticated', data: null }
    }

    const { data: userData } = await supabase
      .schema('shared')
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!userData) {
      return { success: false, error: 'User not found', data: null }
    }

    const { data: tenant, error } = await createPlatformClient()
        .schema('platform')
        .from('tenants')
      .select('*')
      .eq('id', userData.tenant_id)
      .single()

    if (error) {
      throw error
    }

    return { success: true, data: tenant }

  } catch (error: any) {
    console.error('Get company settings error:', error)
    return { 
      success: false, 
      error: error.message || 'Failed to get company settings',
      data: null
    }
  }
}
