import { useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { uploadDocument, replaceDocument, reprocessDocument } from '@/lib/api'
import type { UploadStatus, UploadEvent } from '@/types'

export interface DuplicateInfo {
  documentId: string
  filename: string
  file: File
}

export function useUpload(onComplete?: () => void) {
  const [status, setStatus] = useState<UploadStatus | null>(null)
  const [progress, setProgress] = useState(0)
  const [chunkCount, setChunkCount] = useState<number | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null)
  const [replaceSummary, setReplaceSummary] = useState<{
    chunks_added: number
    chunks_removed: number
    chunks_unchanged: number
  } | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    setStatus(null)
    setProgress(0)
    setChunkCount(null)
    setError(null)
    setDuplicateInfo(null)
    setReplaceSummary(null)
  }, [])

  const processEvent = useCallback((event: UploadEvent) => {
    setStatus(event.status)

    if (event.chunk_count !== undefined) {
      setChunkCount(event.chunk_count)
    }

    if (event.progress !== undefined) {
      setProgress(event.progress)
    }

    if (event.status === 'failed' && event.error) {
      setError(new Error(event.error))
    }

    if (event.status === 'completed') {
      if (event.chunks_added !== undefined) {
        setReplaceSummary({
          chunks_added: event.chunks_added!,
          chunks_removed: event.chunks_removed!,
          chunks_unchanged: event.chunks_unchanged!,
        })
      }
      onComplete?.()
    }
  }, [onComplete])

  const upload = useCallback(async (file: File) => {
    reset()
    abortControllerRef.current = new AbortController()

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      setStatus('uploading')

      for await (const event of uploadDocument(
        file,
        session.access_token,
        abortControllerRef.current.signal
      )) {
        if (event.status === 'duplicate_unchanged') {
          setStatus('duplicate_unchanged')
          onComplete?.()
          return
        }

        if (event.status === 'duplicate_changed') {
          setDuplicateInfo({
            documentId: event.document_id!,
            filename: event.filename!,
            file,
          })
          setStatus('duplicate_changed')
          return
        }

        processEvent(event)
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err)
        setStatus('failed')
      }
    }
  }, [reset, processEvent, onComplete])

  const confirmReplace = useCallback(async () => {
    if (!duplicateInfo) return

    const { documentId, file } = duplicateInfo
    setDuplicateInfo(null)
    setStatus('uploading')
    abortControllerRef.current = new AbortController()

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      for await (const event of replaceDocument(
        documentId,
        file,
        session.access_token,
        abortControllerRef.current.signal
      )) {
        processEvent(event)
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err)
        setStatus('failed')
      }
    }
  }, [duplicateInfo, processEvent])

  const cancelReplace = useCallback(() => {
    setDuplicateInfo(null)
    reset()
  }, [reset])

  const reprocess = useCallback(async (documentId: string) => {
    reset()
    abortControllerRef.current = new AbortController()

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      for await (const event of reprocessDocument(
        documentId,
        session.access_token,
        abortControllerRef.current.signal
      )) {
        processEvent(event)
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err)
        setStatus('failed')
      }
    }
  }, [reset, processEvent])

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort()
    reset()
  }, [reset])

  return {
    upload,
    reprocess,
    confirmReplace,
    cancelReplace,
    cancel,
    reset,
    status,
    progress,
    chunkCount,
    error,
    duplicateInfo,
    replaceSummary,
    isUploading: status !== null
      && status !== 'completed'
      && status !== 'failed'
      && status !== 'duplicate_unchanged'
      && status !== 'duplicate_changed',
  }
}
