'use client'

import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChevronDown, ChevronUp, History } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type { DocumentVersionsData } from '@/lib/document-helpers'
import { cn } from '@/lib/utils'
import dynamic from 'next/dynamic'
import ReleaseDocumentButton from './components/ReleaseDocumentButton'
import SubmitForApprovalButton from './components/SubmitForApprovalButton'
import DeleteDocumentButton from './components/DeleteDocumentButton'
import CreateNewVersionButton from './components/CreateNewVersionButton'
import PromoteToProductionButton from './components/PromoteToProductionButton'
import { useRouter, useSearchParams } from 'next/navigation'
import { ConfirmDialog } from '@/components/ConfirmDialog'

// Dynamically import components
const ApprovalWorkflow = dynamic(() => import('./components/ApprovalWorkflow'), { ssr: false })
const AuditTrail = dynamic(() => import('./components/AuditTrailClient'), { ssr: false })
const AdminActions = dynamic(() => import('./components/AdminActions'), { ssr: false })

interface DocumentActionsPanelProps {
  documentData: DocumentVersionsData
  auditLogs: any[]
  isAdmin: boolean
  currentUserId: string
  currentUserEmail: string
}

interface CollapsibleSectionProps {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  sectionKey: string
}

const STATUS_COLORS: Record<string, string> = {
  'Draft': 'bg-gray-500',
  'In Approval': 'bg-yellow-500',
  'Released': 'bg-green-500',
  'Obsolete': 'bg-gray-700',
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function CollapsibleSection({ title, children, defaultOpen = false, sectionKey }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const toggle = useCallback(() => {
    setIsOpen(prev => !prev)
  }, [])

  return (
    <Card key={sectionKey}>
      <button
        onClick={toggle}
        className="w-full text-left"
        type="button"
      >
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {isOpen ? (
            <ChevronUp className="h-4 w-4 text-gray-500" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-500" />
          )}
        </CardHeader>
      </button>
      {isOpen && mounted && (
        <CardContent className="pt-0">
          {children}
        </CardContent>
      )}
    </Card>
  )
}

export default function DocumentActionsPanel({
  documentData,
  auditLogs,
  isAdmin,
  currentUserId,
  currentUserEmail
}: DocumentActionsPanelProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const explicitTab = searchParams.get('tab') as 'released' | 'wip' | null
  
  const [mounted, setMounted] = useState(false)
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const { latestReleased, wipVersions, allVersions, documentNumber } = documentData

  // Use latest released for primary actions, or first WIP if no released version
  const primaryDocument = latestReleased || wipVersions[0]
  
  if (!primaryDocument) {
    return <div className="p-6 text-center text-gray-500">No document data available</div>
  }

  // Smart default: Show WIP tab if there's a draft and no explicit tab selected
  const hasDraft = wipVersions.length > 0
  const activeTab = explicitTab || (hasDraft ? 'wip' : 'released')
  
  const isCreator = primaryDocument.created_by === currentUserId
  const approvers = primaryDocument.approvers || []
  const hasApprovers = approvers.length > 0
  
  // Check if there's a draft version (WIP)
  const draftDocument = wipVersions[0]
  
  // Determine which buttons to show based on active tab
  const showingReleasedTab = activeTab === 'released'
  const showingWIPTab = activeTab === 'wip'
  
  // Determine button visibility
  const canEdit = (isCreator || isAdmin) && primaryDocument.status === 'Draft'
  const canDelete = (isCreator || isAdmin) && primaryDocument.status === 'Draft'
  
  // Release/Submit buttons - only show if there's a draft
  const canRelease = 
    (isCreator || isAdmin) && 
    hasDraft &&
    draftDocument.status === 'Draft' && 
    !draftDocument.is_production &&
    !hasApprovers

  const canSubmitForApproval = 
    (isCreator || isAdmin) && 
    hasDraft &&
    draftDocument.status === 'Draft' && 
    hasApprovers

  // Create New Version - only if no draft exists
  const canCreateNewVersion = 
    (isCreator || isAdmin) && 
    latestReleased && 
    latestReleased.status === 'Released' &&
    !hasDraft

  const canPromoteToProduction = 
    (isCreator || isAdmin) && 
    latestReleased &&
    latestReleased.status === 'Released' && 
    !latestReleased.is_production

  const userIsApprover = approvers.some((a: any) => a.user_email === currentUserEmail)
  const userPendingApproval = approvers.some(
    (a: any) => a.user_email === currentUserEmail && a.status === 'Pending'
  )

  return (
    <div className="p-6 space-y-4">
      {/* Primary Actions */}
      <CollapsibleSection title="Primary Actions" defaultOpen={true} sectionKey="primary">
        <div className="grid grid-cols-2 gap-2">
          {/* RELEASED TAB: Show Released version actions */}
          {showingReleasedTab && latestReleased && (isCreator || isAdmin) && (
            <>
              {/* New Version Button */}
              <CreateNewVersionButton
                documentId={latestReleased.id}
                documentNumber={latestReleased.document_number}
                version={latestReleased.version}
                isProduction={latestReleased.is_production}
              />
              
              {/* Promote to Production - Only for Prototype */}
              {!latestReleased.is_production && (
                <PromoteToProductionButton
                  documentId={latestReleased.id}
                  documentNumber={latestReleased.document_number}
                  version={latestReleased.version}
                  hasDraft={hasDraft}
                  draftId={draftDocument?.id}
                />
              )}
            </>
          )}

          {/* WIP TAB: Show draft actions if draft exists */}
          {showingWIPTab && hasDraft && draftDocument && (isCreator || isAdmin) && (
            <>
              {/* If In Approval - show Withdraw button */}
              {draftDocument.status === 'In Approval' && (
                <>
                  <Button
                    variant="outline"
                    className="border-orange-200 text-orange-700 hover:bg-orange-50 col-span-2"
                    onClick={() => setShowWithdrawConfirm(true)}
                  >
                    Withdraw from Approval
                  </Button>
                  <ConfirmDialog
                    open={showWithdrawConfirm}
                    onOpenChange={setShowWithdrawConfirm}
                    title="Withdraw from Approval?"
                    description="This document will return to Draft status and you can make changes before resubmitting."
                    confirmText="Withdraw"
                    variant="default"
                    onConfirm={async () => {
                      const { withdrawFromApproval } = await import('@/app/actions/approvals')
                      const { toast } = await import('sonner')
                      const result = await withdrawFromApproval(draftDocument.id)
                      if (result.success) {
                        toast.success('Document withdrawn from approval')
                        router.refresh()
                      } else {
                        toast.error(result.error || 'Failed to withdraw document')
                      }
                    }}
                  />
                </>
              )}
              
              {/* If Draft - show Release/Submit and Delete buttons */}
              {draftDocument.status === 'Draft' && (
                <>
              {/* Release / Submit for Approval */}
              {draftDocument.is_production ? (
                // Production documents always need approval
                (draftDocument.approvers?.length ?? 0) > 0 ? (
                  <SubmitForApprovalButton 
                    documentId={draftDocument.id}
                    documentNumber={draftDocument.document_number}
                    approverCount={draftDocument.approvers?.length ?? 0}
                    fileCount={draftDocument.document_files?.length ?? 0}
                  />
                ) : (
                  <Button
                    disabled
                    variant="outline"
                    className="opacity-50 cursor-not-allowed"
                    title="Production documents require at least one approver. Assign approvers in the Work In Progress tab."
                  >
                    Send for Approval
                  </Button>
                )
              ) : (
                // Prototype documents - Release or Submit
                (draftDocument.approvers?.length ?? 0) > 0 ? (
                  <SubmitForApprovalButton 
                    documentId={draftDocument.id}
                    documentNumber={draftDocument.document_number}
                    approverCount={draftDocument.approvers?.length ?? 0}
                    fileCount={draftDocument.document_files?.length ?? 0}
                  />
                ) : (
                  <ReleaseDocumentButton 
                    documentId={draftDocument.id} 
                    isProduction={draftDocument.is_production}
                    documentNumber={`${draftDocument.document_number}${draftDocument.version}`}
                    fileCount={draftDocument.document_files?.length ?? 0}
                  />
                )
              )}

              {/* Delete Draft */}
              <DeleteDocumentButton documentId={draftDocument.id} />
                </>
              )}
            </>
          )}

          {/* WIP TAB: Show New Version if no draft */}
          {showingWIPTab && !hasDraft && latestReleased && (isCreator || isAdmin) && (
            <CreateNewVersionButton
              documentId={latestReleased.id}
              documentNumber={latestReleased.document_number}
              version={latestReleased.version}
              isProduction={latestReleased.is_production}
            />
          )}

          {/* No actions available */}
          {(showingReleasedTab && !latestReleased) || (showingWIPTab && !hasDraft && !latestReleased) ? (
            <p className="text-sm text-gray-500 text-center py-4 col-span-2">
              No actions available
            </p>
          ) : null}
        </div>
      </CollapsibleSection>

      {/* Version History */}
      <CollapsibleSection title="Version History" defaultOpen={true} sectionKey="version-history">
        <div className="space-y-2">
          {allVersions.map((version) => (
            <div
              key={version.id}
              className={cn(
                "p-3 rounded-lg border transition-colors",
                version.status === 'Released' ? "bg-green-50 border-green-200" :
                version.status === 'Obsolete' ? "bg-gray-50 border-gray-200" :
                version.status === 'Draft' ? "bg-gray-50 border-gray-300" :
                "bg-yellow-50 border-yellow-200"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">
                      {version.version}
                    </span>
                    <Badge className={cn("text-xs", STATUS_COLORS[version.status])}>
                      {version.status}
                    </Badge>
                    {version.is_production && (
                      <Badge variant="outline" className="text-xs">Production</Badge>
                    )}
                  </div>
                  {version.released_at && (
                    <p className="text-xs text-gray-600" suppressHydrationWarning>
                      Released {formatDate(version.released_at)}
                    </p>
                  )}
                </div>

                {/* Link to obsolete versions */}
                {version.status === 'Obsolete' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    asChild
                    className="text-xs"
                  >
                    <Link href={`/document-version/${documentNumber}/${version.version}`}>
                      View
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Approval Workflow (if has approvers) */}
      {hasApprovers && primaryDocument.status === 'In Approval' && (
        <CollapsibleSection title="Approval Workflow" defaultOpen={true} sectionKey="approval">
          <ApprovalWorkflow
            documentId={primaryDocument.id}
            documentNumber={primaryDocument.document_number}
            documentStatus={primaryDocument.status}
            approvers={approvers}
            currentUserId={currentUserId}
            currentUserEmail={currentUserEmail}
          />
        </CollapsibleSection>
      )}

      {/* Audit Trail */}
      <CollapsibleSection title="Audit Trail" defaultOpen={false} sectionKey="audit">
        <AuditTrail auditLogs={auditLogs} documentNumber={documentNumber} />
      </CollapsibleSection>

      {/* Admin Actions */}
      {isAdmin && (
        <CollapsibleSection title="Admin Actions" defaultOpen={false} sectionKey="admin">
          <AdminActions
            documentId={primaryDocument.id}
            documentNumber={primaryDocument.document_number}
            currentStatus={primaryDocument.status}
            currentVersion={primaryDocument.version}
            isProduction={primaryDocument.is_production}
          />
        </CollapsibleSection>
      )}
    </div>
  )
}
