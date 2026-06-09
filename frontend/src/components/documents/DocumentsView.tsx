import { useState } from 'react'
import { useDocuments } from '@/hooks/useDocuments'
import { useUpload } from '@/hooks/useUpload'
import { UploadZone } from './UploadZone'
import { DocumentRow } from './DocumentRow'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export function DocumentsView() {
  const { documents, loading, error, refresh, deleteDocument } = useDocuments()
  const {
    upload,
    reprocess,
    confirmReplace,
    cancelReplace,
    status,
    progress,
    chunkCount,
    isUploading,
    reset,
    duplicateInfo,
    replaceSummary,
  } = useUpload(() => {
    refresh()
    setTimeout(reset, 2000)
  })
  const [reprocessingId, setReprocessingId] = useState<string | null>(null)

  const handleReprocess = async (documentId: string) => {
    setReprocessingId(documentId)
    await reprocess(documentId)
    refresh()
    setReprocessingId(null)
  }

  const handleDelete = async (documentId: string) => {
    await deleteDocument(documentId)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <UploadZone
          onFileSelect={upload}
          status={status}
          progress={progress}
          chunkCount={chunkCount}
          isUploading={isUploading}
          replaceSummary={replaceSummary}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="py-8 text-center text-muted-foreground">
            Loading documents...
          </div>
        ) : error ? (
          <div className="py-8 text-center text-red-600">
            Error: {error.message}
          </div>
        ) : documents.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            No documents yet. Upload your first document above.
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <DocumentRow
                key={doc.id}
                document={doc}
                onDelete={handleDelete}
                onReprocess={handleReprocess}
                isReprocessing={reprocessingId === doc.id}
              />
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={duplicateInfo !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing file?</AlertDialogTitle>
            <AlertDialogDescription>
              {duplicateInfo?.filename} already exists. Content has changed — replace it?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelReplace}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReplace}>Replace</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
