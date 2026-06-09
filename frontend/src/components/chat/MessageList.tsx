import { useEffect, useRef } from 'react'
import type { Message } from '@/types'
import { SourcesList } from './SourcesList'

interface MessageListProps {
  messages: Message[]
  streamingContent?: string
}

export function MessageList({ messages, streamingContent }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[80%] rounded-lg px-4 py-2 ${
              message.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted'
            }`}
          >
            <p className="whitespace-pre-wrap">{message.content}</p>
            {message.role === 'assistant' && message.metadata?.sources && (
              <SourcesList sources={message.metadata.sources} />
            )}
          </div>
        </div>
      ))}
      {streamingContent && (
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-lg bg-muted px-4 py-2">
            <p className="whitespace-pre-wrap">{streamingContent}</p>
            <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-1" />
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  )
}
