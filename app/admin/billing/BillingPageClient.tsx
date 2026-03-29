'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  CreditCard,
  Calendar,
  TrendingUp,
  Users,
  Mail,
  FileText,
  HardDrive,
  ArrowUpCircle,
  CheckCircle,
  ExternalLink
} from 'lucide-react'
import { UpgradePlanDialog } from './UpgradePlanDialog'

interface BillingPageClientProps {
  tenant: any
  billing: any
  invoices: any[]
  usage: {
    emailsSent: number
    storageGB: string
    userCount: number
    documentCount: number
  }
}

export default function BillingPageClient({
  tenant,
  billing,
  invoices,
  usage
}: BillingPageClientProps) {
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false)

  // Plan pricing
  const planPrices: Record<string, number> = {
    trial: 0,
    starter: 29,
    professional: 99,
    enterprise: 299
  }

  const currentPlan = billing?.plan || 'trial'

  // Derive storage limit — use billing column if set, else plan default
  const PLAN_STORAGE_GB: Record<string, number> = {
    trial: 1, starter: 5, professional: 25, enterprise: 100,
  }
  const storageLimitGB: number =
    billing?.storage_limit_gb != null
      ? Number(billing.storage_limit_gb)
      : (PLAN_STORAGE_GB[currentPlan] ?? 1)
  const currentPrice = planPrices[currentPlan]

  // Format helpers
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Not set'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount)
  }

  // Status badge
  const getStatusBadge = (status: string) => {
    const styles: Record<string, { bg: string; text: string }> = {
      trial: { bg: 'bg-blue-100', text: 'text-blue-800' },
      active: { bg: 'bg-green-100', text: 'text-green-800' },
      past_due: { bg: 'bg-red-100', text: 'text-red-800' },
      cancelled: { bg: 'bg-gray-100', text: 'text-gray-800' }
    }
    const style = styles[status] || styles.trial
    return (
      <Badge className={`${style.bg} ${style.text}`}>
        {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
      </Badge>
    )
  }

  // Plan features
  const planFeatures: Record<string, string[]> = {
    trial: [
      '14-day trial',
      'Up to 5 users',
      'Basic document control',
      'Email support'
    ],
    starter: [
      'Up to 25 users',
      'Unlimited documents',
      'Version control',
      'Email notifications',
      'Basic reporting',
      'Email support'
    ],
    professional: [
      'Up to 100 users',
      'Everything in Starter',
      'Advanced workflows',
      'Custom branding',
      'Priority support',
      'API access'
    ],
    enterprise: [
      'Unlimited users',
      'Everything in Professional',
      'Dedicated support',
      'SLA guarantee',
      'Custom integrations',
      'Advanced security'
    ]
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Billing & Subscription</h1>
        <p className="mt-2 text-gray-600">
          Manage your subscription, view usage, and upgrade your plan
        </p>
      </div>

      {/* Current Plan Card */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle>Current Plan</CardTitle>
            <CardDescription>Your active subscription</CardDescription>
          </div>
          <Button onClick={() => setShowUpgradeDialog(true)} size="sm">
            <ArrowUpCircle className="h-4 w-4 mr-2" />
            Upgrade Plan
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Plan Details */}
            <div>
              <div className="text-sm text-gray-600 mb-2">Subscription</div>
              <div className="text-3xl font-bold text-gray-900 capitalize mb-2">
                {currentPlan}
              </div>
              <div className="text-2xl font-semibold text-gray-700 mb-3">
                {formatCurrency(currentPrice)}
                <span className="text-sm font-normal text-gray-500">/month</span>
              </div>
              {getStatusBadge(billing?.status || 'trial')}
            </div>

            {/* Billing Info */}
            <div>
              <div className="text-sm text-gray-600 mb-2">Billing Cycle</div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-900">
                    {billing?.billing_cycle || 'Monthly'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-900">
                    Next billing: {formatDate(billing?.current_period_end)}
                  </span>
                </div>
                {billing?.trial_ends_at && (
                  <div className="flex items-center gap-2 text-amber-600">
                    <Calendar className="h-4 w-4" />
                    <span>Trial ends: {formatDate(billing?.trial_ends_at)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Plan Features */}
            <div>
              <div className="text-sm text-gray-600 mb-2">Included Features</div>
              <ul className="space-y-1">
                {planFeatures[currentPlan]?.slice(0, 4).map((feature, idx) => (
                  <li key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                    <CheckCircle className="h-3 w-3 text-green-600" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Usage & Invoice History */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Current Usage */}
        <Card>
          <CardHeader>
            <CardTitle>Usage This Month</CardTitle>
            <CardDescription>Last 30 days of activity</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Users className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900">Users</div>
                    <div className="text-xs text-gray-500">Active accounts</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-gray-900">
                    {usage.userCount} / {billing?.user_limit ?? '∞'}
                  </div>
                  {billing?.user_limit && (
                    <div className="text-xs text-gray-500">
                      {Math.round((usage.userCount / billing.user_limit) * 100)}% used
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <FileText className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900">Documents</div>
                    <div className="text-xs text-gray-500">Total in system</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-gray-900">
                    {usage.documentCount} / {billing?.document_limit ?? '∞'}
                  </div>
                  {billing?.document_limit && (
                    <div className="text-xs text-gray-500">
                      {Math.round((usage.documentCount / billing.document_limit) * 100)}% used
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-100 rounded-lg">
                    <Mail className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900">Emails Sent</div>
                    <div className="text-xs text-gray-500">Notifications delivered</div>
                  </div>
                </div>
                <div className="text-2xl font-bold text-gray-900">{usage.emailsSent}</div>
              </div>

              {/* Storage Section - Fixed Layout */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-100 rounded-lg">
                      <HardDrive className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-900">Storage</div>
                      <div className="text-xs text-gray-500">Total used</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-gray-900">
                      {usage.storageGB} / {storageLimitGB} GB
                    </div>
                    <div className="text-xs text-gray-500">
                        {((parseFloat(usage.storageGB) / storageLimitGB) * 100).toFixed(0)}% used
                      </div>
                  </div>
                </div>

                {/* Storage Progress Bar - Full Width Below */}
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        parseFloat(usage.storageGB) >= storageLimitGB
                          ? 'bg-red-500'
                          : parseFloat(usage.storageGB) / storageLimitGB >= 0.9
                            ? 'bg-amber-500'
                            : 'bg-green-500'
                      }`}
                      style={{
                        width: `${Math.min((parseFloat(usage.storageGB) / storageLimitGB) * 100, 100)}%`
                      }}
                    />
                  </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Invoice History */}
        <Card>
          <CardHeader>
            <CardTitle>Invoice History</CardTitle>
            <CardDescription>
              Account created {formatDate(tenant.created_at)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {invoices.length > 0 ? (
              <div className="space-y-3">
                {invoices.slice(0, 5).map((invoice) => (
                  <div key={invoice.id} className="flex items-center justify-between py-2 border-b last:border-b-0">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {invoice.invoice_number || invoice.stripe_invoice_id}
                      </div>
                      <div className="text-xs text-gray-500">
                        {formatDate(invoice.invoice_date)} · {formatCurrency(invoice.amount_paid || invoice.amount_due)}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge
                        className={
                          invoice.status === 'paid'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }
                      >
                        {invoice.status}
                      </Badge>
                      {invoice.hosted_invoice_url && (
                        <a
                          href={invoice.hosted_invoice_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 text-sm"
                        >
                          View
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
                {invoices.length > 5 && (
                  <div className="text-center pt-2">
                    <span className="text-sm text-gray-500">
                      {invoices.length - 5} more invoice{invoices.length - 5 !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                No invoices yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payment Method */}
      {billing?.payment_method_last4 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Payment Method</CardTitle>
            <CardDescription>Your default payment method</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gray-100 rounded-lg">
                  <CreditCard className="h-6 w-6 text-gray-600" />
                </div>
                <div>
                  <div className="font-medium text-gray-900 capitalize">
                    {billing?.payment_method_brand} •••• {billing?.payment_method_last4}
                  </div>
                  {billing.payment_method_exp_month && billing.payment_method_exp_year && (
                    <div className="text-sm text-gray-500">
                      Expires {billing.payment_method_exp_month}/{billing.payment_method_exp_year}
                    </div>
                  )}
                </div>
              </div>
              <Button variant="outline" size="sm">
                Update Payment
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upgrade Dialog */}
      <UpgradePlanDialog
        open={showUpgradeDialog}
        onOpenChange={setShowUpgradeDialog}
        currentPlan={currentPlan}
        tenantId={tenant.id}
        paymentMethodBrand={billing?.payment_method_brand}
        paymentMethodLast4={billing?.payment_method_last4}

      />
    </>
  )
}
