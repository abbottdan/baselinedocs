'use client'

import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import BookmarkButton from './components/BookmarkButton'

interface Document {
  id: string
  document_number: string
  version: string
  title: string
  status: string
  updated_at: string
  document_type?: {
    name: string
  }
}

interface DocumentsTableProps {
  documents: Document[]
  onDocumentSelect: (documentNumber: string, version: string) => void
  selectedDocumentNumber?: string
}

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-500',
  'In Approval': 'bg-yellow-500',
  Released: 'bg-green-500',
  Obsolete: 'bg-gray-700',
}

export default function DocumentsTable({ documents, onDocumentSelect, selectedDocumentNumber }: DocumentsTableProps) {
  if (documents.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-gray-500">No documents found</p>
        <p className="text-xs text-gray-400 mt-1">Try adjusting your filters</p>
      </div>
    )
  }

  return (
    <div className="divide-y">
      {documents.map((doc) => (
        <button
          key={doc.id}
          onClick={() => onDocumentSelect(doc.document_number, doc.version)}
          className={cn(
            "w-full text-left p-3 hover:bg-gray-50 transition-colors",
            selectedDocumentNumber === doc.document_number && "bg-blue-50 border-l-4 border-l-blue-500"
          )}
        >
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-sm truncate">
                {doc.document_number}{doc.version}
              </span>
              <div className="flex items-center gap-2">
                <BookmarkButton
                  documentId={doc.id}
                  size="sm"
                />
                <Badge className={cn("text-xs px-1.5 py-0", STATUS_COLORS[doc.status] || 'bg-gray-500')}>
                  {doc.status}
                </Badge>
              </div>
            </div>
            <p className="text-sm text-gray-900 truncate">
              {doc.title}
            </p>
            <div className="flex items-center justify-end text-xs text-gray-500">
              <span suppressHydrationWarning>
                {formatDistanceToNow(new Date(doc.updated_at), { addSuffix: true })}
              </span>
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}
