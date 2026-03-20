'use client'

import { useState, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FileText, Download, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DocumentVersionsData } from '@/lib/document-helpers'
import type { BaselineReqsLinksResult } from '@/lib/integrations/baselinereqs'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import BookmarkButton from './components/BookmarkButton'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import BaselineReqsBadge from './components/BaselineReqsBadge'

const ApproverManagement = dynamic(() => import('./components/ApproverManagement'), { ssr: false })

interface DocumentDetailPanelProps {
  documentData: DocumentVersionsData
  selectedVersion?: string
  availableUsers: any[]
  isAdmin: boolean
  currentUserId: string
  currentUserEmail: string
  baselineReqsRefs: BaselineReqsLinksResult | null
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

function VersionCard({ version, isCreator, isAdmin, currentUserId, currentUserEmail, availableUsers, isCollapsible = false }: any) {
  const [isExpanded, setIsExpanded] = useState(!isCollapsible)
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false)
  const router = useRouter()
  const files = version.document_files || []
  const approvers = version.approvers || []

  const cardContent = (
    <>
      {/* Version Header (for collapsible WIP cards) */}
      {isCollapsible && (
        <div 
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">Version {version.version}</span>
            <Badge className={STATUS_COLORS[version.status]}>{version.status}</Badge>
          </div>
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      )}

      {/* Content (shown when expanded) */}
      {isExpanded && (
        <div className="space-y-4 mt-4">
          {/* Document Information */}
          {version.description && (
            <div className="pb-4 border-b">
              <p className="text-sm text-gray-700">{version.description}</p>
            </div>
          )}
          
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-0.5">Document Type</p>
                <p className="text-sm text-gray-900">{version.document_type?.name || 'Unknown'}</p>
              </div>
              
              <div>
                <p className="text-xs font-medium text-gray-500 mb-0.5">Project Code</p>
                <p className="text-sm font-mono text-gray-900">{version.project_code || <span className="text-gray-400 italic">None</span>}</p>
              </div>
              
              {approvers.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-0.5">Approvers</p>
                  <p className="text-sm text-gray-900">
                    {approvers.length} approver{approvers.length > 1 ? 's' : ''} assigned
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-0.5">Created</p>
                <p className="text-sm text-gray-900" suppressHydrationWarning>
                  {formatDate(version.created_at)}
                </p>
                <p className="text-xs text-gray-500">{version.creator?.email?.split('@')[0] || 'Unknown'}</p>
              </div>
              
              {version.released_at && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-0.5">Released</p>
                  <p className="text-sm text-gray-900" suppressHydrationWarning>
                    {formatDate(version.released_at)}
                  </p>
                  <p className="text-xs text-gray-500">{version.releaser?.email?.split('@')[0] || 'Unknown'}</p>
                </div>
              )}
            </div>
          </div>

          {/* Attached Files */}
          <div className="pt-4 border-t">
            <h4 className="text-sm font-medium mb-3">Attached Files</h4>
            {files && files.length > 0 ? (
              <div className="space-y-2">
                {files.map((file: any) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-gray-50 border-gray-200"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <FileText className="h-5 w-5 flex-shrink-0 text-gray-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.file_name}</p>
                        <p className="text-xs text-gray-500">
                          {(file.file_size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" asChild>
                      <a
                        href={`/api/documents/${version.id}/files/${file.id}/download`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </a>
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No files attached</p>
            )}
          </div>

          {/* Rejection Notice (for Draft versions with rejected approvers) */}
          {version.status === 'Draft' && approvers.some((a: any) => a.status === 'Rejected') && (
            <div className="pt-4 border-t">
              {approvers
                .filter((a: any) => a.status === 'Rejected')
                .map((rejectedApprover: any) => (
                  <div key={rejectedApprover.id} className="p-4 bg-red-50 border border-red-200 rounded-lg mb-4">
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <p className="font-medium text-red-900 mb-1">Document Rejected</p>
                        <p className="text-sm text-red-800 mb-2">
                          Rejected by: {rejectedApprover.user_email}
                        </p>
                        {rejectedApprover.comments && (
                          <div className="mt-2 p-3 bg-white border border-red-200 rounded">
                            <p className="text-sm font-medium text-gray-700 mb-1">Rejection Reason:</p>
                            <p className="text-sm text-gray-900">{rejectedApprover.comments}</p>
                          </div>
                        )}
                        {rejectedApprover.action_date && (
                          <p className="text-xs text-red-700 mt-2" suppressHydrationWarning>
                            Rejected on {formatDate(rejectedApprover.action_date)}
                          </p>
                        )}
                        <p className="text-sm text-red-700 mt-2">
                          Please review the feedback, make necessary changes, and resubmit for approval.
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* Approver Management (for Draft versions) */}
          {version.status === 'Draft' && (isCreator || isAdmin) && (
            <div className="pt-4 border-t">
              <ApproverManagement
                documentId={version.id}
                approvers={approvers}
                availableUsers={availableUsers || []}
                disabled={false}
              />
            </div>
          )}

          {/* Approval Status (for In Approval documents) */}
          {version.status === 'In Approval' && approvers.length > 0 && (
            <div className="pt-4 border-t">
              <h4 className="text-sm font-medium mb-3">Approval Progress</h4>
              <div className="space-y-2">
                {approvers.map((approver: any) => (
                  <div key={approver.id} className="flex items-center justify-between p-3 bg-gray-50 rounded border">
                    <div className="flex-1">
                      <p className="text-sm font-medium">{approver.user_email}</p>
                      {approver.action_date && (
                        <p className="text-xs text-gray-500" suppressHydrationWarning>
                          {approver.status === 'Approved' ? 'Approved' : 'Rejected'} on {formatDate(approver.action_date)}
                        </p>
                      )}
                    </div>
                    <Badge className={
                      approver.status === 'Approved' ? 'bg-green-600' :
                      approver.status === 'Rejected' ? 'bg-red-600' :
                      'bg-yellow-600'
                    }>
                      {approver.status}
                    </Badge>
                  </div>
                ))}
              </div>
              
              {/* Withdraw button for creator */}
              {(isCreator || isAdmin) && (
                <div className="mt-4">
                  <Button 
                    variant="outline"
                    size="sm"
                    className="border-orange-200 text-orange-700 hover:bg-orange-50"
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
                      const result = await withdrawFromApproval(version.id)
                      if (result.success) {
                        toast.success('Document withdrawn from approval')
                        router.refresh()
                      } else {
                        toast.error(result.error || 'Failed to withdraw document')
                      }
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Actions (for Draft versions) */}
          {version.status === 'Draft' && (isCreator || isAdmin) && (
            <div className="pt-4 border-t flex gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={`/documents/${version.id}/edit`}>Edit Document</Link>
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  )

  return (
    <Card>
      <CardContent className="pt-6">
        {cardContent}
      </CardContent>
    </Card>
  )
}

export default function DocumentDetailPanel({
  documentData,
  selectedVersion,
  availableUsers,
  isAdmin,
  currentUserId,
  currentUserEmail,
  baselineReqsRefs,
}: DocumentDetailPanelProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { latestReleased, wipVersions, documentNumber, title } = documentData
  
  // Determine default tab — URL param takes priority, then fall back to logic
  const tabParam = searchParams.get('tab') as 'released' | 'wip' | null
  const isSelectedVersionWIP = selectedVersion && wipVersions.some(v => v.version === selectedVersion)
  const defaultTab = tabParam || (isSelectedVersionWIP ? 'wip' : (latestReleased ? 'released' : 'wip'))
  const [activeTab, setActiveTab] = useState<'released' | 'wip'>(defaultTab)

  // Check if current user is creator of any version
  const isCreator = latestReleased?.created_by === currentUserId || 
    wipVersions.some(v => v.created_by === currentUserId)

  // Update URL when tab changes
  const handleTabChange = (tab: 'released' | 'wip') => {
    setActiveTab(tab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="p-6">
      {/* Document Header (no version) */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-2xl font-bold mb-1">
              {documentNumber}
            </h1>
            <p className="text-lg text-gray-600 mb-2">{title}</p>
            
            {/* Latest version indicator */}
            {latestReleased && (
              <p className="text-sm text-gray-500">
                Latest: <span className="font-medium text-green-600">Released {latestReleased.version}</span>
              </p>
            )}

            {/* BaselineReqs reference badge — shown for released and draft-only docs */}
            <BaselineReqsBadge refs={baselineReqsRefs} />
          </div>
          
          {/* Bookmark Button */}
          <div className="flex-shrink-0 pt-1">
            <BookmarkButton
              documentId={latestReleased?.id || wipVersions[0]?.id || ''} 
              size="lg"
              showLabel
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b mb-6">
        <div className="flex gap-4">
          <button
            onClick={() => handleTabChange('released')}
            className={cn(
              "pb-2 px-1 border-b-2 font-medium text-sm transition-colors",
              activeTab === 'released' 
                ? "border-blue-500 text-blue-600" 
                : "border-transparent text-gray-500 hover:text-gray-700"
            )}
          >
            Released Version
          </button>
          <button
            onClick={() => handleTabChange('wip')}
            className={cn(
              "pb-2 px-1 border-b-2 font-medium text-sm transition-colors",
              activeTab === 'wip' 
                ? "border-blue-500 text-blue-600" 
                : "border-transparent text-gray-500 hover:text-gray-700"
            )}
          >
            Work In Progress {wipVersions.length > 0 && `(${wipVersions.length})`}
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'released' ? (
        <div className="space-y-6">
          {latestReleased ? (
            <VersionCard 
              version={latestReleased}
              isCreator={isCreator}
              isAdmin={isAdmin}
              currentUserId={currentUserId}
              currentUserEmail={currentUserEmail}
              availableUsers={availableUsers}
              isCollapsible={false}
            />
          ) : (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-gray-500 text-center py-8">
                  No released version yet. Check the Work In Progress tab to see drafts.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {wipVersions.length > 0 ? (
            wipVersions.map(version => (
              <VersionCard 
                key={version.id}
                version={version}
                isCreator={version.created_by === currentUserId}
                isAdmin={isAdmin}
                currentUserId={currentUserId}
                currentUserEmail={currentUserEmail}
                availableUsers={availableUsers}
                isCollapsible={false}
              />
            ))
          ) : (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-gray-500 text-center py-8">
                  No work in progress versions.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
