/**
 * Helper function to sync invoices from Stripe
 * app/admin/billing/sync-invoices.ts
 */

import { stripe } from '@/lib/stripe/client'
import { createClient } from '@/lib/supabase/server'

export async function syncInvoicesFromStripe(tenantId: string, stripeCustomerId: string) {
  console.log('🔵 [Invoice Sync] Starting sync', { tenantId, stripeCustomerId })
  
  if (!stripeCustomerId) {
    console.log('⚠️ [Invoice Sync] No Stripe customer ID provided')
    return []
  }

  try {
    // Fetch invoices from Stripe
    console.log('🔵 [Invoice Sync] Fetching from Stripe...')
    const stripeInvoices = await stripe.invoices.list({
      customer: stripeCustomerId,
      limit: 12,
    })

    console.log('🟢 [Invoice Sync] Fetched from Stripe', { 
      count: stripeInvoices.data.length,
      invoiceIds: stripeInvoices.data.map(i => i.id)
    })

    if (stripeInvoices.data.length === 0) {
      console.log('⚠️ [Invoice Sync] No invoices found in Stripe')
      return []
    }

    const supabase = await createClient()

    // Backfill missing invoices into database
    console.log('🔵 [Invoice Sync] Upserting invoices to database...')
    for (const invoice of stripeInvoices.data) {
      const invoiceAny = invoice as any
      const subscriptionId = typeof invoiceAny.subscription === 'string' 
        ? invoiceAny.subscription 
        : invoiceAny.subscription?.id || null

      const invoiceData = {
        tenant_id: tenantId,
        stripe_invoice_id: invoice.id,
        invoice_number: invoice.number || null,
        stripe_subscription_id: subscriptionId,
        amount_due: (invoice.amount_due || 0) / 100,
        amount_paid: (invoice.amount_paid || 0) / 100,
        currency: invoice.currency,
        status: invoice.status === 'paid' ? 'paid' : invoice.status === 'open' ? 'pending' : 'failed',
        invoice_date: new Date((invoice.created || 0) * 1000).toISOString(),
        paid_at: invoice.status_transitions?.paid_at 
          ? new Date(invoice.status_transitions.paid_at * 1000).toISOString() 
          : null,
        hosted_invoice_url: invoice.hosted_invoice_url || null,
        invoice_pdf_url: invoice.invoice_pdf || null,
      }

      console.log('🔵 [Invoice Sync] Upserting invoice', { 
        stripe_invoice_id: invoice.id,
        status: invoiceData.status
      })

      const { error: upsertError } = await supabase.from('invoices').upsert(invoiceData, { 
        onConflict: 'stripe_invoice_id',
        ignoreDuplicates: false 
      })

      if (upsertError) {
        console.error('🔴 [Invoice Sync] Upsert failed for invoice', { 
          invoice_id: invoice.id, 
          error: upsertError 
        })
      }
    }

    console.log('🟢 [Invoice Sync] Invoices upserted to database')

    // Return fresh data from database
    console.log('🔵 [Invoice Sync] Fetching from database...')
    const { data: invoices, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('invoice_date', { ascending: false })
      .limit(12)

    console.log('🟢 [Invoice Sync] Returning invoices from database', { 
      count: invoices?.length || 0,
      error: fetchError 
    })
    
    return invoices || []
  } catch (error) {
    console.error('🔴 [Invoice Sync] Error syncing invoices from Stripe:', error)
    return []
  }
}
