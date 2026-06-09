# Retrieval Design

Module 2 Phase 3: Vector search service, tool-based retrieval for chat, and citation display.

## Decisions

- **Retrieval approach**: Tool-based — LLM decides when to call `search_documents` tool
- **Relevance filtering**: Cosine similarity threshold (0.7 minimum)
- **Result limit**: Maximum 5 chunks per search
- **Citations**: Collapsible "Sources" section below assistant messages
- **Implementation**: Python retrieval service with parameterized SQL queries

## Retrieval Service

**File:** `backend/app/services/retrieval_service.py`

```python
@dataclass
class RetrievalResult:
    chunk_id: str
    document_id: str
    document_filename: str
    content: str
    chunk_index: int
    similarity: float

@traceable(name="search_documents")
async def search_documents(
    query: str,
    user_id: str,
    threshold: float = 0.7,
    limit: int = 5
) -> list[RetrievalResult]:
    """
    1. Embed the query using embedding_service
    2. Query pgvector with cosine similarity (parameterized)
    3. Filter by user_id and threshold
    4. Return top-k results with document metadata
    """
```

**SQL Query (parameterized):**
```sql
SELECT 
    c.id as chunk_id,
    c.document_id,
    d.filename as document_filename,
    c.content,
    c.chunk_index,
    1 - (c.embedding <=> $1) as similarity
FROM chunks c
JOIN documents d ON c.document_id = d.id
WHERE d.user_id = $2
  AND d.status = 'completed'
  AND 1 - (c.embedding <=> $1) >= $3
ORDER BY c.embedding <=> $1
LIMIT $4
```

**Security:**
- Parameterized queries prevent SQL injection
- Explicit `user_id` filter (backend uses service role, bypasses RLS)
- Same pattern as existing `chat.py` and `documents.py`

**Performance:**
- Uses HNSW index on `chunks.embedding`
- Single query with join — no N+1

## Tool Integration

**Tool definition:**
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

**Chat flow:**
1. Send messages to LLM with `tools=[SEARCH_TOOL]`
2. If LLM responds with tool call → execute `retrieval_service.search_documents()`
3. Send tool result back to LLM as tool response message
4. LLM generates final response using retrieved context
5. Store sources in message metadata

**Changes to `llm_service.py`:**
- Add `SEARCH_TOOL` definition
- Modify `stream_chat_completion` to accept `tools` parameter
- Handle tool call responses (non-streaming intermediate step)

**Changes to `chat.py`:**
- Detect tool calls in LLM response
- Execute retrieval and continue conversation
- Collect sources for metadata storage

## Message Metadata

**Structure:**
```json
{
  "provider": "openrouter",
  "model": "gpt-4o-mini",
  "sources": [
    {
      "chunk_id": "uuid",
      "document_id": "uuid",
      "document_filename": "notes.txt",
      "content": "First 200 chars of chunk...",
      "chunk_index": 2,
      "similarity": 0.85
    }
  ]
}
```

No database schema changes — uses existing `metadata` JSONB column on messages.

## Frontend Components

### Type Updates (`types/index.ts`)

```typescript
interface Source {
  chunk_id: string
  document_id: string
  document_filename: string
  content: string
  chunk_index: number
  similarity: number
}

interface MessageMetadata {
  provider?: string
  model?: string
  sources?: Source[]
}
```

### SourcesList Component

**File:** `frontend/src/components/chat/SourcesList.tsx`

Collapsible accordion showing retrieved sources:
- Header: "Sources (N)" with expand/collapse chevron
- Each source: filename, chunk index, similarity percentage
- Expandable content preview (first 200 chars, click for full)

### MessageList Changes

Render `<SourcesList>` below assistant messages when `metadata.sources` exists.

## File Structure

**New files:**
```
backend/app/services/retrieval_service.py
frontend/src/components/chat/SourcesList.tsx
```

**Modified files:**
```
backend/app/services/llm_service.py  # Add tool definition, handle tool calls
backend/app/routers/chat.py          # Orchestrate tool execution, store sources
frontend/src/types/index.ts          # Add Source, update MessageMetadata
frontend/src/components/chat/MessageList.tsx  # Render SourcesList
```

## Configuration

No new env vars for Phase 3. Threshold (0.7) and limit (5) are hardcoded defaults — can be made configurable in a future iteration if needed.

## Error Handling

- **No documents**: Tool returns empty array, LLM responds without document context
- **Embedding failure**: Tool returns error message, LLM can explain it couldn't search
- **All results below threshold**: Empty array returned, same as no documents
