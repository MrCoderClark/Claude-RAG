import { useState } from 'react'
import { LogOut, Menu, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useThreads } from '@/hooks/useThreads'
import { Button } from '@/components/ui/button'
import { ThreadList } from '@/components/chat/ThreadList'
import { ChatInterface } from '@/components/chat/ChatInterface'

function generateThreadTitle(message: string): string {
  const trimmed = message.trim()
  if (trimmed.length <= 40) return trimmed
  return trimmed.slice(0, 37) + '...'
}

export function Layout() {
  const { user, signOut } = useAuth()
  const { threads, createThread, updateThread, deleteThread } = useThreads()
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const handleCreateThread = async () => {
    const thread = await createThread()
    setSelectedThreadId(thread.id)
  }

  const handleDeleteThread = async (id: string) => {
    await deleteThread(id)
    if (selectedThreadId === id) {
      setSelectedThreadId(null)
    }
  }

  const handleFirstMessage = async (threadId: string, message: string) => {
    const title = generateThreadTitle(message)
    await updateThread(threadId, { title })
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <h1 className="text-lg font-semibold">RAG Chat</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">{user?.email}</span>
          <Button variant="ghost" size="icon" onClick={signOut}>
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <aside className="w-64 border-r bg-muted/30">
            <ThreadList
              threads={threads}
              selectedId={selectedThreadId}
              onSelect={setSelectedThreadId}
              onCreate={handleCreateThread}
              onDelete={handleDeleteThread}
            />
          </aside>
        )}
        <main className="flex-1">
          <ChatInterface threadId={selectedThreadId} onFirstMessage={handleFirstMessage} />
        </main>
      </div>
    </div>
  )
}
