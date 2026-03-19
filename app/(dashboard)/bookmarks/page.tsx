import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Bookmark } from 'lucide-react'
import BookmarksListClient from './BookmarksListClient'

export const revalidate = 0

export default async function BookmarksPage() {
  const supabase = await createClient()

  // Get current user
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/')
  }

  // Get user's bookmarks
  const { data: bookmarks } = await supabase
    .from('document_bookmarks')
    .select('document_number')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (!bookmarks || bookmarks.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <div className="flex items-center gap-3">
              <Bookmark className="h-8 w-8 text-blue-600" />
              <h1 className="text-3xl font-bold text-gray-900">Bookmarks</h1>
            </div>
            <p className="mt-2 text-gray-600">Quick access to your frequently used documents</p>
          </div>

          {/* Empty State */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <Bookmark className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No bookmarks yet</h2>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              Bookmark documents for quick access. Click the bookmark icon on any document to add it here.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const documentNumbers = bookmarks.map(b => b.document_number)

  // Get latest Released version for each bookmarked document
  const { data: documents } = await supabase
    .from('documents')
    .select(`
      *,
      document_types (name, prefix),
      created_by
    `)
    .in('document_number', documentNumbers)
    .eq('status', 'Released')
    .order('updated_at', { ascending: false })

  // Filter to get only the latest version for each document_number
  const latestDocuments = new Map()
  documents?.forEach(doc => {
    if (!latestDocuments.has(doc.document_number)) {
      latestDocuments.set(doc.document_number, doc)
    }
  })

  const bookmarkedDocs = Array.from(latestDocuments.values())

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <Bookmark className="h-8 w-8 text-blue-600 fill-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">Bookmarks</h1>
          </div>
          <p className="mt-2 text-gray-600">
            {bookmarkedDocs.length} bookmarked document{bookmarkedDocs.length !== 1 ? 's' : ''}
          </p>
        </div>

        <BookmarksListClient documents={bookmarkedDocs} />
      </div>
    </div>
  )
}
