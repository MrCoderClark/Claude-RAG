import { useChat } from '@/hooks/useChat'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'

interface ChatInterfaceProps {
  threadId: string | null
  onFirstMessage?: (threadId: string, message: string) => void
}

export function ChatInterface({ threadId, onFirstMessage }: ChatInterfaceProps) {
  const { messages, loading, streaming, streamingContent, sendMessage, stopStreaming } = useChat(threadId)

  const handleSend = (content: string) => {
    const isFirstMessage = messages.filter(m => m.role === 'user').length === 0
    sendMessage(content)
    if (isFirstMessage && threadId && onFirstMessage) {
      onFirstMessage(threadId, content)
    }
  }

  if (!threadId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Select a chat or create a new one to get started
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading messages...
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <MessageList messages={messages} streamingContent={streamingContent} />
      <MessageInput
        onSend={handleSend}
        disabled={streaming}
        streaming={streaming}
        onStop={stopStreaming}
      />
    </div>
  )
}
