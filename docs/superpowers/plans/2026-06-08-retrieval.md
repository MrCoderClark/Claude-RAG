# Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tool-based retrieval to chat so the LLM can search user documents and display citations.

**Architecture:** Create a retrieval service that embeds queries and searches pgvector. Integrate as an LLM tool that the model calls when needed. Display sources in a collapsible UI below assistant messages.

**Tech Stack:** Python/FastAPI, pgvector, OpenAI SDK (tool calling), React/TypeScript

---

## File Structure

**New files:**
- `backend/app/services/retrieval_service.py` — Vector search with similarity threshold
- `frontend/src/components/chat/SourcesList.tsx` — Collapsible citations UI

**Modified files:**
- `backend/app/services/llm_service.py` — Add tool definition and tool call handling
- `backend/app/routers/chat.py` — Orchestrate tool execution loop, store sources in metadata
- `frontend/src/types/index.ts` — Add Source type
- `frontend/src/components/chat/MessageList.tsx` — Render SourcesList for assistant messages

---

## Task 1: Retrieval Service

**Files:**
- Create: `backend/app/services/retrieval_service.py`

- [ ] **Step 1: Create retrieval service with search function**

```python
# backend/app/services/retrieval_service.py
from dataclasses import dataclass

from langsmith import traceable
from supabase import create_client

from app.config import settings
from app.services.embedding_service import embed_texts


@dataclass
class RetrievalResult:
    chunk_id: str
    document_id: str
    document_filename: str
    content: str
    chunk_index: int
    similarity: float


def _get_supabase():
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


@traceable(name="search_documents")
async def search_documents(
    query: str,
    user_id: str,
    threshold: float = 0.7,
    limit: int = 5,
) -> list[RetrievalResult]:
    """
    Search user's documents for relevant chunks.
    
    1. Embed the query
    2. Query pgvector with cosine similarity
    3. Filter by user_id and threshold
    4. Return top-k results with document metadata
    """
    embeddings = await embed_texts([query])
    if not embeddings:
        return []
    
    query_embedding = embeddings[0]
    
    supabase = _get_supabase()
    
    response = supabase.rpc(
        "search_chunks",
        {
            "query_embedding": query_embedding,
            "match_user_id": user_id,
            "match_threshold": threshold,
            "match_count": limit,
        }
    ).execute()
    
    if not response.data:
        return []
    
    return [
        RetrievalResult(
            chunk_id=row["chunk_id"],
            document_id=row["document_id"],
            document_filename=row["document_filename"],
            content=row["content"],
            chunk_index=row["chunk_index"],
            similarity=row["similarity"],
        )
        for row in response.data
    ]
```

- [ ] **Step 2: Create database function for vector search**

Create migration file `supabase/migrations/004_search_chunks_function.sql`:

```sql
-- Function to search chunks by vector similarity
create or replace function search_chunks(
    query_embedding vector(1536),
    match_user_id uuid,
    match_threshold float default 0.7,
    match_count int default 5
)
returns table (
    chunk_id uuid,
    document_id uuid,
    document_filename text,
    content text,
    chunk_index int,
    similarity float
)
language sql stable
as $$
    select
        c.id as chunk_id,
        c.document_id,
        d.filename as document_filename,
        c.content,
        c.chunk_index,
        1 - (c.embedding <=> query_embedding) as similarity
    from chunks c
    join documents d on c.document_id = d.id
    where d.user_id = match_user_id
      and d.status = 'completed'
      and 1 - (c.embedding <=> query_embedding) >= match_threshold
    order by c.embedding <=> query_embedding
    limit match_count;
$$;
```

- [ ] **Step 3: Apply the migration**

Run:
```powershell
docker exec -i supabase-db psql -U postgres -d postgres -f - < supabase/migrations/004_search_chunks_function.sql
```

Or if using Supabase CLI:
```powershell
supabase db push
```

- [ ] **Step 4: Test the retrieval service manually**

Create a test script `backend/test_retrieval.py`:

```python
import asyncio
from app.services.retrieval_service import search_documents

async def test():
    # Replace with a real user_id that has documents
    results = await search_documents(
        query="test query",
        user_id="your-test-user-id",
        threshold=0.5,  # Lower for testing
        limit=3,
    )
    print(f"Found {len(results)} results:")
    for r in results:
        print(f"  - {r.document_filename} (chunk {r.chunk_index}): {r.similarity:.2f}")
        print(f"    {r.content[:100]}...")

asyncio.run(test())
```

Run:
```powershell
cd backend
./venv/Scripts/python test_retrieval.py
```

Expected: Either results from existing documents or empty list if no documents match.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/services/retrieval_service.py supabase/migrations/004_search_chunks_function.sql
git commit -m "feat: add retrieval service with vector search"
```

---

## Task 2: LLM Tool Definition

**Files:**
- Modify: `backend/app/services/llm_service.py`

- [ ] **Step 1: Add tool definition constant**

Add at the top of `llm_service.py` after imports:

```python
SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "search_documents",
        "description": "Search the user's uploaded documents for relevant information. Use this when the user asks a question that might be answered by their documents.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query - what to look for in the documents"
                }
            },
            "required": ["query"]
        }
    }
}
```

- [ ] **Step 2: Add non-streaming completion function for tool calls**

Add this function to `llm_service.py`:

```python
@traceable(name="chat_completion_with_tools")
async def get_chat_completion_with_tools(
    messages: list[dict],
    user_id: str,
) -> dict:
    """
    Get a chat completion that may include tool calls.
    Returns the full response object (not streaming).
    """
    response = await client.chat.completions.create(
        model=_config.model,
        messages=messages,
        tools=[SEARCH_TOOL],
        user=user_id,
    )
    return response.choices[0].message
```

- [ ] **Step 3: Add function to continue after tool result**

Add this function to `llm_service.py`:

```python
@traceable(name="chat_completion_after_tool")
async def stream_chat_after_tool(
    messages: list[dict],
    user_id: str,
) -> AsyncGenerator[str, None]:
    """
    Stream a chat completion after tool results have been added.
    No tools offered - this is the final response.
    """
    response = await client.chat.completions.create(
        model=_config.model,
        messages=messages,
        stream=True,
        user=user_id,
    )
    
    async for chunk in response:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
```

- [ ] **Step 4: Commit**

```powershell
git add backend/app/services/llm_service.py
git commit -m "feat: add tool definition and tool-aware completions"
```

---

## Task 3: Chat Router Tool Orchestration

**Files:**
- Modify: `backend/app/routers/chat.py`

- [ ] **Step 1: Update imports**

Replace the imports at the top of `chat.py`:

```python
import json
from typing import AsyncGenerator

from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse
from supabase import Client, create_client

from app.config import settings
from app.dependencies import get_current_user
from app.models.chat import ChatRequest
from app.services.llm_service import (
    get_model_metadata,
    get_chat_completion_with_tools,
    stream_chat_after_tool,
    stream_chat_completion,
)
from app.services.retrieval_service import search_documents
```

- [ ] **Step 2: Create helper to format sources for metadata**

Add this helper function:

```python
def _format_sources_for_metadata(results) -> list[dict]:
    """Format retrieval results for message metadata."""
    return [
        {
            "chunk_id": r.chunk_id,
            "document_id": r.document_id,
            "document_filename": r.document_filename,
            "content": r.content[:200],  # First 200 chars
            "chunk_index": r.chunk_index,
            "similarity": round(r.similarity, 3),
        }
        for r in results
    ]
```

- [ ] **Step 3: Replace stream_chat endpoint with tool-aware version**

Replace the entire `stream_chat` function:

```python
@router.post("/stream")
async def stream_chat(
    request: ChatRequest,
    user: dict = Depends(get_current_user),
):
    supabase = get_supabase()
    
    thread_response = supabase.table("threads").select("*").eq("id", request.thread_id).eq("user_id", user["id"]).single().execute()
    if not thread_response.data:
        return EventSourceResponse(
            iter([json.dumps({"type": "error", "content": "Thread not found"})])
        )
    
    messages_response = supabase.table("messages").select("role, content").eq("thread_id", request.thread_id).order("created_at").execute()
    history = [{"role": m["role"], "content": m["content"]} for m in (messages_response.data or [])]
    
    history.append({"role": "user", "content": request.message})
    
    supabase.table("messages").insert({
        "thread_id": request.thread_id,
        "role": "user",
        "content": request.message,
    }).execute()
    
    async def event_generator() -> AsyncGenerator[str, None]:
        sources = []
        messages = history.copy()
        
        # First call - may include tool calls
        assistant_message = await get_chat_completion_with_tools(messages, user["id"])
        
        # Check if LLM wants to call a tool
        if assistant_message.tool_calls:
            # Add assistant message with tool calls to history
            messages.append({
                "role": "assistant",
                "content": assistant_message.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        }
                    }
                    for tc in assistant_message.tool_calls
                ]
            })
            
            # Execute each tool call
            for tool_call in assistant_message.tool_calls:
                if tool_call.function.name == "search_documents":
                    args = json.loads(tool_call.function.arguments)
                    results = await search_documents(
                        query=args["query"],
                        user_id=user["id"],
                    )
                    sources.extend(results)
                    
                    # Format results for LLM
                    if results:
                        tool_result = "\n\n".join([
                            f"From '{r.document_filename}' (chunk {r.chunk_index}, similarity: {r.similarity:.2f}):\n{r.content}"
                            for r in results
                        ])
                    else:
                        tool_result = "No relevant documents found."
                    
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": tool_result,
                    })
            
            # Stream final response after tool results
            full_response = ""
            async for chunk in stream_chat_after_tool(messages, user["id"]):
                full_response += chunk
                yield json.dumps({"type": "text", "content": chunk})
        else:
            # No tool calls - stream directly (fallback for simple queries)
            full_response = ""
            async for chunk in stream_chat_completion(history, user["id"], request.thread_id):
                full_response += chunk
                yield json.dumps({"type": "text", "content": chunk})
        
        # Build metadata
        metadata = get_model_metadata()
        if sources:
            metadata["sources"] = _format_sources_for_metadata(sources)
        
        supabase.table("messages").insert({
            "thread_id": request.thread_id,
            "role": "assistant",
            "content": full_response,
            "metadata": metadata,
        }).execute()
        
        supabase.table("threads").update({"updated_at": "now()"}).eq("id", request.thread_id).execute()
        
        yield json.dumps({"type": "done", "content": ""})
    
    return EventSourceResponse(event_generator())
```

- [ ] **Step 4: Commit**

```powershell
git add backend/app/routers/chat.py
git commit -m "feat: add tool orchestration to chat router"
```

---

## Task 4: Frontend Types

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Add Source type**

Add after the `Chunk` interface:

```typescript
export interface Source {
  chunk_id: string
  document_id: string
  document_filename: string
  content: string
  chunk_index: number
  similarity: number
}

export interface MessageMetadata {
  provider?: string
  model?: string
  sources?: Source[]
}
```

- [ ] **Step 2: Update Message interface to use typed metadata**

Change the `Message` interface:

```typescript
export interface Message {
  id: string
  thread_id: string
  role: 'user' | 'assistant'
  content: string
  metadata: MessageMetadata | null
  created_at: string
}
```

- [ ] **Step 3: Commit**

```powershell
git add frontend/src/types/index.ts
git commit -m "feat: add Source type and MessageMetadata interface"
```

---

## Task 5: SourcesList Component

**Files:**
- Create: `frontend/src/components/chat/SourcesList.tsx`

- [ ] **Step 1: Create the SourcesList component**

```typescript
// frontend/src/components/chat/SourcesList.tsx
import { useState } from 'react'
import type { Source } from '@/types'

interface SourcesListProps {
  sources: Source[]
}

export function SourcesList({ sources }: SourcesListProps) {
  const [expanded, setExpanded] = useState(false)
  const [expandedChunks, setExpandedChunks] = useState<Set<string>>(new Set())

  if (sources.length === 0) return null

  const toggleChunk = (chunkId: string) => {
    setExpandedChunks((prev) => {
      const next = new Set(prev)
      if (next.has(chunkId)) {
        next.delete(chunkId)
      } else {
        next.add(chunkId)
      }
      return next
    })
  }

  return (
    <div className="mt-2 border-t border-border pt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <svg
          className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
        Sources ({sources.length})
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {sources.map((source) => (
            <div
              key={source.chunk_id}
              className="rounded border border-border bg-background p-2 text-sm"
            >
              <div className="flex items-center justify-between">
                <button
                  onClick={() => toggleChunk(source.chunk_id)}
                  className="flex items-center gap-2 font-medium hover:underline"
                >
                  <span>{source.document_filename}</span>
                  <span className="text-muted-foreground">
                    (chunk {source.chunk_index + 1})
                  </span>
                </button>
                <span className="text-xs text-muted-foreground">
                  {Math.round(source.similarity * 100)}% match
                </span>
              </div>

              {expandedChunks.has(source.chunk_id) && (
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                  {source.content}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```powershell
git add frontend/src/components/chat/SourcesList.tsx
git commit -m "feat: add SourcesList component for citations"
```

---

## Task 6: Integrate SourcesList into MessageList

**Files:**
- Modify: `frontend/src/components/chat/MessageList.tsx`

- [ ] **Step 1: Import SourcesList**

Add import at the top:

```typescript
import { SourcesList } from './SourcesList'
```

- [ ] **Step 2: Render SourcesList for assistant messages**

Replace the message rendering in MessageList:

```typescript
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
```

- [ ] **Step 3: Commit**

```powershell
git add frontend/src/components/chat/MessageList.tsx
git commit -m "feat: integrate SourcesList into MessageList"
```

---

## Task 7: End-to-End Testing

**Files:**
- None (manual testing)

- [ ] **Step 1: Restart backend**

```powershell
cd backend
./venv/Scripts/uvicorn app.main:app --reload --port 8001
```

- [ ] **Step 2: Start frontend**

```powershell
cd frontend
npm run dev
```

- [ ] **Step 3: Test retrieval flow**

1. Upload a document in the Documents tab (if none exist)
2. Switch to Chat tab
3. Ask a question about the document content
4. Verify:
   - LLM calls the search tool (check LangSmith traces)
   - Response references the document content
   - "Sources (N)" appears below the response
   - Clicking expands to show source documents
   - Clicking a source shows the chunk content

- [ ] **Step 4: Test no-retrieval fallback**

1. Ask a simple question that doesn't need documents (e.g., "What is 2+2?")
2. Verify:
   - Response works without tool call
   - No sources section appears

- [ ] **Step 5: Update PROGRESS.md**

Add to Module 2 Phase 3 section:

```markdown
#### Phase 3: Retrieval ✅
- [x] Vector search service (retrieval_service.py)
- [x] search_chunks database function
- [x] Tool definition in llm_service.py
- [x] Tool orchestration in chat router
- [x] Source/MessageMetadata types
- [x] SourcesList component
- [x] Citations in MessageList

**Validated:**
- LLM calls search_documents tool when appropriate
- Vector search with similarity threshold working
- Sources displayed in collapsible UI
- Chunk content expandable
```

- [ ] **Step 6: Commit progress update**

```powershell
git add PROGRESS.md
git commit -m "docs: mark Module 2 Phase 3 as complete"
```

---

## Summary

| Task | Description | New Files | Modified Files |
|------|-------------|-----------|----------------|
| 1 | Retrieval Service | `retrieval_service.py`, `004_*.sql` | - |
| 2 | LLM Tool Definition | - | `llm_service.py` |
| 3 | Chat Router Tool Orchestration | - | `chat.py` |
| 4 | Frontend Types | - | `types/index.ts` |
| 5 | SourcesList Component | `SourcesList.tsx` | - |
| 6 | Integrate SourcesList | - | `MessageList.tsx` |
| 7 | End-to-End Testing | - | `PROGRESS.md` |
