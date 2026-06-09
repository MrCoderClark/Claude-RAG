import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchDocuments, deleteDocument as apiDeleteDocument } from '@/lib/api'
import type { Document } from '@/types'

export function useDocuments() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const docs = await fetchDocuments(session.access_token)
      setDocuments(docs)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch documents'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const deleteDocument = async (id: string) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    await apiDeleteDocument(id, session.access_token)
    setDocuments((prev) => prev.filter((d) => d.id !== id))
  }

  return {
    documents,
    loading,
    error,
    refresh,
    deleteDocument,
  }
}
