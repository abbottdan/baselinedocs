'use client'

import { useState } from 'react'
import { upgradeTenantPlan } from '@/app/actions/billing'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CheckCircle, Sparkles, Crown, Building2, CreditCard, ArrowLeft, ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface UpgradePlanDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPlan: string
  tenantId: string
  paymentMethodBrand?: string | null
  paymentMethodLast4?: string | null
  paymentMethodExpMonth?: number | null
  paymentMethodExpYear?: number | null
}

type Step = 'select-plan' | 'confirm-payment'

export function UpgradePlanDialog({ 
  open, 
  onOpenChange, 
  currentPlan,
  tenantId,
  paymentMethodBrand,
  paymentMethodLast4,
  paymentMethodExpMonth,
  paymentMethodExpYear,
}: UpgradePlanDialogProps) {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('select-plan')
  const [isUpgrading, setIsUpgrading] = useState(false)
  const router = useRouter()

  const hasPaymentMethod = !!paymentMethodLast4

  const plans = [
    {
      id: 'starter',
      name: 'Starter',
      price: 29,
      icon: Sparkles,
      color: 'blue',
      features: [
        'Up to 25 users',
        'Unlimited documents',
        'Version control',
        'Email notifications',
        'Basic reporting',
        'Email support'
      ]
    },
    {
      id: 'professional',
      name: 'Professional',
      price: 99,
      icon: Crown,
      color: 'purple',
      popular: true,
      features: [
        'Up to 100 users',
        'Everything in Starter',
        'Advanced workflows',
        'Custom branding',
        'Priority support',
        'API access',
        'Advanced reporting'
      ]
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      price: 299,
      icon: Building2,
      color: 'indigo',
      features: [
        'Unlimited users',
        'Everything in Professional',
        'Dedicated support',
        'SLA guarantee',
        'Custom integrations',
        'Advanced security',
        'White-label option'
      ]
    }
  ]

  const planOrder = ['trial', 'starter', 'professional', 'enterprise']
  const currentIndex = planOrder.indexOf(currentPlan)
  const upgradablePlans = plans.filter(plan => planOrder.indexOf(plan.id) > currentIndex)
  const selectedPlanDetails = plans.find(p => p.id === selectedPlan)

  const handleSelectPlan = (planId: string) => {
    setSelectedPlan(planId)
  }

  const handleContinue = () => {
    if (!selectedPlan) return
    setStep('confirm-payment')
  }

  // Use saved card - charge directly via Stripe subscription update
  const handleUseCardOnFile = async () => {
    if (!selectedPlan) return
    setIsUpgrading(true)

    try {
      const result = await upgradeTenantPlan({ tenantId, newPlan: selectedPlan })

      if (result.success) {
        if (result.checkoutUrl) {
          // Shouldn't happen when card is on file, but handle gracefully
          window.location.href = result.checkoutUrl
          return
        }
        toast.success('Plan Upgraded!', { description: result.message })
        onOpenChange(false)
        router.refresh()
      } else {
        toast.error('Upgrade Failed', { description: result.error })
      }
    } catch (error) {
      toast.error('Upgrade Failed', { description: 'An unexpected error occurred' })
    } finally {
      setIsUpgrading(false)
    }
  }

  // Use a new card - redirect to Stripe Checkout
  const handleUseNewCard = async () => {
    if (!selectedPlan) return
    setIsUpgrading(true)

    try {
      const result = await upgradeTenantPlan({ 
        tenantId, 
        newPlan: selectedPlan,
        forceCheckout: true  // Always go to checkout for new card
      })

      if (result.success && result.checkoutUrl) {
        window.location.href = result.checkoutUrl
      } else {
        toast.error('Upgrade Failed', { description: result.error || 'Could not create checkout session' })
        setIsUpgrading(false)
      }
    } catch (error) {
      toast.error('Upgrade Failed', { description: 'An unexpected error occurred' })
      setIsUpgrading(false)
    }
  }

  const handleClose = () => {
    onOpenChange(false)
    // Reset state after dialog closes
    setTimeout(() => {
      setSelectedPlan(null)
      setStep('select-plan')
    }, 300)
  }

  const brandDisplay = paymentMethodBrand 
    ? paymentMethodBrand.charAt(0).toUpperCase() + paymentMethodBrand.slice(1)
    : 'Card'

  if (upgradablePlans.length === 0) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Already on the Best Plan!</DialogTitle>
            <DialogDescription>
              You're currently on the {currentPlan} plan. There are no higher plans available.
            </DialogDescription>
          </DialogHeader>
          <div className="py-8 text-center">
            <Crown className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
            <p className="text-gray-600">You're already enjoying all the features we offer!</p>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleClose}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>

      {/* ── STEP 1: Select Plan ── */}
      {step === 'select-plan' && (
        <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upgrade Your Plan</DialogTitle>
            <DialogDescription>
              Choose a plan that fits your needs. Upgrade takes effect immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-6">
            {upgradablePlans.map((plan) => {
              const Icon = plan.icon
              const isSelected = selectedPlan === plan.id

              return (
                <div
                  key={plan.id}
                  onClick={() => handleSelectPlan(plan.id)}
                  className={`relative cursor-pointer rounded-xl border-2 p-6 transition-all hover:shadow-lg ${
                    isSelected
                      ? 'border-blue-600 shadow-md'
                      : 'border-gray-200 hover:border-gray-300'
                  } ${plan.popular ? 'ring-2 ring-blue-400 ring-offset-2' : ''}`}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                        MOST POPULAR
                      </span>
                    </div>
                  )}

                  <div className="text-center mb-6">
                    <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full bg-${plan.color}-100 mb-3`}>
                      <Icon className={`h-6 w-6 text-${plan.color}-600`} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">{plan.name}</h3>
                    <div className="mt-3">
                      <span className="text-4xl font-bold text-gray-900">${plan.price}</span>
                      <span className="text-gray-600">/month</span>
                    </div>
                  </div>

                  <ul className="space-y-3 mb-6">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm">
                        <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-700">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    className="w-full"
                    variant={isSelected ? 'default' : 'outline'}
                    onClick={(e) => { e.stopPropagation(); handleSelectPlan(plan.id) }}
                  >
                    {isSelected ? '✓ Selected' : 'Select Plan'}
                  </Button>
                </div>
              )
            })}
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
            <Button onClick={handleContinue} disabled={!selectedPlan}>
              Continue →
            </Button>
          </div>
        </DialogContent>
      )}

      {/* ── STEP 2: Confirm Payment ── */}
      {step === 'confirm-payment' && selectedPlanDetails && (
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Confirm Upgrade</DialogTitle>
            <DialogDescription>
              Upgrading to <strong>{selectedPlanDetails.name}</strong> — ${selectedPlanDetails.price}/month
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">

            {/* Order Summary */}
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <selectedPlanDetails.icon className="h-5 w-5 text-blue-600" />
                  <div>
                    <p className="font-semibold text-gray-900">{selectedPlanDetails.name} Plan</p>
                    <p className="text-sm text-gray-500">Billed monthly</p>
                  </div>
                </div>
                <p className="text-xl font-bold text-gray-900">${selectedPlanDetails.price}<span className="text-sm font-normal text-gray-500">/mo</span></p>
              </div>
              <p className="text-xs text-gray-500 mt-3 border-t border-gray-200 pt-3">
                Upgrade takes effect immediately. You'll be charged a prorated amount for the remainder of this billing cycle.
              </p>
            </div>

            {/* Payment Options */}
            {hasPaymentMethod ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-700">Payment method</p>

                {/* Card on file option */}
                <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-white rounded p-1.5 shadow-sm">
                        <CreditCard className="h-5 w-5 text-gray-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">
                          {brandDisplay} •••• {paymentMethodLast4}
                        </p>
                        {paymentMethodExpMonth && paymentMethodExpYear && (
                          <p className="text-sm text-gray-500">
                            Expires {paymentMethodExpMonth}/{paymentMethodExpYear}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="text-xs font-medium text-blue-700 bg-blue-100 px-2 py-1 rounded-full">
                      Card on file
                    </span>
                  </div>
                </div>

                {/* Use card on file button */}
                <Button
                  className="w-full"
                  onClick={handleUseCardOnFile}
                  disabled={isUpgrading}
                >
                  {isUpgrading ? 'Processing...' : `Charge ${brandDisplay} •••• ${paymentMethodLast4}`}
                </Button>

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-gray-400">or</span>
                  </div>
                </div>

                {/* Use a different card */}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleUseNewCard}
                  disabled={isUpgrading}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Use a different card
                </Button>
              </div>
            ) : (
              /* No payment method saved — go straight to Stripe Checkout */
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  You'll be redirected to our secure payment page to enter your card details.
                </p>
                <Button
                  className="w-full"
                  onClick={handleUseNewCard}
                  disabled={isUpgrading}
                >
                  {isUpgrading ? 'Redirecting...' : 'Continue to Payment →'}
                </Button>
              </div>
            )}
          </div>

          {/* Back button */}
          <div className="flex justify-start border-t pt-4">
            <Button
              variant="ghost"
              onClick={() => setStep('select-plan')}
              disabled={isUpgrading}
              className="text-gray-500"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to plans
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
