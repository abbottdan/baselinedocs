/**
 * Storage Limit Check Helper
 * lib/storage-limit.ts
 */

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'

interface StorageLimitCheck {
  allowed: boolean
  currentStorageGB: number
  storageLimitGB: number
  availableGB: number
  percentUsed: number
  error?: string
}

export async function checkStorageLimit(
  tenantId: string,
  additionalBytes: number = 0
): Promise<StorageLimitCheck> {
  const supabase = await createClient()
  const supabaseAdmin = createServiceRoleClient()

  // Get tenant's storage limit
  const { data: billingData } = await createPlatformClient()
      .schema('platform')
      .from('product_subscriptions')
      .select('user_limit, plan, status')
      .eq('tenant_id', tenantId)
      .eq('product', 'baselinedocs')
      .single()

  if (!billingData || !billingData.storage_limit_gb) {
    return {
      allowed: false,
      currentStorageGB: 0,
      storageLimitGB: 1,
      availableGB: 0,
      percentUsed: 100,
      error: 'Unable to determine storage limit'
    }
  }

  const storageLimitGB = billingData.storage_limit_gb
  const storageLimitBytes = storageLimitGB * 1024 * 1024 * 1024

  // Calculate current storage usage (use admin client to bypass RLS)
  const { data: files } = await supabaseAdmin
    .from('document_files')
    .select('file_size, documents!inner(tenant_id)')
    .eq('documents.tenant_id', tenantId)

  const currentStorageBytes = files?.reduce((sum, file) => sum + (file.file_size || 0), 0) || 0
  const currentStorageGB = currentStorageBytes / (1024 * 1024 * 1024)

  // Check if we'd exceed limit with new files
  const totalAfterUpload = currentStorageBytes + additionalBytes
  const wouldExceed = totalAfterUpload > storageLimitBytes

  const availableBytes = storageLimitBytes - currentStorageBytes
  const availableGB = Math.max(0, availableBytes / (1024 * 1024 * 1024))
  const percentUsed = (currentStorageBytes / storageLimitBytes) * 100

  const planNames: Record<string, string> = {
    trial: 'Trial',
    starter: 'Starter',
    professional: 'Professional',
    enterprise: 'Enterprise'
  }

  const planName = planNames[billingData.plan] || billingData.plan

  return {
    allowed: !wouldExceed,
    currentStorageGB,
    storageLimitGB,
    availableGB,
    percentUsed,
    error: wouldExceed 
      ? `Storage limit reached. Your ${planName} plan includes ${storageLimitGB} GB of storage. Please upgrade to upload more files.`
      : undefined
  }
}

/**
 * Get total size of files to be uploaded
 */
export function getTotalFileSize(files: File[]): number {
  return files.reduce((sum, file) => sum + file.size, 0)
}
