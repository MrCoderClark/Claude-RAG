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
