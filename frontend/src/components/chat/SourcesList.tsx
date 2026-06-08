import { useState } from 'react'
import type { Source } from '@/types'

interface SourcesListProps {
  sources: Source[]
}

export function SourcesList({ sources }: SourcesListProps) {
  const [expanded, setExpanded] = useState(false)
  const [expandedChunks, setExpandedChunks] = useState<Set<string>>(new Set())

  if (sources.length === 0) return null

  const toggleChunk = (chunkId: string) => {
    setExpandedChunks((prev) => {
      const next = new Set(prev)
      if (next.has(chunkId)) {
        next.delete(chunkId)
      } else {
        next.add(chunkId)
      }
      return next
    })
  }

  return (
    <div className="mt-2 border-t border-border pt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <svg
          className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
        Sources ({sources.length})
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {sources.map((source) => (
            <div
              key={source.chunk_id}
              className="rounded border border-border bg-background p-2 text-sm"
            >
              <div className="flex items-center justify-between">
                <button
                  onClick={() => toggleChunk(source.chunk_id)}
                  className="flex items-center gap-2 font-medium hover:underline"
                >
                  <span>{source.document_filename}</span>
                  <span className="text-muted-foreground">
                    (chunk {source.chunk_index + 1})
                  </span>
                </button>
                <span className="text-xs text-muted-foreground">
                  {Math.round(source.similarity * 100)}% match
                </span>
              </div>

              {expandedChunks.has(source.chunk_id) && (
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                  {source.content}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
