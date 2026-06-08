import { useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { uploadDocument, reprocessDocument } from '@/lib/api'
import type { UploadStatus, UploadEvent } from '@/types'

export function useUpload(onComplete?: () => void) {
  const [status, setStatus] = useState<UploadStatus | null>(null)
  const [progress, setProgress] = useState(0)
  const [chunkCount, setChunkCount] = useState<number | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    setStatus(null)
    setProgress(0)
    setChunkCount(null)
    setError(null)
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
        processEvent(event)
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err)
        setStatus('failed')
      }
    }
  }, [reset, processEvent])

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
    cancel,
    reset,
    status,
    progress,
    chunkCount,
    error,
    isUploading: status !== null && status !== 'completed' && status !== 'failed',
  }
}
