export interface Thread {
  id: string
  user_id: string
  openai_thread_id: string | null
  title: string
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  thread_id: string
  role: 'user' | 'assistant'
  content: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface StreamEvent {
  type: 'text' | 'done' | 'error'
  content: string
}
