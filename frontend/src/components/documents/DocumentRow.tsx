import { useState } from 'react'
import { ChevronDown, ChevronUp, Trash2, RefreshCw, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ChunkList } from './ChunkList'
import type { Document } from '@/types'

interface DocumentRowProps {
  document: Document
  onDelete: (id: string) => void
  onReprocess: (id: string) => void
  isReprocessing: boolean
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatusBadge({ status }: { status: Document['status'] }) {
  const styles = {
    pending: 'bg-gray-100 text-gray-700',
    processing: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status === 'processing' && <Loader2 className="h-3 w-3 animate-spin" />}
      {status}
    </span>
  )
}

export function DocumentRow({
  document,
  onDelete,
  onReprocess,
  isReprocessing,
}: DocumentRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete(document.id)
      setConfirmDelete(false)
    } else {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 3000)
    }
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-4 p-4">
        <FileText className="h-5 w-5 flex-shrink-0 text-muted-foreground" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{document.filename}</span>
            <StatusBadge status={document.status} />
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {formatFileSize(document.file_size)} • {document.chunk_count} chunks • {formatDate(document.created_at)}
          </div>
          {document.error_message && (
            <div className="mt-1 text-xs text-red-600">
              Error: {document.error_message}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {document.status === 'completed' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => onReprocess(document.id)}
            disabled={isReprocessing || document.status === 'processing'}
            title="Reprocess document"
          >
            <RefreshCw className={`h-4 w-4 ${isReprocessing ? 'animate-spin' : ''}`} />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className={confirmDelete ? 'text-red-600 hover:text-red-700' : ''}
            title={confirmDelete ? 'Click again to confirm' : 'Delete document'}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {expanded && document.status === 'completed' && (
        <div className="border-t bg-muted/30 p-4">
          <ChunkList documentId={document.id} />
        </div>
      )}
    </div>
  )
}
