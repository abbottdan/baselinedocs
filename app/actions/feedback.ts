'use server'

import { Resend } from 'resend'
import { createClient , createSharedClient} from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

// Initialize Resend directly here
const resend = new Resend(process.env.RESEND_API_KEY)
const FEEDBACK_EMAIL = process.env.FEEDBACK_EMAIL || 'abbott.dan@gmail.com'
const FROM_FEEDBACK_EMAIL = process.env.FROM_FEEDBACK_EMAIL || 'feedback@baselinedocs.com'

export type FeedbackType = 'bug' | 'feature' | 'general'

export interface FeedbackData {
  type: FeedbackType
  description: string
  url?: string
  userAgent?: string
}

export async function submitFeedback(data: FeedbackData) {
  try {
    // Get current user info
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return { 
        success: false, 
        error: 'You must be logged in to submit feedback' 
      }
    }

    // Get user details
    const sharedClient = createSharedClient()
      const { data: userData } = await sharedClient
        .schema('shared')
        .from('users')
        .select('full_name, email, tenant_id, is_master_admin')
        .eq('id', user.id)
        .single()

    // Format feedback type for display
    const typeLabels = {
      bug: '🐛 Bug Report',
      feature: '💡 Feature Request',
      general: '💬 General Feedback'
    }

    const typeLabel = typeLabels[data.type] || data.type

    // Log the feedback submission attempt
    logger.info('Attempting to send feedback email', {
      userId: user.id,
      userEmail: userData?.email || user.email,
      userName: userData?.full_name,
      type: data.type,
      description: data.description,
      url: data.url,
      userAgent: data.userAgent,
      fromEmail: FROM_FEEDBACK_EMAIL,
      toEmail: FEEDBACK_EMAIL,
      hasApiKey: !!process.env.RESEND_API_KEY,
      apiKeyLength: process.env.RESEND_API_KEY?.length || 0,
    })

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
              margin-bottom: 0;
            }
            .header h1 {
              margin: 0;
              font-size: 24px;
            }
            .content {
              background: #f8f9fa;
              padding: 30px;
              border-radius: 0 0 8px 8px;
            }
            .info-box {
              background: white;
              padding: 20px;
              border-radius: 6px;
              margin-bottom: 20px;
              border-left: 4px solid #667eea;
            }
            .info-row {
              margin: 8px 0;
            }
            .label {
              font-weight: 600;
              color: #555;
              display: inline-block;
              min-width: 120px;
            }
            .feedback-text {
              background: white;
              padding: 20px;
              border-radius: 6px;
              border-left: 4px solid #764ba2;
              white-space: pre-wrap;
              font-size: 15px;
              line-height: 1.6;
            }
            .metadata {
              margin-top: 20px;
              padding-top: 20px;
              border-top: 1px solid #dee2e6;
              font-size: 13px;
              color: #6c757d;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${typeLabel}</h1>
          </div>
          <div class="content">
            <div class="info-box">
              <div class="info-row">
                <span class="label">From:</span>
                <span>${userData?.full_name || 'Unknown User'}</span>
              </div>
              <div class="info-row">
                <span class="label">Email:</span>
                <span>${userData?.email || user.email}</span>
              </div>
              <div class="info-row">
                <span class="label">User ID:</span>
                <span>${user.id}</span>
              </div>
              <div class="info-row">
                <span class="label">Admin:</span>
                <span>${userData?.is_master_admin ? 'Yes' : 'No'}</span>
              </div>
              <div class="info-row">
                <span class="label">Tenant ID:</span>
                <span>${userData?.tenant_id || 'N/A'}</span>
              </div>
              ${data.url ? `
              <div class="info-row">
                <span class="label">Page:</span>
                <span>${data.url}</span>
              </div>
              ` : ''}
            </div>

            <div class="feedback-text">
              ${escapeHtml(data.description)}
            </div>

            ${data.userAgent ? `
            <div class="metadata">
              <strong>Browser:</strong> ${escapeHtml(data.userAgent)}
            </div>
            ` : ''}
            
            <div class="metadata">
              <strong>Submitted:</strong> ${new Date().toLocaleString('en-US', { 
                dateStyle: 'full', 
                timeStyle: 'long' 
              })}
            </div>
          </div>
        </body>
      </html>
    `

    // Send email via Resend
    try {
      const emailResult = await resend.emails.send({
        from: FROM_FEEDBACK_EMAIL,
        to: FEEDBACK_EMAIL,
        subject: `${typeLabel} - ${userData?.full_name || 'User'}`,
        html: emailHtml,
        replyTo: userData?.email || user.email,
      })

      logger.info('Resend API response', { 
        success: !emailResult.error,
        error: emailResult.error,
        data: emailResult.data,
        emailId: emailResult.data?.id,
      })

      if (emailResult.error) {
        logger.error('Failed to send feedback email', { 
          error: emailResult.error,
          errorMessage: JSON.stringify(emailResult.error),
          userId: user.id 
        })
        
        return { 
          success: false, 
          error: 'Failed to send feedback. Please try again.' 
        }
      }

      logger.info('Feedback email sent successfully', {
        userId: user.id,
        type: data.type,
        emailId: emailResult.data?.id,
      })

      return { 
        success: true,
        message: 'Thank you for your feedback! We\'ll review it soon.'
      }

    } catch (emailError) {
      logger.error('Exception sending email', { 
        error: emailError,
        errorMessage: emailError instanceof Error ? emailError.message : String(emailError),
        userId: user.id 
      })
      
      return { 
        success: false, 
        error: 'Failed to send feedback email. Please try again.' 
      }
    }

  } catch (error) {
    logger.error('Error submitting feedback', { 
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    
    return { 
      success: false, 
      error: 'An unexpected error occurred. Please try again.' 
    }
  }
}

// Helper function to escape HTML
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}
