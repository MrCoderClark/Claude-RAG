import { useCallback, useState } from 'react'
import { Upload, FileText, Loader2 } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import type { UploadStatus } from '@/types'

interface UploadZoneProps {
  onFileSelect: (file: File) => void
  status: UploadStatus | null
  progress: number
  chunkCount: number | null
  isUploading: boolean
}

const ALLOWED_TYPES = ['.txt', '.md']

export function UploadZone({
  onFileSelect,
  status,
  progress,
  chunkCount,
  isUploading,
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
        return 'Upload complete!'
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
