import { useState, type KeyboardEvent } from 'react'
import { Send, Square, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface MessageInputProps {
  onSend: (message: string) => void
  disabled?: boolean
  streaming?: boolean
  onStop?: () => void
}

export function MessageInput({ onSend, disabled, streaming, onStop }: MessageInputProps) {
  const [input, setInput] = useState('')

  const handleSend = () => {
    if (input.trim() && !disabled) {
      onSend(input.trim())
      setInput('')
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex gap-2 border-t p-4">
      {streaming && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message..."
        disabled={disabled}
        className="flex-1"
      />
      {streaming ? (
        <Button onClick={onStop} variant="destructive">
          <Square className="h-4 w-4" />
        </Button>
      ) : (
        <Button onClick={handleSend} disabled={disabled || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
