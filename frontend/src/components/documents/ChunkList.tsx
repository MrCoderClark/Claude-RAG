import { useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useChunks } from '@/hooks/useChunks'

interface ChunkListProps {
  documentId: string
}

export function ChunkList({ documentId }: ChunkListProps) {
  const { chunks, total, page, setPage, totalPages, loading } = useChunks(documentId)
  const [expandedChunk, setExpandedChunk] = useState<string | null>(null)

  if (loading) {
    return <div className="py-4 text-center text-sm text-muted-foreground">Loading chunks...</div>
  }

  if (chunks.length === 0) {
    return <div className="py-4 text-center text-sm text-muted-foreground">No chunks found</div>
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        {total} chunks total
      </div>

      <div className="space-y-2">
        {chunks.map((chunk) => {
          const isExpanded = expandedChunk === chunk.id
          const preview = chunk.content.slice(0, 200)
          const hasMore = chunk.content.length > 200

          return (
            <Card key={chunk.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Chunk {chunk.chunk_index}</span>
                    <span>|</span>
                    <span>Pos {chunk.metadata.start_pos}-{chunk.metadata.end_pos}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm">
                    {isExpanded ? chunk.content : preview}
                    {!isExpanded && hasMore && '...'}
                  </p>
                </div>
                {hasMore && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpandedChunk(isExpanded ? null : chunk.id)}
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            </Card>
          )
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(page + 1)}
            disabled={page >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
