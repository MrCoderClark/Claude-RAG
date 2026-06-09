import type { Document, Chunk, UploadEvent } from '@/types'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001'

export async function* streamChat(
  threadId: string,
  message: string,
  token: string,
  signal?: AbortSignal
): AsyncGenerator<{ type: 'text' | 'done' | 'error'; content: string }> {
  const response = await fetch(`${API_URL}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ thread_id: threadId, message }),
    signal,
  })

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Process line by line
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data:') continue

      // Extract JSON from "data: {...}" or "data: data: {...}"
      const match = trimmed.match(/data:\s*(?:data:\s*)?(\{.+\})/)
      if (match) {
        try {
          const data = JSON.parse(match[1])
          yield data
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    const match = buffer.trim().match(/data:\s*(?:data:\s*)?(\{.+\})/)
    if (match) {
      try {
        const data = JSON.parse(match[1])
        yield data
      } catch {
        // Skip malformed JSON
      }
    }
  }
}

export async function* uploadDocument(
  file: File,
  token: string,
  signal?: AbortSignal
): AsyncGenerator<UploadEvent> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${API_URL}/documents/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
    signal,
  })

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data:') continue

      const match = trimmed.match(/data:\s*(?:data:\s*)?(\{.+\})/)
      if (match) {
        try {
          const data = JSON.parse(match[1])
          yield data
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }

  if (buffer.trim()) {
    const match = buffer.trim().match(/data:\s*(?:data:\s*)?(\{.+\})/)
    if (match) {
      try {
        const data = JSON.parse(match[1])
        yield data
      } catch {
        // Skip malformed JSON
      }
    }
  }
}

export async function* replaceDocument(
  documentId: string,
  file: File,
  token: string,
  signal?: AbortSignal
): AsyncGenerator<UploadEvent> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${API_URL}/documents/${documentId}/replace`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
    signal,
  })

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data:') continue

      const match = trimmed.match(/data:\s*(?:data:\s*)?(\{.+\})/)
      if (match) {
        try {
          const data = JSON.parse(match[1])
          yield data
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }
}

export async function fetchDocuments(token: string): Promise<Document[]> {
  const response = await fetch(`${API_URL}/documents`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  const data = await response.json()
  return data.documents
}

export async function deleteDocument(id: string, token: string): Promise<void> {
  const response = await fetch(`${API_URL}/documents/${id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
}

export async function fetchChunks(
  documentId: string,
  page: number,
  token: string
): Promise<{ chunks: Chunk[]; total: number; page: number; page_size: number }> {
  const response = await fetch(
    `${API_URL}/documents/${documentId}/chunks?page=${page}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  )

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  return response.json()
}

export async function* reprocessDocument(
  documentId: string,
  token: string,
  signal?: AbortSignal
): AsyncGenerator<UploadEvent> {
  const response = await fetch(`${API_URL}/documents/${documentId}/reprocess`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal,
  })

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data:') continue

      const match = trimmed.match(/data:\s*(?:data:\s*)?(\{.+\})/)
      if (match) {
        try {
          const data = JSON.parse(match[1])
          yield data
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }
}
