import { Plus, Trash2, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Thread } from '@/types'

interface ThreadListProps {
  threads: Thread[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

export function ThreadList({
  threads,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
}: ThreadListProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="p-4">
        <Button onClick={onCreate} className="w-full" variant="outline">
          <Plus className="mr-2 h-4 w-4" />
          New Chat
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {threads.map((thread) => (
          <div
            key={thread.id}
            className={`group flex items-center gap-2 border-b px-4 py-3 cursor-pointer hover:bg-muted/50 ${
              selectedId === thread.id ? 'bg-muted' : ''
            }`}
            onClick={() => onSelect(thread.id)}
          >
            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate text-sm">{thread.title}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(thread.id)
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
