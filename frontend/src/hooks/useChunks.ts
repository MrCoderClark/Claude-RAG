import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchChunks } from '@/lib/api'
import type { Chunk } from '@/types'

export function useChunks(documentId: string | null) {
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const loadChunks = useCallback(async () => {
    if (!documentId) {
      setChunks([])
      setTotal(0)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const result = await fetchChunks(documentId, page, session.access_token)
      setChunks(result.chunks)
      setTotal(result.total)
      setPageSize(result.page_size)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch chunks'))
    } finally {
      setLoading(false)
    }
  }, [documentId, page])

  useEffect(() => {
    loadChunks()
  }, [loadChunks])

  useEffect(() => {
    setPage(1)
  }, [documentId])

  const totalPages = Math.ceil(total / pageSize)

  return {
    chunks,
    total,
    page,
    setPage,
    totalPages,
    loading,
    error,
    refresh: loadChunks,
  }
}
