import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Thread } from '@/types'

export function useThreads() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchThreads = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: fetchError } = await supabase
      .from('threads')
      .select('*')
      .order('updated_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setThreads(data || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchThreads()
  }, [fetchThreads])

  const createThread = async (title: string = 'New Chat') => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data, error } = await supabase
      .from('threads')
      .insert({ title, user_id: user.id })
      .select()
      .single()

    if (error) throw error
    setThreads((prev) => [data, ...prev])
    return data as Thread
  }

  const updateThread = async (id: string, updates: Partial<Thread>) => {
    const { error } = await supabase
      .from('threads')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw error
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    )
  }

  const deleteThread = async (id: string) => {
    const { error } = await supabase.from('threads').delete().eq('id', id)
    if (error) throw error
    setThreads((prev) => prev.filter((t) => t.id !== id))
  }

  return {
    threads,
    loading,
    error,
    createThread,
    updateThread,
    deleteThread,
    refetch: fetchThreads,
  }
}
