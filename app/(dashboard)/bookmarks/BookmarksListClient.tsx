'use client'

import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import BookmarkButton from '@/app/documents/components/BookmarkButton'

interface Document {
  id: string
  document_number: string
  version: string
  title: string
  status: string
  is_production: boolean
  updated_at: string
  document_types: {
    name: string
    prefix: string
  }
  users: {
    email: string
    full_name: string
  }
}

interface BookmarksListClientProps {
  documents: Document[]
}

export default function BookmarksListClient({ documents }: BookmarksListClientProps) {
  const router = useRouter()

  const handleDocumentClick = (doc: Document) => {
    router.push(`/documents?selected=${doc.document_number}&version=${doc.version}`)
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Document
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Title
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Type
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Version
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Updated
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Bookmark
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {documents.map((doc) => (
            <tr
              key={doc.id}
              onClick={() => handleDocumentClick(doc)}
              className="hover:bg-gray-50 cursor-pointer transition-colors"
            >
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm font-medium text-blue-600">
                  {doc.document_number}
                </div>
              </td>
              <td className="px-6 py-4">
                <div className="text-sm text-gray-900">{doc.title}</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-gray-500">{doc.document_types.name}</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-900">{doc.version}</span>
                  {doc.is_production && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                      Production
                    </span>
                  )}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {formatDistanceToNow(new Date(doc.updated_at), { addSuffix: true })}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <BookmarkButton
                  documentId={doc.id} 
                  initialBookmarked={true}
                  size="md"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
