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

export interface Document {
  id: string
  user_id: string
  filename: string
  storage_path: string
  file_size: number
  mime_type: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error_message: string | null
  chunk_count: number
  created_at: string
  updated_at: string
}

export interface Chunk {
  id: string
  document_id: string
  content: string
  chunk_index: number
  metadata: { start_pos: number; end_pos: number }
  created_at: string
}

export type UploadStatus = 'uploading' | 'chunking' | 'embedding' | 'completed' | 'failed'

export interface UploadEvent {
  status: UploadStatus
  document_id?: string
  chunk_count?: number
  progress?: number
  error?: string
}
