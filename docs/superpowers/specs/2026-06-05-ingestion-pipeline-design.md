# Ingestion Pipeline Design

Module 2 Phase 2: Document upload, chunking, embeddings, pgvector storage, and document management.

## Decisions

- **File types**: Text-only (`.txt`, `.md`) — multi-format support deferred to Module 5
- **Embedding provider**: Dedicated config (`EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, etc.) independent from chat LLM
- **Chunking strategy**: Recursive character splitting (paragraphs → sentences → words → characters) with configurable size/overlap
- **UI integration**: Tab-based navigation ("Chat" | "Documents") in existing Layout
- **Document management**: Full CRUD — upload, list, delete, view chunks, re-process
- **Processing model**: Synchronous with SSE progress streaming — no background workers

## Database Schema

### documents table

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto-generated |
| user_id | uuid | FK → auth.users, cascade delete |
| filename | text | Original filename |
| storage_path | text | Supabase Storage path |
| file_size | bigint | Bytes |
| mime_type | text | `text/plain` or `text/markdown` |
| status | text | `pending`, `processing`, `completed`, `failed` |
| error_message | text | Nullable, failure reason |
| chunk_count | int | Updated after processing, default 0 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### chunks table

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, auto-generated |
| document_id | uuid | FK → documents, cascade delete |
| content | text | Chunk text |
| chunk_index | int | Order within document (0-based) |
| embedding | vector(1536) | pgvector, 1536 dimensions (OpenAI default, change if using different model) |
| metadata | jsonb | `{start_pos, end_pos}` |
| created_at | timestamptz | |

### RLS Policies

Documents:
- SELECT: `auth.uid() = user_id`
- INSERT: `auth.uid() = user_id`
- UPDATE: `auth.uid() = user_id`
- DELETE: `auth.uid() = user_id`

Chunks:
- SELECT: via document ownership subquery
- INSERT: via document ownership subquery
- DELETE: via document ownership subquery (cascade handles most)

### Indexes

- `documents(user_id)` — filter by user
- `documents(status)` — filter by status
- `chunks(document_id)` — cascade operations, chunk listing
- HNSW on `chunks(embedding)` — vector similarity search

## Backend Services

### Configuration (`config.py`)

New settings:
```python
# Embedding provider
embedding_provider: EmbeddingProvider = EmbeddingProvider.OPENAI
embedding_api_key: str = ""
embedding_model: Optional[str] = None  # default: text-embedding-3-small
embedding_base_url: Optional[str] = None
embedding_dimensions: int = 1536

# Chunking
chunk_size: int = 1000  # characters
chunk_overlap: int = 200  # characters
```

### chunking_service.py

```python
@dataclass
class Chunk:
    content: str
    index: int
    start_pos: int
    end_pos: int

def chunk_text(content: str) -> list[Chunk]:
    """Recursive character splitting with configurable size/overlap."""
```

Splitting priority:
1. Double newlines (paragraphs)
2. Single newlines
3. Sentence endings (`. `, `! `, `? `)
4. Spaces (words)
5. Characters (last resort)

### embedding_service.py

```python
def resolve_embedding_config() -> EmbeddingConfig:
    """Resolve embedding config from settings + presets."""

async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Batch embed texts using configured provider."""
```

Provider presets (same pattern as LLM):
- OpenAI: default endpoint, `text-embedding-3-small`
- Ollama: `http://localhost:11434/v1`, `nomic-embed-text`
- Custom: user-defined

### ingestion_service.py

```python
async def ingest_document(
    document_id: str, 
    user_id: str,
    on_progress: Callable[[str, Any], None]
) -> None:
    """
    Orchestrate: download → chunk → embed → store.
    Calls on_progress with status updates for SSE.
    """
```

Pipeline stages:
1. Download file from Supabase Storage
2. Chunk text content
3. Batch embed chunks
4. Store chunks with embeddings
5. Update document status and chunk_count

## API Endpoints

### Router: `routers/documents.py`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/documents/upload` | Upload file, trigger ingestion, SSE progress |
| GET | `/documents` | List user's documents |
| GET | `/documents/{id}` | Get single document |
| DELETE | `/documents/{id}` | Delete document + file + chunks |
| GET | `/documents/{id}/chunks` | List chunks (paginated) |
| POST | `/documents/{id}/reprocess` | Re-chunk and re-embed |

### Upload Request

```
POST /documents/upload
Content-Type: multipart/form-data

file: <binary>
```

### SSE Response (Upload)

```
data: {"status": "uploading"}
data: {"status": "chunking", "chunk_count": 12}
data: {"status": "embedding", "progress": 50}
data: {"status": "embedding", "progress": 100}
data: {"status": "completed", "document_id": "uuid"}
```

### List Documents Response

```json
{
  "documents": [
    {
      "id": "uuid",
      "filename": "notes.txt",
      "file_size": 4096,
      "mime_type": "text/plain",
      "status": "completed",
      "chunk_count": 5,
      "created_at": "2026-06-05T10:00:00Z"
    }
  ]
}
```

### List Chunks Response

```json
{
  "chunks": [
    {
      "id": "uuid",
      "chunk_index": 0,
      "content": "...",
      "metadata": {"start_pos": 0, "end_pos": 1000}
    }
  ],
  "total": 12,
  "page": 1,
  "page_size": 20
}
```

## Supabase Storage

- **Bucket**: `documents` (private)
- **Path pattern**: `{user_id}/{document_id}/{filename}`
- **Allowed MIME types**: `text/plain`, `text/markdown`
- **RLS**: Users can only access their own paths

Storage bucket config in `config.toml`:
```toml
[storage.buckets.documents]
public = false
file_size_limit = "50MiB"
allowed_mime_types = ["text/plain", "text/markdown"]
```

## Frontend Components

### Layout Changes

Add tab navigation to `Layout.tsx`:
- "Chat" tab → existing ThreadList + ChatInterface
- "Documents" tab → new DocumentsView

### New Components

**DocumentsView.tsx** — Main documents interface
- Upload dropzone with file picker
- Upload progress indicator (SSE status)
- Document table with actions

**DocumentRow.tsx** — Single document in table
- Filename, status badge, chunk count, date
- Expand/collapse to show chunks
- Delete and reprocess action buttons

**ChunkList.tsx** — Paginated chunk viewer
- Shows chunk index and content preview
- Expand to see full content
- Pagination controls

**UploadZone.tsx** — Drag-and-drop file upload
- Visual drop indicator
- File type validation
- Triggers upload on drop/select

### New Hooks

**useDocuments.ts**
```typescript
function useDocuments(): {
  documents: Document[]
  loading: boolean
  error: Error | null
  refresh: () => void
  deleteDocument: (id: string) => Promise<void>
  reprocessDocument: (id: string) => Promise<void>
}
```

**useUpload.ts**
```typescript
function useUpload(): {
  upload: (file: File) => void
  status: UploadStatus | null
  progress: number
  error: Error | null
}
```

**useChunks.ts**
```typescript
function useChunks(documentId: string): {
  chunks: Chunk[]
  total: number
  page: number
  setPage: (page: number) => void
  loading: boolean
}
```

### Types

```typescript
interface Document {
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

interface Chunk {
  id: string
  document_id: string
  content: string
  chunk_index: number
  metadata: { start_pos: number; end_pos: number }
  created_at: string
}

type UploadStatus = 'uploading' | 'chunking' | 'embedding' | 'completed' | 'failed'
```

## File Structure

### Backend (new files)

```
backend/app/
├── services/
│   ├── chunking_service.py    # NEW
│   ├── embedding_service.py   # NEW
│   └── ingestion_service.py   # NEW
└── routers/
    └── documents.py           # NEW
```

### Frontend (new files)

```
frontend/src/
├── components/
│   └── documents/
│       ├── DocumentsView.tsx  # NEW
│       ├── DocumentRow.tsx    # NEW
│       ├── ChunkList.tsx      # NEW
│       └── UploadZone.tsx     # NEW
├── hooks/
│   ├── useDocuments.ts        # NEW
│   ├── useUpload.ts           # NEW
│   └── useChunks.ts           # NEW
└── types/
    └── index.ts               # UPDATE: add Document, Chunk types
```

### Database (new migration)

```
supabase/migrations/
└── 003_documents_and_chunks.sql  # NEW
```

## Error Handling

- **Upload failures**: Return error in SSE stream, set document status to `failed`
- **Chunking errors**: Set status to `failed`, store error message
- **Embedding errors**: Set status to `failed`, store error message
- **Storage errors**: Return HTTP error before document creation
- **Reprocess failures**: Reset to `failed` status, preserve original chunks until success
