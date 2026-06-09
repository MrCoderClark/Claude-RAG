import { useCallback, useState } from 'react'
import { Upload, FileText, Loader2, CheckCircle2, Info } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import type { UploadStatus } from '@/types'

interface UploadZoneProps {
  onFileSelect: (file: File) => void
  status: UploadStatus | null
  progress: number
  chunkCount: number | null
  isUploading: boolean
  replaceSummary?: {
    chunks_added: number
    chunks_removed: number
    chunks_unchanged: number
  } | null
}

const ALLOWED_TYPES = ['.txt', '.md']

export function UploadZone({
  onFileSelect,
  status,
  progress,
  chunkCount,
  isUploading,
  replaceSummary,
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)

      const file = e.dataTransfer.files[0]
      if (file && isValidFile(file)) {
        onFileSelect(file)
      }
    },
    [onFileSelect]
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file && isValidFile(file)) {
        onFileSelect(file)
      }
      e.target.value = ''
    },
    [onFileSelect]
  )

  const isValidFile = (file: File) => {
    return ALLOWED_TYPES.some((ext) => file.name.toLowerCase().endsWith(ext))
  }

  const getStatusMessage = () => {
    switch (status) {
      case 'uploading':
        return 'Uploading file...'
      case 'chunking':
        return chunkCount ? `Chunking... (${chunkCount} chunks)` : 'Chunking...'
      case 'embedding':
        return `Generating embeddings... ${progress}%`
      case 'completed':
        if (replaceSummary) {
          return `Updated: ${replaceSummary.chunks_added} added, ${replaceSummary.chunks_removed} removed, ${replaceSummary.chunks_unchanged} unchanged`
        }
        return 'Upload complete!'
      case 'duplicate_unchanged':
        return 'File is already up to date'
      case 'failed':
        return 'Upload failed'
      default:
        return null
    }
  }

  return (
    <div
      className={`
        relative rounded-lg border-2 border-dashed p-8 text-center transition-colors
        ${isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}
        ${isUploading ? 'pointer-events-none opacity-75' : 'hover:border-primary/50'}
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept={ALLOWED_TYPES.join(',')}
        onChange={handleFileInput}
        className="hidden"
        id="file-upload"
        disabled={isUploading}
      />

      {isUploading ? (
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm font-medium">{getStatusMessage()}</p>
          {status === 'embedding' && (
            <div className="h-2 w-48 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      ) : status === 'completed' || status === 'duplicate_unchanged' ? (
        <div className="flex flex-col items-center gap-3">
          {status === 'duplicate_unchanged' ? (
            <Info className="h-10 w-10 text-blue-500" />
          ) : (
            <CheckCircle2 className="h-10 w-10 text-green-500" />
          )}
          <p className="text-sm font-medium">{getStatusMessage()}</p>
        </div>
      ) : (
        <label htmlFor="file-upload" className="cursor-pointer">
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-full bg-muted p-3">
              <Upload className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">Drop files here or click to upload</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Supports {ALLOWED_TYPES.join(', ')} files
              </p>
            </div>
            <span className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              <FileText className="mr-2 h-4 w-4" />
              Select File
            </span>
          </div>
        </label>
      )}
    </div>
  )
}
