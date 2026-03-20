'use client'

import { useState, useEffect } from 'react'
import { Bookmark } from 'lucide-react'
import { toggleBookmark, isDocumentBookmarked } from '@/app/actions/bookmarks'
import { toast } from 'sonner'

interface BookmarkButtonProps {
  documentId: string
  initialBookmarked?: boolean
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
}

export default function BookmarkButton({ 
  documentId, 
  initialBookmarked = false,
  size = 'md',
  showLabel = false
}: BookmarkButtonProps) {
  const [isBookmarked, setIsBookmarked] = useState(initialBookmarked)
  const [isLoading, setIsLoading] = useState(false)

  // Fetch bookmark status on mount
  useEffect(() => {
    async function checkBookmark() {
      const bookmarked = await isDocumentBookmarked(documentId)
      setIsBookmarked(bookmarked)
    }
    checkBookmark()
  }, [documentId])

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation() // Prevent row click if in table
    
    setIsLoading(true)
    const result = await toggleBookmark(documentId)
    setIsLoading(false)

    if (result.success) {
      setIsBookmarked(result.bookmarked!)
      toast.success(result.bookmarked ? 'Bookmark added' : 'Bookmark removed')
    } else {
      toast.error(result.error || 'Failed to update bookmark')
    }
  }

  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6'
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isLoading}
      className="inline-flex items-center gap-1.5 hover:opacity-70 transition-opacity disabled:opacity-50"
      title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
    >
      <Bookmark
        className={`${sizeClasses[size]} ${
          isBookmarked 
            ? 'fill-blue-600 text-blue-600' 
            : 'text-gray-400 hover:text-blue-600'
        } transition-colors`}
      />
      {showLabel && (
        <span className="text-sm text-gray-600">
          {isBookmarked ? 'Bookmarked' : 'Bookmark'}
        </span>
      )}
    </button>
  )
}
