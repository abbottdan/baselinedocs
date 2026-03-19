/**
 * Email Notification Service - Phase 2
 * 
 * Sends immediate or queued email notifications using Resend
 * Critical notifications always immediate, others respect user delivery mode
 * 
 * Now includes API usage tracking for billing
 */

import { Resend } from 'resend'
import { createClient, createServiceRoleClient , createSharedClient} from '@/lib/supabase/server'

const resend = new Resend(process.env.RESEND_API_KEY)
const fromEmail = process.env.EMAIL_FROM || 'notifications@baselinedocs.com'
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://app.baselinedocs.com'

interface EmailContext {
  documentNumber: string
  documentVersion: string
  documentTitle: string
  documentId: string
  submittedBy?: string
  rejectedBy?: string
  rejectionReason?: string
}

/**
 * ⭐ NEW: Track email usage for billing
 */
async function trackEmailUsage(
  tenantId: string,
  recipientEmail: string,
  subject: string,
  status: 'success' | 'error'
) {
  try {
    const supabaseAdmin = createServiceRoleClient()
    
    await supabaseAdmin
      .from('api_usage')
      .insert({
        tenant_id: tenantId,
        api_type: 'resend_email',
        endpoint: 'emails/send',
        status,
        request_data: {
          to: recipientEmail,
          subject: subject.substring(0, 100) // Truncate for storage
        },
        response_data: status === 'success' ? { sent: true } : null
      })
    
    console.log(`[API Usage] Tracked email: ${status}`)
  } catch (error) {
    console.error('[API Usage] Failed to track email usage:', error)
  }
}

/**
 * Check if user should receive this notification immediately, queue it, or skip it
 * Critical notifications (approval_requested, document_rejected) always immediate
 */
async function shouldNotifyOrQueue(
  userId: string,
  notificationType: 'approval_requested' | 'approval_completed' | 'document_rejected' | 'document_released'
): Promise<{
  action: 'immediate' | 'queue' | 'disabled'
  email: string | null
  userName: string
  tenantId: string | null
  digestTime: string | null
}> {
  const supabase = await createClient()

  // Get user info
  const _emailSharedClient = createSharedClient()
    const { data: user } = await _emailSharedClient
      .schema('shared')
      .from('users')
      .select('email, full_name, tenant_id')
      .eq('id', userId)
      .single()

  if (!user?.email) {
    return { action: 'disabled', email: null, userName: '', tenantId: null, digestTime: null }
  }

  // Get user preferences
  const { data: prefs } = await supabase
    .from('user_notification_preferences')
    .select('approval_requested, approval_completed, document_rejected, document_released, delivery_mode, digest_time')
    .eq('user_id', userId)
    .single()

  // Check if notification type is enabled
  const enabled = prefs ? (prefs as any)[notificationType] ?? true : true
  
  if (!enabled) {
    return { action: 'disabled', email: null, userName: user.full_name || '', tenantId: user.tenant_id, digestTime: null }
  }

  // Critical notifications always immediate
  const criticalNotifications = ['approval_requested', 'document_rejected']
  if (criticalNotifications.includes(notificationType)) {
    return {
      action: 'immediate',
      email: user.email,
      userName: user.full_name || user.email.split('@')[0],
      tenantId: user.tenant_id,
      digestTime: null
    }
  }

  // Non-critical: respect delivery mode
  const deliveryMode = prefs?.delivery_mode || 'immediate'
  const digestTime = prefs?.digest_time || '01:00:00'

  if (deliveryMode === 'digest') {
    return {
      action: 'queue',
      email: user.email,
      userName: user.full_name || user.email.split('@')[0],
      tenantId: user.tenant_id,
      digestTime: digestTime
    }
  }

  // Default: immediate
  return {
    action: 'immediate',
    email: user.email,
    userName: user.full_name || user.email.split('@')[0],
    tenantId: user.tenant_id,
    digestTime: null
  }
}

/**
 * Queue an email for digest delivery
 */
async function queueEmail(
  userId: string,
  tenantId: string,
  notificationType: string,
  subject: string,
  htmlBody: string,
  context: EmailContext,
  digestTime: string
) {
  const supabase = await createClient()

  // Calculate next digest time (today at digestTime, or tomorrow if already past)
  const now = new Date()
  const [hours, minutes] = digestTime.split(':').map(Number)
  const scheduledFor = new Date()
  scheduledFor.setUTCHours(hours, minutes, 0, 0)
  
  // If time already passed today, schedule for tomorrow
  if (scheduledFor <= now) {
    scheduledFor.setDate(scheduledFor.getDate() + 1)
  }

  const { error } = await supabase
    .from('email_queue')
    .insert({
      user_id: userId,
      tenant_id: tenantId,
      notification_type: notificationType,
      subject: subject,
      html_body: htmlBody,
      document_id: context.documentId,
      document_number: context.documentNumber,
      document_version: context.documentVersion,
      document_title: context.documentTitle,
      metadata: {
        submittedBy: context.submittedBy,
        rejectedBy: context.rejectedBy,
        rejectionReason: context.rejectionReason
      },
      scheduled_for: scheduledFor.toISOString(),
      status: 'pending'
    })

  if (error) {
    console.error('[Email Queue] Failed to queue email:', error)
    return { success: false, error }
  }

  console.log(`[Email Queue] ✓ Queued ${notificationType} for ${userId} at ${scheduledFor.toISOString()}`)
  return { success: true }
}

/**
 * 1. Approval Request Email (ALWAYS IMMEDIATE)
 */
export async function sendApprovalRequestEmail(
  approverId: string,
  context: EmailContext
) {
  const check = await shouldNotifyOrQueue(approverId, 'approval_requested')
  
  if (check.action === 'disabled' || !check.email) {
    console.log(`[Email] Skipping approval request for ${approverId} (disabled)`)
    return { success: false, reason: 'disabled' }
  }

  // Always immediate for approval requests
  const viewUrl = `${siteUrl}/documents/${context.documentId}`
  const subject = `⏳ Approval Needed: ${context.documentNumber}${context.documentVersion}`

  try {
    await resend.emails.send({
      from: fromEmail,
      to: check.email,
      subject,
      html: generateApprovalRequestHTML(check.userName, context, viewUrl),
    })

    console.log(`[Email] ✓ Sent approval request to ${check.email}`)
    
    // ⭐ Track email usage
    if (check.tenantId) {
      await trackEmailUsage(check.tenantId, check.email, subject, 'success')
      
      
    }
    
    return { success: true }
  } catch (error) {
    console.error('[Email] ✗ Failed to send approval request:', error)
    
    // Track failed email
    if (check.tenantId) {
      await trackEmailUsage(check.tenantId, check.email, subject, 'error')
    }
    
    return { success: false, reason: 'error', error }
  }
}

/**
 * 2. Approval Complete Email (RESPECTS DELIVERY MODE)
 */
export async function sendApprovalCompleteEmail(
  creatorId: string,
  context: EmailContext
) {
  const check = await shouldNotifyOrQueue(creatorId, 'approval_completed')
  
  if (check.action === 'disabled' || !check.email) {
    console.log(`[Email] Skipping approval complete for ${creatorId} (disabled)`)
    return { success: false, reason: 'disabled' }
  }

  const viewUrl = `${siteUrl}/documents/${context.documentId}`
  const subject = `✅ Document Approved: ${context.documentNumber}${context.documentVersion}`
  const htmlBody = generateApprovalCompleteHTML(check.userName, context, viewUrl)

  // Queue if user prefers digest
  if (check.action === 'queue' && check.tenantId && check.digestTime) {
    return await queueEmail(
      creatorId,
      check.tenantId,
      'approval_completed',
      subject,
      htmlBody,
      context,
      check.digestTime
    )
  }

  // Send immediately
  try {
    await resend.emails.send({
      from: fromEmail,
      to: check.email,
      subject,
      html: htmlBody,
    })

    console.log(`[Email] ✓ Sent approval complete to ${check.email}`)
    
    // ⭐ Track email usage
    if (check.tenantId) {
      await trackEmailUsage(check.tenantId, check.email, subject, 'success')
      
      
    }
    
    return { success: true }
  } catch (error) {
    console.error('[Email] ✗ Failed to send approval complete:', error)
    
    if (check.tenantId) {
      await trackEmailUsage(check.tenantId, check.email, subject, 'error')
    }
    
    return { success: false, reason: 'error', error }
  }
}

/**
 * 3. Document Rejected Email (ALWAYS IMMEDIATE)
 */
export async function sendDocumentRejectedEmail(
  creatorId: string,
  context: EmailContext
) {
  const check = await shouldNotifyOrQueue(creatorId, 'document_rejected')
  
  if (check.action === 'disabled' || !check.email) {
    console.log(`[Email] Skipping rejection notice for ${creatorId} (disabled)`)
    return { success: false, reason: 'disabled' }
  }

  const editUrl = `${siteUrl}/documents/${context.documentId}`
  const subject = `❌ Document Rejected: ${context.documentNumber}${context.documentVersion}`

  try {
    await resend.emails.send({
      from: fromEmail,
      to: check.email,
      subject,
      html: generateDocumentRejectedHTML(check.userName, context, editUrl),
    })

    console.log(`[Email] ✓ Sent rejection notice to ${check.email}`)
    
    // ⭐ Track email usage
    if (check.tenantId) {
      await trackEmailUsage(check.tenantId, check.email, subject, 'success')
      
      
    }
    
    return { success: true }
  } catch (error) {
    console.error('[Email] ✗ Failed to send rejection notice:', error)
    
    if (check.tenantId) {
      await trackEmailUsage(check.tenantId, check.email, subject, 'error')
    }
    
    return { success: false, reason: 'error', error }
  }
}

/**
 * 4. Document Released Email (RESPECTS DELIVERY MODE)
 */
export async function sendDocumentReleasedEmail(
  creatorId: string,
  context: EmailContext
) {
  const check = await shouldNotifyOrQueue(creatorId, 'document_released')
  
  if (check.action === 'disabled' || !check.email) {
    console.log(`[Email] Skipping release notice for ${creatorId} (disabled)`)
    return { success: false, reason: 'disabled' }
  }

  const viewUrl = `${siteUrl}/documents/${context.documentId}`
  const subject = `🎉 Document Released: ${context.documentNumber}${context.documentVersion}`
  const htmlBody = generateDocumentReleasedHTML(check.userName, context, viewUrl)

  // Queue if user prefers digest
  if (check.action === 'queue' && check.tenantId && check.digestTime) {
    return await queueEmail(
      creatorId,
      check.tenantId,
      'document_released',
      subject,
      htmlBody,
      context,
      check.digestTime
    )
  }

  // Send immediately
  try {
    await resend.emails.send({
      from: fromEmail,
      to: check.email,
      subject,
      html: htmlBody,
    })

    console.log(`[Email] ✓ Sent release notice to ${check.email}`)
    
    // ⭐ Track email usage
    if (check.tenantId) {
      await trackEmailUsage(check.tenantId, check.email, subject, 'success')
      
      
    }
    
    return { success: true }
  } catch (error) {
    console.error('[Email] ✗ Failed to send release notice:', error)
    
    if (check.tenantId) {
      await trackEmailUsage(check.tenantId, check.email, subject, 'error')
    }
    
    return { success: false, reason: 'error', error }
  }
}

// HTML template generation functions...
function generateApprovalRequestHTML(userName: string, context: EmailContext, viewUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">⏳ Approval Needed</h1>
  </div>
  
  <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
    <p style="margin-top: 0; font-size: 16px;">Hi ${userName},</p>
    
    <p>A document has been submitted for your approval.</p>
    
    <div style="background: white; border-left: 4px solid #667eea; padding: 20px; margin: 20px 0; border-radius: 5px;">
      <p style="margin: 0 0 10px 0;"><strong>Document:</strong> ${context.documentNumber}${context.documentVersion}</p>
      <p style="margin: 0;"><strong>Title:</strong> ${context.documentTitle}</p>
      ${context.submittedBy ? `<p style="margin: 10px 0 0 0;"><strong>Submitted by:</strong> ${context.submittedBy}</p>` : ''}
    </div>
    
    <p>Please review the document and provide your approval or feedback.</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${viewUrl}" style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">Review Document</a>
    </div>
    
    <p style="color: #666; font-size: 14px; margin-bottom: 0;">This is an automated notification from your Document Control System.</p>
  </div>
</body>
</html>
  `
}

function generateApprovalCompleteHTML(userName: string, context: EmailContext, viewUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #56ab2f 0%, #a8e063 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">✅ Document Approved</h1>
  </div>
  
  <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
    <p style="margin-top: 0; font-size: 16px;">Hi ${userName},</p>
    
    <p>Your document has been approved by all reviewers and is now released!</p>
    
    <div style="background: white; border-left: 4px solid #56ab2f; padding: 20px; margin: 20px 0; border-radius: 5px;">
      <p style="margin: 0 0 10px 0;"><strong>Document:</strong> ${context.documentNumber}${context.documentVersion}</p>
      <p style="margin: 0;"><strong>Title:</strong> ${context.documentTitle}</p>
    </div>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${viewUrl}" style="background: #56ab2f; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">View Document</a>
    </div>
    
    <p style="color: #666; font-size: 14px; margin-bottom: 0;">This is an automated notification from your Document Control System.</p>
  </div>
</body>
</html>
  `
}

function generateDocumentRejectedHTML(userName: string, context: EmailContext, editUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #f5576c 0%, #f093fb 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">❌ Document Rejected</h1>
  </div>
  
  <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
    <p style="margin-top: 0; font-size: 16px;">Hi ${userName},</p>
    
    <p>Your document has been rejected and returned to draft status.</p>
    
    <div style="background: white; border-left: 4px solid #f5576c; padding: 20px; margin: 20px 0; border-radius: 5px;">
      <p style="margin: 0 0 10px 0;"><strong>Document:</strong> ${context.documentNumber}${context.documentVersion}</p>
      <p style="margin: 0;"><strong>Title:</strong> ${context.documentTitle}</p>
      ${context.rejectedBy ? `<p style="margin: 10px 0 0 0;"><strong>Rejected by:</strong> ${context.rejectedBy}</p>` : ''}
      ${context.rejectionReason ? `
        <div style="margin-top: 15px; padding: 15px; background: #fff3cd; border-radius: 5px;">
          <p style="margin: 0; color: #856404;"><strong>Reason:</strong></p>
          <p style="margin: 5px 0 0 0; color: #856404;">${context.rejectionReason}</p>
        </div>
      ` : ''}
    </div>
    
    <p>You can now edit the document and resubmit it for approval.</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${editUrl}" style="background: #f5576c; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">Edit Document</a>
    </div>
    
    <p style="color: #666; font-size: 14px; margin-bottom: 0;">This is an automated notification from your Document Control System.</p>
  </div>
</body>
</html>
  `
}

function generateDocumentReleasedHTML(userName: string, context: EmailContext, viewUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">🎉 Document Released</h1>
  </div>
  
  <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
    <p style="margin-top: 0; font-size: 16px;">Hi ${userName},</p>
    
    <p>Your document has been released and is now available to all users.</p>
    
    <div style="background: white; border-left: 4px solid #00f2fe; padding: 20px; margin: 20px 0; border-radius: 5px;">
      <p style="margin: 0 0 10px 0;"><strong>Document:</strong> ${context.documentNumber}${context.documentVersion}</p>
      <p style="margin: 0;"><strong>Title:</strong> ${context.documentTitle}</p>
    </div>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${viewUrl}" style="background: #00f2fe; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">View Document</a>
    </div>
    
    <p style="color: #666; font-size: 14px; margin-bottom: 0;">This is an automated notification from your Document Control System.</p>
  </div>
</body>
</html>
  `
}

/**
 * 5. Welcome Email (for new user accounts)
 */
export async function sendWelcomeEmail(
  userEmail: string,
  userName: string,
  tenantSubdomain: string,
  tenantName: string,
  tenantId: string
) {
  const loginUrl = `https://${tenantSubdomain}.baselinedocs.com`
  const settingsUrl = `${loginUrl}/settings/notifications`
  const subject = `🎉 Welcome to ${tenantName} on BaselineDocs!`

  try {
    await resend.emails.send({
      from: fromEmail,
      to: userEmail,
      subject,
      html: generateWelcomeHTML(userName, tenantName, tenantSubdomain, loginUrl, settingsUrl),
    })

    console.log(`[Email] ✓ Sent welcome email to ${userEmail}`)
    
    // ⭐ Track email usage
    await trackEmailUsage(tenantId, userEmail, subject, 'success')
    
    return { success: true }
  } catch (error) {
    console.error('[Email] ✗ Failed to send welcome email:', error)
    
    await trackEmailUsage(tenantId, userEmail, subject, 'error')
    
    return { success: false, reason: 'error', error }
  }
}

function generateWelcomeHTML(
  userName: string,
  tenantName: string,
  subdomain: string,
  loginUrl: string,
  settingsUrl: string
): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f5;">
  <div style="background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
    <!-- Header with gradient -->
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
      <div style="font-size: 48px; margin-bottom: 10px;">🎉</div>
      <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 600;">Welcome to BaselineDocs!</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">Your document control journey starts here</p>
    </div>
    
    <!-- Main content -->
    <div style="padding: 40px 30px;">
      <p style="margin-top: 0; font-size: 18px; color: #333;">Hi ${userName},</p>
      
      <p style="font-size: 16px; color: #555;">You've been added to <strong>${tenantName}</strong>'s document control system. You now have access to create, review, and manage controlled documents with your team.</p>
      
      <!-- Quick Start Box -->
      <div style="background: #f8f9ff; border: 2px solid #667eea; border-radius: 8px; padding: 25px; margin: 30px 0;">
        <h2 style="margin: 0 0 15px 0; font-size: 20px; color: #667eea;">🚀 Quick Start Guide</h2>
        <ol style="margin: 0; padding-left: 20px; color: #555;">
          <li style="margin-bottom: 10px;">Click the button below to sign in to your organization</li>
          <li style="margin-bottom: 10px;">Bookmark your unique login page for easy access</li>
          <li style="margin-bottom: 10px;">Explore the dashboard and start creating documents</li>
          <li style="margin-bottom: 0;">Customize your email preferences if needed</li>
        </ol>
      </div>
      
      <!-- Important Info Box -->
      <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 20px; margin: 25px 0; border-radius: 5px;">
        <p style="margin: 0 0 10px 0; color: #92400e; font-weight: 600;">📌 Important: Your Login Page</p>
        <p style="margin: 0; color: #92400e; font-size: 14px;">Always sign in through your organization's unique subdomain:</p>
        <p style="margin: 10px 0 0 0; font-family: 'Courier New', monospace; background: white; padding: 12px; border-radius: 4px; color: #667eea; font-weight: 600; font-size: 16px;">
          ${loginUrl}
        </p>
      </div>
      
      <!-- CTA Button -->
      <div style="text-align: center; margin: 35px 0;">
        <a href="${loginUrl}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 18px; box-shadow: 0 4px 6px rgba(102, 126, 234, 0.3);">
          Sign In to ${tenantName}
        </a>
      </div>
      
      <!-- What You Can Do -->
      <div style="margin: 35px 0;">
        <h3 style="color: #333; font-size: 18px; margin-bottom: 15px;">What you can do:</h3>
        <div style="display: flex; margin-bottom: 12px;">
          <span style="color: #667eea; font-size: 20px; margin-right: 10px;">📝</span>
          <span style="color: #555;">Create and manage controlled documents with version tracking</span>
        </div>
        <div style="display: flex; margin-bottom: 12px;">
          <span style="color: #667eea; font-size: 20px; margin-right: 10px;">✅</span>
          <span style="color: #555;">Review and approve documents submitted by your colleagues</span>
        </div>
        <div style="display: flex; margin-bottom: 12px;">
          <span style="color: #667eea; font-size: 20px; margin-right: 10px;">📊</span>
          <span style="color: #555;">Track document status and approval workflows</span>
        </div>
        <div style="display: flex; margin-bottom: 12px;">
          <span style="color: #667eea; font-size: 20px; margin-right: 10px;">🔔</span>
          <span style="color: #555;">Get notified when documents need your attention</span>
        </div>
      </div>
      
      <!-- Email Preferences -->
      <div style="background: #f1f5f9; padding: 20px; border-radius: 8px; margin: 25px 0;">
        <p style="margin: 0 0 10px 0; color: #475569; font-size: 14px;">
          <strong>Tip:</strong> You can customize how often you receive email notifications in your 
          <a href="${settingsUrl}" style="color: #667eea; text-decoration: none; font-weight: 600;">notification settings</a>.
        </p>
      </div>
      
      <!-- Footer -->
      <div style="margin-top: 40px; padding-top: 25px; border-top: 1px solid #e5e7eb; text-align: center;">
        <p style="color: #9ca3af; font-size: 13px; margin: 0 0 10px 0;">
          Questions? Need help? Contact your system administrator.
        </p>
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">
          This is an automated message from BaselineDocs.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `
}

