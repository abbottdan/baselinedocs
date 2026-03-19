'use server'

import { Resend } from 'resend'
import { createClient , createSharedClient} from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const resend = new Resend(process.env.RESEND_API_KEY)
const SUPPORT_EMAIL = process.env.FEEDBACK_EMAIL || 'abbott.dan@gmail.com'
const FROM_FEEDBACK_EMAIL = process.env.FROM_FEEDBACK_EMAIL || 'support@baselinedocs.com'

// Validation schema
const contactFormSchema = z.object({
  subject: z.string().min(5, 'Subject must be at least 5 characters').max(200, 'Subject is too long'),
  message: z.string().min(20, 'Message must be at least 20 characters').max(5000, 'Message is too long'),
  priority: z.enum(['low', 'normal', 'high']),
  category: z.enum(['technical', 'billing', 'feature', 'general'])
})

export type ContactFormData = z.infer<typeof contactFormSchema>

export async function submitContactForm(data: ContactFormData) {
  try {
    // Validate input
    const validation = contactFormSchema.safeParse(data)
    if (!validation.success) {
      const firstError = validation.error.issues[0]
      return {
        success: false,
        error: firstError.message
      }
    }

    const validatedData = validation.data

    // Get current user info
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return { 
        success: false, 
        error: 'You must be logged in to contact support' 
      }
    }

    // Get user details including tenant
    const sharedClient = createSharedClient()
      const { data: userData } = await sharedClient
        .schema('shared')
        .from('users')
        .select('full_name, email, tenant_id, is_master_admin')
        .eq('id', user.id)
        .single()

    // Get tenant name
    const { data: tenantData } = await createPlatformClient()
        .schema('platform')
        .from('tenants')
      .select('name, subdomain')
      .eq('id', userData?.tenant_id)
      .single()

    const priorityLabels = {
      low: '🟢 Low',
      normal: '🟡 Normal',
      high: '🔴 High'
    }

    const categoryLabels = {
      technical: '🔧 Technical Issue',
      billing: '💳 Billing Question',
      feature: '💡 Feature Request',
      general: '💬 General Inquiry'
    }

    // Build email HTML
    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 30px;
              border-radius: 8px 8px 0 0;
              text-align: center;
            }
            .content {
              background: #ffffff;
              padding: 30px;
              border: 1px solid #e5e7eb;
              border-top: none;
            }
            .info-grid {
              display: grid;
              grid-template-columns: 120px 1fr;
              gap: 12px;
              margin: 20px 0;
              padding: 20px;
              background: #f9fafb;
              border-radius: 8px;
            }
            .label {
              font-weight: 600;
              color: #6b7280;
            }
            .value {
              color: #1f2937;
            }
            .message-box {
              background: #f3f4f6;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
              border-left: 4px solid #667eea;
            }
            .priority-high {
              background: #fef2f2;
              border-left-color: #ef4444;
            }
            .priority-normal {
              background: #fffbeb;
              border-left-color: #f59e0b;
            }
            .priority-low {
              background: #f0fdf4;
              border-left-color: #10b981;
            }
            .footer {
              background: #f9fafb;
              padding: 20px;
              border-radius: 0 0 8px 8px;
              text-align: center;
              font-size: 14px;
              color: #6b7280;
            }
            .badge {
              display: inline-block;
              padding: 4px 12px;
              border-radius: 12px;
              font-size: 12px;
              font-weight: 600;
            }
            .badge-high {
              background: #fee2e2;
              color: #991b1b;
            }
            .badge-normal {
              background: #fef3c7;
              color: #92400e;
            }
            .badge-low {
              background: #d1fae5;
              color: #065f46;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1 style="margin: 0; font-size: 24px;">BaselineDocs Support Request</h1>
          </div>
          
          <div class="content">
            <h2 style="color: #1f2937; margin-top: 0;">${validatedData.subject}</h2>
            
            <div class="info-grid">
              <div class="label">From:</div>
              <div class="value">${userData?.full_name || 'Unknown User'}</div>
              
              <div class="label">Email:</div>
              <div class="value">${userData?.email || user.email}</div>
              
              <div class="label">Organization:</div>
              <div class="value">${tenantData?.name || 'Unknown'} (${tenantData?.subdomain || 'N/A'})</div>
              
              <div class="label">Tenant ID:</div>
              <div class="value"><code>${userData?.tenant_id || 'N/A'}</code></div>
              
              <div class="label">User ID:</div>
              <div class="value"><code>${user.id}</code></div>
              
              <div class="label">Admin:</div>
              <div class="value">${userData?.is_master_admin ? 'Yes' : 'No'}</div>
              
              <div class="label">Category:</div>
              <div class="value">${categoryLabels[validatedData.category as keyof typeof categoryLabels]}</div>
              
              <div class="label">Priority:</div>
              <div class="value">
                <span class="badge badge-${validatedData.priority}">
                  ${priorityLabels[validatedData.priority as keyof typeof priorityLabels]}
                </span>
              </div>
            </div>
            
            <div class="message-box priority-${validatedData.priority}">
              <h3 style="margin-top: 0; color: #1f2937;">Message:</h3>
              <p style="white-space: pre-wrap; margin-bottom: 0;">${validatedData.message}</p>
            </div>
            
            <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
              <strong>Timestamp:</strong> ${new Date().toISOString()}<br>
              <strong>User Agent:</strong> ${typeof window !== 'undefined' ? navigator.userAgent : 'Server-side'}
            </p>
          </div>
          
          <div class="footer">
            <p style="margin: 0;">
              This message was sent from BaselineDocs Help Center<br>
              <a href="https://${tenantData?.subdomain}.baselinedocs.com" style="color: #667eea;">
                https://${tenantData?.subdomain}.baselinedocs.com
              </a>
            </p>
          </div>
        </body>
      </html>
    `

    // Log the support request
    logger.info('Sending support request email', {
      userId: user.id,
      userEmail: userData?.email || user.email,
      userName: userData?.full_name,
      tenantId: userData?.tenant_id,
      tenantName: tenantData?.name,
      tenantSubdomain: tenantData?.subdomain,
      category: validatedData.category,
      priority: validatedData.priority,
      subject: validatedData.subject,
      fromEmail: FROM_FEEDBACK_EMAIL,
      toEmail: SUPPORT_EMAIL
    })

    // Send email via Resend
    const emailResult = await resend.emails.send({
      from: FROM_FEEDBACK_EMAIL,
      to: SUPPORT_EMAIL,
      replyTo: userData?.email || user.email || undefined,
      subject: `[${tenantData?.subdomain || 'UNKNOWN'}] [${priorityLabels[validatedData.priority as keyof typeof priorityLabels]}] ${categoryLabels[validatedData.category as keyof typeof categoryLabels]} - ${validatedData.subject}`,
      html: emailHtml
    })

    if (emailResult.error) {
      logger.error('Failed to send support email', {
        userId: user.id,
        error: emailResult.error
      })
      
      return {
        success: false,
        error: 'Failed to send support request. Please try again or email us directly.'
      }
    }

    logger.info('Support email sent successfully', {
      userId: user.id,
      emailId: emailResult.data?.id,
      tenantId: userData?.tenant_id,
      tenantSubdomain: tenantData?.subdomain,
      category: validatedData.category,
      priority: validatedData.priority
    })

    return {
      success: true,
      message: 'Your support request has been sent successfully. We\'ll get back to you soon!'
    }

  } catch (error) {
    logger.error('Error in submitContactForm', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    })

    return {
      success: false,
      error: 'An unexpected error occurred. Please try again later.'
    }
  }
}
