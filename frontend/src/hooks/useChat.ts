import { useState, useCallback, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { streamChat } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import type { Message } from '@/types'

export function useChat(threadId: string | null) {
  const { session } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!threadId) {
      setMessages([])
      return
    }

    const fetchMessages = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })

      if (!error && data) {
        setMessages(data)
      }
      setLoading(false)
    }

    fetchMessages()
  }, [threadId])

  const sendMessage = useCallback(
    async (content: string) => {
      if (!threadId || !session?.access_token) return

      const userMessage: Message = {
        id: crypto.randomUUID(),
        thread_id: threadId,
        role: 'user',
        content,
        metadata: null,
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, userMessage])

      setStreaming(true)
      setStreamingContent('')

      abortRef.current = new AbortController()

      try {
        let fullContent = ''
        for await (const event of streamChat(threadId, content, session.access_token, abortRef.current.signal)) {
          if (event.type === 'text') {
            fullContent += event.content
            setStreamingContent(fullContent)
          } else if (event.type === 'done') {
            const assistantMessage: Message = {
              id: crypto.randomUUID(),
              thread_id: threadId,
              role: 'assistant',
              content: fullContent,
              metadata: null,
              created_at: new Date().toISOString(),
            }
            setMessages((prev) => [...prev, assistantMessage])
            setStreamingContent('')
          } else if (event.type === 'error') {
            console.error('Stream error:', event.content)
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          // User cancelled - keep partial content as the message
          if (streamingContent) {
            const partialMessage: Message = {
              id: crypto.randomUUID(),
              thread_id: threadId,
              role: 'assistant',
              content: streamingContent + ' [stopped]',
              metadata: null,
              created_at: new Date().toISOString(),
            }
            setMessages((prev) => [...prev, partialMessage])
          }
        } else {
          console.error('Error sending message:', err)
        }
      } finally {
        setStreaming(false)
        setStreamingContent('')
        abortRef.current = null
      }
    },
    [threadId, session?.access_token, streamingContent]
  )

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
    setStreaming(false)
  }, [])

  return {
    messages,
    loading,
    streaming,
    streamingContent,
    sendMessage,
    stopStreaming,
  }
}
