/**
 * Test endpoint to simulate billing cycle
 * app/api/admin/test-billing-cycle/route.ts
 * 
 * ADMIN ONLY - Use to test:
 * - Invoice creation
 * - Payment processing
 * - Email notifications
 * - Database updates
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createSharedClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createPlatformClient } from '@/lib/supabase/platform'
import { stripe } from '@/lib/stripe/client'

export async function GET() {
  return NextResponse.json({ 
    message: 'Test billing cycle endpoint is working',
    method: 'GET',
    expectedMethod: 'POST'
  })
}

export async function POST(request: NextRequest) {
  console.log('🟢 [Test Billing Endpoint] POST handler called')
  console.log('🟢 [Test Billing Endpoint] URL:', request.url)
  console.log('🟢 [Test Billing Endpoint] Method:', request.method)
  
  try {
    const supabase = await createClient()
    
    // Verify admin access
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: userData } = await createSharedClient()
        .schema('shared')
        .from('users')
        .select('is_master_admin, tenant_id')
        .eq('id', user.id)
        .single()

    if (!userData?.is_master_admin) {
      return NextResponse.json({ error: 'Master admin access required' }, { status: 403 })
    }

    // Get tenant from query params or body
    const body = await request.json()
    const tenantSubdomain = body.subdomain

    if (!tenantSubdomain) {
      return NextResponse.json({ error: 'Subdomain required' }, { status: 400 })
    }

    // Get tenant
    const { data: tenant } = await createPlatformClient()
        .schema('platform')
        .from('tenants')
      .select('id, subdomain, company_name')
      .eq('subdomain', tenantSubdomain)
      .single()

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }

    // Get billing info
    const { data: billing } = await createPlatformClient()
        .schema('platform')
        .from('product_subscriptions')
      .select('*')
      .eq('tenant_id', tenant.id)
      .single()

    if (!billing?.stripe_subscription_id) {
      return NextResponse.json({ 
        error: 'No active subscription found' 
      }, { status: 400 })
    }

    console.log('[Test Billing] Starting test cycle for:', tenant.subdomain)

    // Get subscription to calculate amount
    const subscription = await stripe.subscriptions.retrieve(billing.stripe_subscription_id) as any
    const priceAmount = subscription.items?.data?.[0]?.price?.unit_amount || 0
    const amount = priceAmount / 100
    const billingDate = new Date(subscription.current_period_end * 1000)

    console.log('[Test Billing] Current plan:', billing.plan, 'Amount:', amount)

    // Step 1: Send reminder email (simulating 5-day advance notice)
    // Use service role client to bypass RLS
    const supabaseAdmin = createServiceRoleClient()
    
    // First try to find admin by is_admin flag
    const { data: adminUsers } = await supabaseAdmin
      .schema('shared')
      .from('users')
      .select('email, is_master_admin')
      .eq('tenant_id', tenant.id)
      .eq('is_master_admin', true)
      .limit(1)

    // Fallback: find by role='Admin'
    const { data: adminByRole } = !adminUsers?.length ? await createSharedClient()
        .schema('shared')
        .from('users')
        .select('email')
        .eq('tenant_id', tenant.id)
        .eq('is_master_admin', false)
        .eq('is_active', true)
        .limit(1) : { data: null }

    const adminUser = adminUsers?.[0] || adminByRole?.[0]

    console.log('[Test Billing] Admin user lookup:', { 
      found: !!adminUser, 
      email: adminUser?.email,
      tenant_id: tenant.id,
      adminUsersCount: adminUsers?.length || 0,
      adminByRoleCount: adminByRole?.length || 0
    })

    if (adminUser?.email) {
      try {
        console.log('[Test Billing] Attempting to send email to:', adminUser.email)

        const { sendPaymentReminderEmail } = await import('@/lib/billing-emails')
        
        const result = await sendPaymentReminderEmail({
          toEmail: adminUser.email,
          companyName: tenant.company_name || tenant.subdomain,
          plan: billing.plan,
          amount: amount,
          billingDate: billingDate.toLocaleDateString('en-US', { 
            year: 'numeric', month: 'long', day: 'numeric' 
          }),
          invoiceUrl: null
        })

        console.log('[Test Billing] Reminder email sent successfully:', result)
      } catch (emailError: any) {
        console.error('[Test Billing] Failed to send reminder email:', {
          error: emailError.message,
          stack: emailError.stack
        })
      }
    } else {
      console.log('[Test Billing] No admin user found for tenant', tenant.id)
    }

    // Step 2: Create and finalize a new invoice (this triggers actual payment)
    const newInvoice = await stripe.invoices.create({
      customer: billing.stripe_customer_id,
      subscription: billing.stripe_subscription_id,
      auto_advance: true, // Automatically attempt payment after finalization
    })
    
    console.log('[Test Billing] Invoice created:', newInvoice.id)
    
    const finalizedInvoice = await stripe.invoices.finalizeInvoice(newInvoice.id)

    console.log('[Test Billing] Invoice finalized:', finalizedInvoice.id)

    // Wait a moment for payment to process
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Step 5: Retrieve the paid invoice
    const paidInvoice = await stripe.invoices.retrieve(finalizedInvoice.id)

    console.log('[Test Billing] Invoice status:', paidInvoice.status)

    // The webhook should handle updating the invoice to "paid" status
    // and sending the payment confirmation email

    return NextResponse.json({
      success: true,
      message: 'Test billing cycle completed',
      tenant: tenant.subdomain,
      steps: {
        subscriptionAmount: amount,
        reminderEmailSent: !!adminUser?.email,
        newInvoiceCreated: newInvoice.id,
        invoiceFinalized: finalizedInvoice.id,
        invoiceStatus: paidInvoice.status,
        webhookNote: 'Webhook should update invoice to paid and send confirmation email'
      },
      nextSteps: [
        '1. Check your email for the reminder (with [TEST] prefix)',
        '2. Check Stripe dashboard for the finalized invoice',
        '3. Wait a moment for webhook to fire',
        '4. Check email for payment confirmation',
        '5. Refresh billing page to see updated invoice'
      ]
    })

  } catch (error: any) {
    console.error('[Test Billing] Error:', error)
    return NextResponse.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 })
  }
}

