'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  BookOpen, 
  FileText, 
  HelpCircle, 
  Video, 
  MessageCircle,
  Download,
  ArrowRight,
  CheckCircle,
  Info
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// ── Inline tooltip ────────────────────────────────────────────────────────────
// Lightweight hover tooltip — avoids adding a shadcn dependency just for help page.
function Tooltip({ content }: { content: string }) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  return (
    <span
      ref={ref}
      className="relative inline-flex items-center ml-1.5 cursor-help"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      tabIndex={0}
      aria-label={content}
    >
      <Info className="h-3.5 w-3.5 text-gray-400 hover:text-blue-500 transition-colors" />
      {visible && (
        <span className="absolute left-5 top-0 z-50 w-64 rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700 shadow-lg leading-relaxed">
          {content}
        </span>
      )}
    </span>
  )
}

const quickStartSteps = [
  {
    title: 'Sign In',
    description: 'Use your Google account to sign in to your organization\'s BaselineDocs instance'
  },
  {
    title: 'Create Your First Document',
    description: 'Click "New Document", select a type, add a title and description, and optionally upload files'
  },
  {
    title: 'Submit for Approval',
    description: 'Assign approvers to your document and submit it for review'
  },
  {
    title: 'Track & Manage',
    description: 'Monitor document status, create new versions, and manage your document library'
  }
]

const commonTasks = [
  {
    title: 'Creating Documents',
    items: [
      {
        label: 'Choose the right document type',
        tip: 'Document types (e.g. Form, Procedure, Work Instruction) are configured by your admin. Each type gets its own prefix and sequential numbering — e.g. FORM-00001, PROC-00002. Pick the type that matches your document\'s purpose.'
      },
      {
        label: 'Understanding Prototype vs Production',
        tip: 'Prototype documents use alphabetic versions (vA, vB, vC) and are for development or testing. Production documents use numeric versions (v1, v2, v3) and represent formally released content. Start with Prototype; promote to Production when the document is ready for official use.'
      },
      {
        label: 'Uploading and managing files',
        tip: 'Attach PDFs, Word docs, Excel files, images, or CSVs — up to 50 MB per file, 20 files per document. Files can be added or removed while the document is in Draft. Once submitted for approval, attachments are locked until the document returns to Draft.'
      },
      {
        label: 'Assigning project codes',
        tip: 'Project codes let you group related documents together (e.g. all documents for a specific initiative or client). Enter any identifier that makes sense for your organization. You can then filter the document list by project code to see all related documents at once.'
      },
    ]
  },
  {
    title: 'Approval Workflows',
    items: [
      {
        label: 'Assigning approvers to documents',
        tip: 'On the document creation or edit page, search for users by name or email and add them as approvers. You can assign multiple approvers. All assigned approvers must approve before the document is released — a single rejection returns it to Draft.'
      },
      {
        label: 'Reviewing documents as an approver',
        tip: 'When you\'re assigned to review a document, it appears in "My Approvals" in the navigation. Open the document to review its content and attached files, then click Approve or Reject at the bottom of the page. Rejection requires a comment explaining what needs to change.'
      },
      {
        label: 'Handling rejection feedback',
        tip: 'If your document is rejected, it returns to Draft and the rejection reason appears highlighted on the document page. Make your revisions and re-submit for approval. You can also update the approver list before resubmitting if needed.'
      },
      {
        label: 'Tracking approval progress',
        tip: 'The Approval Workflow section on the document detail page shows each approver\'s status (Pending, Approved, or Rejected) along with the date and any comments. The counter at the top shows how many of the total approvers have approved so far.'
      },
    ]
  },
  {
    title: 'Version Control',
    items: [
      {
        label: 'Creating new document versions',
        tip: 'From a Released document, click "Create New Version". This creates a new Draft that copies the metadata from the previous version. The new version goes through the full creation and approval process independently. The previous Released version remains visible in the version history.'
      },
      {
        label: 'Understanding version numbering (vA, vB vs v1, v2)',
        tip: 'Prototype versions use letters: vA, vB, vC, etc. Each time you create a new version of a Prototype, the letter increments. Production versions use numbers: v1, v2, v3, etc. When you promote a Prototype to Production, versioning resets to v1 regardless of how many Prototype versions existed.'
      },
      {
        label: 'Viewing version history',
        tip: 'The Version History section at the bottom of any document page shows all versions of that document number, each with its status and a direct link. This makes it easy to navigate between the current Released version and any prior Obsolete versions.'
      },
      {
        label: 'Promoting Prototype to Production',
        tip: 'When a Prototype document is Released, a "Promote to Production" button appears. This creates a new Production document (v1) with the same document number. The Prototype lineage (vA, vB…) and the Production lineage (v1, v2…) are tracked separately — neither is deleted when you promote.'
      },
    ]
  },
  {
    title: 'Document Management',
    items: [
      {
        label: 'Searching and filtering documents',
        tip: 'Use the search box on the All Documents page to find documents by number or title. Filters let you narrow by document type, status, and project code. The "My Documents" toggle shows only documents you created or revised. Combine search and filters to zero in quickly.'
      },
      {
        label: 'Understanding document statuses',
        tip: 'Draft (gray) — being created or revised, only visible to the creator and admins. In Approval (yellow) — submitted and awaiting reviewer decisions. Released (green) — approved and visible to everyone in your organization. Obsolete (dark gray) — superseded by a newer Released version, still accessible for reference.'
      },
      {
        label: 'Managing obsolete documents',
        tip: 'When a new version of a document is Released, the previous Released version automatically becomes Obsolete. Obsolete documents are read-only and cannot be edited or versioned, but they remain accessible for audit and compliance purposes. A "See Latest Released" button links directly to the current active version.'
      },
      {
        label: 'Using the audit trail',
        tip: 'Every document has a complete audit trail showing all actions: creation, edits, file uploads, approvals, rejections, releases, and version changes — with the user and timestamp for each. The audit trail is read-only and cannot be altered. It appears at the bottom of every document detail page.'
      },
    ]
  }
]

const faqItems = [
  {
    question: 'What does each document status mean?',
    answer: 'Draft (editable, gray badge) - document is being created or revised. In Approval (yellow badge) - awaiting approver reviews. Released (green badge) - approved and active. Obsolete (dark gray badge) - superseded by a newer version.'
  },
  {
    question: 'How is a document number assigned?',
    answer: 'Document numbers are automatically generated using the format PREFIX-00001vA, where PREFIX comes from the document type (e.g., FORM, PROC), followed by a 5-digit sequential number and version letter/number.'
  },
  {
    question: 'What\'s the difference between Prototype and Production?',
    answer: 'Prototype documents use alphabetic versioning (vA, vB, vC) and are for development/testing. Production documents use numeric versioning (v1, v2, v3) and represent formally released documents. You can promote a Prototype to Production when ready.'
  },
  {
    question: 'Can I edit a Released document?',
    answer: 'No, Released documents are read-only to maintain document integrity. To make changes, create a new version of the document, which will start as Draft and go through the approval process again.'
  },
  {
    question: 'What happens when I reject a document?',
    answer: 'When you reject a document, it returns to Draft status so the creator can revise it. Your rejection comment helps them understand what needs to be changed. They can then resubmit for approval.'
  },
  {
    question: 'Who can see my Draft documents?',
    answer: 'Only you (the creator) and system administrators can see your Draft documents. Once Released, documents become visible to all authenticated users in your organization.'
  },
  {
    question: 'How do I find a specific document?',
    answer: 'Use the search box on the Documents page to search by document number or title. You can also filter by document type, status, project code, or use the "My Documents" toggle to see only documents you created.'
  },
  {
    question: 'What is the audit trail?',
    answer: 'The audit trail tracks all actions on a document including creation, edits, file uploads, submissions, approvals, rejections, and releases. This provides a complete history for compliance and tracking purposes.'
  }
]

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Help Center
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Everything you need to know about using BaselineDocs for document control and version management
          </p>
        </div>

        {/* Quick Access Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <Link href="/help/quick-start">
            <Card className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardHeader>
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                  <BookOpen className="h-6 w-6 text-blue-600" />
                </div>
                <CardTitle>Quick Start Guide</CardTitle>
                <CardDescription>
                  Get up and running in 5 minutes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="link" className="p-0 text-blue-600">
                  View guide <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </Link>

          <Link href="/help/documentation">
            <Card className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardHeader>
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                  <FileText className="h-6 w-6 text-green-600" />
                </div>
                <CardTitle>Complete Documentation</CardTitle>
                <CardDescription>
                  Detailed guide covering all features
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="link" className="p-0 text-blue-600">
                  Read docs <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </Link>

          <Link href="/help/contact">
            <Card className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardHeader>
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                  <MessageCircle className="h-6 w-6 text-purple-600" />
                </div>
                <CardTitle>Contact Support</CardTitle>
                <CardDescription>
                  Need help? We're here for you
                </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="link" className="p-0 text-blue-600">
                Get support <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
          </Link>
        </div>

        {/* Quick Start Section */}
        <Card className="mb-12">
          <CardHeader>
            <CardTitle className="text-2xl">Getting Started</CardTitle>
            <CardDescription>
              Follow these steps to start managing documents
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {quickStartSteps.map((step, index) => (
                <div key={index} className="flex gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-semibold">
                      {index + 1}
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">{step.title}</h3>
                    <p className="text-gray-600">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-start gap-3">
                <Video className="h-5 w-5 text-blue-600 mt-0.5" />
                <div>
                  <p className="font-medium text-gray-900 mb-1">
                    Want a visual walkthrough?
                  </p>
                  <p className="text-sm text-gray-600 mb-3">
                    Restart the interactive product tour from your dashboard
                  </p>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      localStorage.removeItem('baselinedocs_tour_completed')
                      window.location.href = '/dashboard'
                    }}
                  >
                    Restart Tour
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Common Tasks */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Common Tasks</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {commonTasks.map((section, index) => (
              <Card key={index}>
                <CardHeader>
                  <CardTitle className="text-lg">{section.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {section.items.map((item, itemIndex) => (
                      <li key={itemIndex} className="flex items-start gap-2">
                        <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                        <span className="text-gray-700 flex items-center flex-wrap">
                          {item.label}
                          <Tooltip content={item.tip} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* FAQ Section */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <HelpCircle className="h-6 w-6 text-blue-600" />
              Frequently Asked Questions
            </CardTitle>
            <CardDescription>
              Quick answers to common questions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {faqItems.map((faq, index) => (
                <div key={index}>
                  <h3 className="font-semibold text-gray-900 mb-2">
                    {faq.question}
                  </h3>
                  <p className="text-gray-600 leading-relaxed">
                    {faq.answer}
                  </p>
                  {index < faqItems.length - 1 && (
                    <div className="border-b border-gray-200 mt-6" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Footer CTA */}
        <div className="mt-12 text-center">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
            <CardContent className="p-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Still need help?
              </h2>
              <p className="text-gray-700 mb-6 max-w-2xl mx-auto">
                Can't find what you're looking for? Our support team is ready to assist you with any questions or issues.
              </p>
              <div className="flex gap-4 justify-center">
                <Link href="/dashboard">
                  <Button variant="outline" className="bg-white">
                    Back to Dashboard
                  </Button>
                </Link>
                <Button className="bg-blue-600 hover:bg-blue-700">
                  Contact Support
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
