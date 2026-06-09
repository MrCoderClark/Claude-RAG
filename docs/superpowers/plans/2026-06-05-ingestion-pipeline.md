# Ingestion Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build document upload, chunking, embedding, and management for the RAG system.

**Architecture:** Synchronous processing pipeline with SSE progress streaming. Documents uploaded to Supabase Storage, chunked via recursive character splitting, embedded via configurable provider, stored with pgvector. Tab-based UI separates Chat from Documents.

**Tech Stack:** FastAPI, Supabase (Storage, pgvector), OpenAI Embeddings API, React, Tailwind, shadcn/ui

---

## File Structure

### Backend

| File | Responsibility |
|------|----------------|
| `backend/app/config.py` | Add EmbeddingProvider enum, embedding/chunking settings |
| `backend/app/services/chunking_service.py` | Recursive text splitting with overlap |
| `backend/app/services/embedding_service.py` | Provider-agnostic embedding client |
| `backend/app/services/ingestion_service.py` | Orchestrate download → chunk → embed → store |
| `backend/app/routers/documents.py` | Document CRUD + upload endpoints |
| `backend/app/models/documents.py` | Pydantic models for requests/responses |
| `backend/app/main.py` | Register documents router |
| `backend/requirements.txt` | Add python-multipart |

### Frontend

| File | Responsibility |
|------|----------------|
| `frontend/src/types/index.ts` | Add Document, Chunk, UploadStatus types |
| `frontend/src/lib/api.ts` | Add document API functions |
| `frontend/src/hooks/useDocuments.ts` | Fetch/manage document list |
| `frontend/src/hooks/useUpload.ts` | Handle file upload with SSE |
| `frontend/src/hooks/useChunks.ts` | Fetch paginated chunks |
| `frontend/src/components/documents/UploadZone.tsx` | Drag-and-drop upload area |
| `frontend/src/components/documents/DocumentRow.tsx` | Single document with expand/actions |
| `frontend/src/components/documents/ChunkList.tsx` | Paginated chunk viewer |
| `frontend/src/components/documents/DocumentsView.tsx` | Main documents tab content |
| `frontend/src/components/Layout.tsx` | Add tab navigation |

### Database

| File | Responsibility |
|------|----------------|
| `supabase/migrations/003_documents_and_chunks.sql` | Tables, RLS, indexes |
| `supabase/config.toml` | Storage bucket configuration |
| `backend/.env.example` | New embedding/chunking env vars |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/003_documents_and_chunks.sql`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Create migration file**

Create `supabase/migrations/003_documents_and_chunks.sql`:

```sql
-- Enable pgvector extension
create extension if not exists vector;

-- Documents table
create table documents (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null references auth.users(id) on delete cascade,
    filename text not null,
    storage_path text not null,
    file_size bigint not null,
    mime_type text not null check (mime_type in ('text/plain', 'text/markdown')),
    status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
    error_message text,
    chunk_count int not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Chunks table
create table chunks (
    id uuid primary key default uuid_generate_v4(),
    document_id uuid not null references documents(id) on delete cascade,
    content text not null,
    chunk_index int not null,
    embedding vector(1536),
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now()
);

-- Indexes
create index documents_user_id_idx on documents(user_id);
create index documents_status_idx on documents(status);
create index chunks_document_id_idx on chunks(document_id);

-- HNSW index for vector similarity search
create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);

-- Enable RLS
alter table documents enable row level security;
alter table chunks enable row level security;

-- RLS Policies for documents
create policy "Users can view their own documents"
    on documents for select
    using (auth.uid() = user_id);

create policy "Users can create their own documents"
    on documents for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own documents"
    on documents for update
    using (auth.uid() = user_id);

create policy "Users can delete their own documents"
    on documents for delete
    using (auth.uid() = user_id);

-- RLS Policies for chunks
create policy "Users can view chunks of their documents"
    on chunks for select
    using (
        exists (
            select 1 from documents
            where documents.id = chunks.document_id
            and documents.user_id = auth.uid()
        )
    );

create policy "Users can create chunks for their documents"
    on chunks for insert
    with check (
        exists (
            select 1 from documents
            where documents.id = chunks.document_id
            and documents.user_id = auth.uid()
        )
    );

create policy "Users can delete chunks of their documents"
    on chunks for delete
    using (
        exists (
            select 1 from documents
            where documents.id = chunks.document_id
            and documents.user_id = auth.uid()
        )
    );
```

- [ ] **Step 2: Add storage bucket config**

Add to `supabase/config.toml` after the existing `[storage]` section:

```toml
[storage.buckets.documents]
public = false
file_size_limit = "50MiB"
allowed_mime_types = ["text/plain", "text/markdown"]
```

- [ ] **Step 3: Apply migration locally**

Run: `supabase db reset` (if local) or apply migration via Supabase dashboard.

Expected: Tables `documents` and `chunks` created with RLS policies.

- [ ] **Step 4: Verify migration**

Run in Supabase SQL Editor:
```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('documents', 'chunks');
```

Expected: Both tables listed.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/003_documents_and_chunks.sql supabase/config.toml
git commit -m "feat: add documents and chunks tables with pgvector"
```

---

## Task 2: Backend Configuration

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/.env.example`

- [ ] **Step 1: Add EmbeddingProvider enum and presets**

Add to `backend/app/config.py` after the `PROVIDER_PRESETS` dict:

```python
class EmbeddingProvider(str, Enum):
    OPENAI = "openai"
    OLLAMA = "ollama"
    CUSTOM = "custom"


EMBEDDING_PRESETS = {
    EmbeddingProvider.OPENAI: {
        "base_url": None,
        "default_model": "text-embedding-3-small",
        "requires_key": True,
    },
    EmbeddingProvider.OLLAMA: {
        "base_url": "http://localhost:11434/v1",
        "default_model": "nomic-embed-text",
        "requires_key": False,
    },
}
```

- [ ] **Step 2: Add embedding and chunking settings to Settings class**

Add these fields to the `Settings` class in `backend/app/config.py`:

```python
    # Embedding settings
    embedding_provider: EmbeddingProvider = EmbeddingProvider.OPENAI
    embedding_api_key: str = ""
    embedding_model: Optional[str] = None
    embedding_base_url: Optional[str] = None
    embedding_dimensions: int = 1536

    # Chunking settings
    chunk_size: int = 1000
    chunk_overlap: int = 200
```

- [ ] **Step 3: Update backend/.env.example**

Add to `backend/.env.example`:

```env
# Embedding Provider: openai, ollama, custom
EMBEDDING_PROVIDER=openai
EMBEDDING_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
# EMBEDDING_BASE_URL=  # Optional: override for custom endpoints
EMBEDDING_DIMENSIONS=1536

# Chunking
CHUNK_SIZE=1000
CHUNK_OVERLAP=200
```

- [ ] **Step 4: Verify config loads**

Run: `cd backend && python -c "from app.config import settings; print(settings.embedding_provider)"`

Expected: `EmbeddingProvider.OPENAI` (or your configured value)

- [ ] **Step 5: Commit**

```bash
git add backend/app/config.py backend/.env.example
git commit -m "feat: add embedding and chunking configuration"
```

---

## Task 3: Chunking Service

**Files:**
- Create: `backend/app/services/chunking_service.py`

- [ ] **Step 1: Create chunking service with Chunk dataclass**

Create `backend/app/services/chunking_service.py`:

```python
from dataclasses import dataclass

from app.config import settings


@dataclass
class Chunk:
    content: str
    index: int
    start_pos: int
    end_pos: int


SEPARATORS = [
    "\n\n",  # Paragraphs
    "\n",    # Lines
    ". ",    # Sentences
    "! ",
    "? ",
    " ",     # Words
    "",      # Characters (last resort)
]


def _split_text(text: str, separator: str) -> list[str]:
    if separator == "":
        return list(text)
    return text.split(separator)


def _recursive_split(
    text: str,
    chunk_size: int,
    separators: list[str],
) -> list[str]:
    if len(text) <= chunk_size:
        return [text] if text.strip() else []

    separator = separators[0]
    remaining_separators = separators[1:] if len(separators) > 1 else [""]

    parts = _split_text(text, separator)
    
    chunks = []
    current_chunk = ""
    
    for part in parts:
        joiner = separator if separator else ""
        candidate = current_chunk + joiner + part if current_chunk else part
        
        if len(candidate) <= chunk_size:
            current_chunk = candidate
        else:
            if current_chunk:
                chunks.append(current_chunk)
            if len(part) > chunk_size:
                chunks.extend(_recursive_split(part, chunk_size, remaining_separators))
                current_chunk = ""
            else:
                current_chunk = part
    
    if current_chunk:
        chunks.append(current_chunk)
    
    return chunks


def chunk_text(content: str) -> list[Chunk]:
    chunk_size = settings.chunk_size
    chunk_overlap = settings.chunk_overlap
    
    raw_chunks = _recursive_split(content, chunk_size, SEPARATORS)
    
    chunks = []
    pos = 0
    
    for i, raw_chunk in enumerate(raw_chunks):
        start_pos = content.find(raw_chunk, pos)
        if start_pos == -1:
            start_pos = pos
        end_pos = start_pos + len(raw_chunk)
        
        chunks.append(Chunk(
            content=raw_chunk,
            index=i,
            start_pos=start_pos,
            end_pos=end_pos,
        ))
        
        pos = max(pos, end_pos - chunk_overlap)
    
    return chunks
```

- [ ] **Step 2: Test chunking manually**

Run:
```bash
cd backend && python -c "
from app.services.chunking_service import chunk_text
text = 'First paragraph here.\n\nSecond paragraph with more content.\n\nThird paragraph.'
chunks = chunk_text(text)
for c in chunks:
    print(f'Chunk {c.index}: {c.start_pos}-{c.end_pos} = {repr(c.content[:50])}')"
```

Expected: Multiple chunks printed with correct positions.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/chunking_service.py
git commit -m "feat: add recursive chunking service"
```

---

## Task 4: Embedding Service

**Files:**
- Create: `backend/app/services/embedding_service.py`

- [ ] **Step 1: Create embedding service**

Create `backend/app/services/embedding_service.py`:

```python
import os
from dataclasses import dataclass
from typing import Optional

from langsmith import traceable
from langsmith.wrappers import wrap_openai
from openai import AsyncOpenAI

from app.config import EmbeddingProvider, EMBEDDING_PRESETS, settings

os.environ["LANGSMITH_API_KEY"] = settings.langsmith_api_key
os.environ["LANGSMITH_PROJECT"] = settings.langsmith_project


@dataclass
class EmbeddingConfig:
    provider: EmbeddingProvider
    base_url: Optional[str]
    api_key: str
    model: str
    dimensions: int


def resolve_embedding_config() -> EmbeddingConfig:
    provider = settings.embedding_provider
    preset = EMBEDDING_PRESETS.get(provider, {})

    api_key = settings.embedding_api_key

    if settings.embedding_base_url:
        base_url = settings.embedding_base_url
    elif provider == EmbeddingProvider.CUSTOM:
        base_url = settings.embedding_base_url
    else:
        base_url = preset.get("base_url")

    model = settings.embedding_model or preset.get("default_model", "text-embedding-3-small")
    dimensions = settings.embedding_dimensions

    return EmbeddingConfig(
        provider=provider,
        base_url=base_url,
        api_key=api_key,
        model=model,
        dimensions=dimensions,
    )


_config = resolve_embedding_config()

_client_kwargs = {"api_key": _config.api_key or "not-needed"}
if _config.base_url:
    _client_kwargs["base_url"] = _config.base_url

client = wrap_openai(AsyncOpenAI(**_client_kwargs))


@traceable(name="embed_texts")
async def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    
    response = await client.embeddings.create(
        model=_config.model,
        input=texts,
        dimensions=_config.dimensions,
    )
    
    return [item.embedding for item in response.data]


def get_embedding_dimensions() -> int:
    return _config.dimensions
```

- [ ] **Step 2: Test embedding service**

Run (requires valid API key in .env):
```bash
cd backend && python -c "
import asyncio
from app.services.embedding_service import embed_texts
result = asyncio.run(embed_texts(['Hello world']))
print(f'Embedding length: {len(result[0])}')"
```

Expected: `Embedding length: 1536`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/embedding_service.py
git commit -m "feat: add provider-agnostic embedding service"
```

---

## Task 5: Document Models

**Files:**
- Create: `backend/app/models/documents.py`

- [ ] **Step 1: Create document models**

Create `backend/app/models/documents.py`:

```python
from typing import Literal, Optional

from pydantic import BaseModel


class DocumentResponse(BaseModel):
    id: str
    user_id: str
    filename: str
    storage_path: str
    file_size: int
    mime_type: str
    status: Literal["pending", "processing", "completed", "failed"]
    error_message: Optional[str]
    chunk_count: int
    created_at: str
    updated_at: str


class DocumentListResponse(BaseModel):
    documents: list[DocumentResponse]


class ChunkResponse(BaseModel):
    id: str
    document_id: str
    content: str
    chunk_index: int
    metadata: dict
    created_at: str


class ChunkListResponse(BaseModel):
    chunks: list[ChunkResponse]
    total: int
    page: int
    page_size: int


class UploadProgressEvent(BaseModel):
    status: Literal["uploading", "chunking", "embedding", "completed", "failed"]
    document_id: Optional[str] = None
    chunk_count: Optional[int] = None
    progress: Optional[int] = None
    error: Optional[str] = None
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/models/documents.py
git commit -m "feat: add document and chunk Pydantic models"
```

---

## Task 6: Ingestion Service

**Files:**
- Create: `backend/app/services/ingestion_service.py`

- [ ] **Step 1: Create ingestion service**

Create `backend/app/services/ingestion_service.py`:

```python
from typing import Any, Callable

from supabase import Client

from app.services.chunking_service import chunk_text
from app.services.embedding_service import embed_texts


async def ingest_document(
    supabase: Client,
    document_id: str,
    user_id: str,
    on_progress: Callable[[str, dict[str, Any]], None],
) -> None:
    try:
        doc_response = supabase.table("documents").select("*").eq("id", document_id).eq("user_id", user_id).single().execute()
        doc = doc_response.data
        if not doc:
            raise ValueError("Document not found")

        supabase.table("documents").update({"status": "processing"}).eq("id", document_id).execute()

        on_progress("chunking", {})
        file_response = supabase.storage.from_("documents").download(doc["storage_path"])
        content = file_response.decode("utf-8")

        chunks = chunk_text(content)
        on_progress("chunking", {"chunk_count": len(chunks)})

        if not chunks:
            supabase.table("documents").update({
                "status": "completed",
                "chunk_count": 0,
            }).eq("id", document_id).execute()
            on_progress("completed", {"document_id": document_id, "chunk_count": 0})
            return

        on_progress("embedding", {"progress": 0})
        
        batch_size = 100
        all_embeddings = []
        
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            batch_texts = [c.content for c in batch]
            embeddings = await embed_texts(batch_texts)
            all_embeddings.extend(embeddings)
            
            progress = min(100, int((i + len(batch)) / len(chunks) * 100))
            on_progress("embedding", {"progress": progress})

        chunk_records = []
        for chunk, embedding in zip(chunks, all_embeddings):
            chunk_records.append({
                "document_id": document_id,
                "content": chunk.content,
                "chunk_index": chunk.index,
                "embedding": embedding,
                "metadata": {"start_pos": chunk.start_pos, "end_pos": chunk.end_pos},
            })

        supabase.table("chunks").insert(chunk_records).execute()

        supabase.table("documents").update({
            "status": "completed",
            "chunk_count": len(chunks),
        }).eq("id", document_id).execute()

        on_progress("completed", {"document_id": document_id, "chunk_count": len(chunks)})

    except Exception as e:
        supabase.table("documents").update({
            "status": "failed",
            "error_message": str(e),
        }).eq("id", document_id).execute()
        on_progress("failed", {"error": str(e)})
        raise


async def reprocess_document(
    supabase: Client,
    document_id: str,
    user_id: str,
    on_progress: Callable[[str, dict[str, Any]], None],
) -> None:
    supabase.table("chunks").delete().eq("document_id", document_id).execute()
    
    await ingest_document(supabase, document_id, user_id, on_progress)
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/ingestion_service.py
git commit -m "feat: add document ingestion orchestration service"
```

---

## Task 7: Documents Router

**Files:**
- Create: `backend/app/routers/documents.py`
- Modify: `backend/app/main.py`
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add python-multipart dependency**

Add to `backend/requirements.txt`:

```
python-multipart==0.0.20
```

Run: `cd backend && pip install python-multipart==0.0.20`

- [ ] **Step 2: Create documents router**

Create `backend/app/routers/documents.py`:

```python
import json
import mimetypes
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sse_starlette.sse import EventSourceResponse
from supabase import Client, create_client

from app.config import settings
from app.dependencies import get_current_user
from app.models.documents import (
    ChunkListResponse,
    ChunkResponse,
    DocumentListResponse,
    DocumentResponse,
)
from app.services.ingestion_service import ingest_document, reprocess_document

router = APIRouter(prefix="/documents", tags=["documents"])


def get_supabase() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


ALLOWED_MIME_TYPES = {"text/plain", "text/markdown"}


def get_mime_type(filename: str) -> str:
    mime_type, _ = mimetypes.guess_type(filename)
    if filename.endswith(".md"):
        return "text/markdown"
    return mime_type or "application/octet-stream"


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    mime_type = get_mime_type(file.filename or "file.txt")
    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(400, f"File type not allowed. Allowed: {', '.join(ALLOWED_MIME_TYPES)}")

    supabase = get_supabase()
    content = await file.read()
    file_size = len(content)
    document_id = str(uuid.uuid4())
    storage_path = f"{user['id']}/{document_id}/{file.filename}"

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            yield json.dumps({"status": "uploading"})

            supabase.storage.from_("documents").upload(storage_path, content)

            doc_data = {
                "id": document_id,
                "user_id": user["id"],
                "filename": file.filename,
                "storage_path": storage_path,
                "file_size": file_size,
                "mime_type": mime_type,
                "status": "pending",
            }
            supabase.table("documents").insert(doc_data).execute()

            def on_progress(status: str, data: dict):
                pass

            progress_events = []

            def capture_progress(status: str, data: dict):
                progress_events.append({"status": status, **data})

            await ingest_document(supabase, document_id, user["id"], capture_progress)

            for event in progress_events:
                yield json.dumps(event)

        except Exception as e:
            yield json.dumps({"status": "failed", "error": str(e)})

    return EventSourceResponse(event_generator())


@router.get("", response_model=DocumentListResponse)
async def list_documents(user: dict = Depends(get_current_user)):
    supabase = get_supabase()
    response = supabase.table("documents").select("*").eq("user_id", user["id"]).order("created_at", desc=True).execute()
    
    documents = [DocumentResponse(**doc) for doc in response.data]
    return DocumentListResponse(documents=documents)


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(document_id: str, user: dict = Depends(get_current_user)):
    supabase = get_supabase()
    response = supabase.table("documents").select("*").eq("id", document_id).eq("user_id", user["id"]).single().execute()
    
    if not response.data:
        raise HTTPException(404, "Document not found")
    
    return DocumentResponse(**response.data)


@router.delete("/{document_id}")
async def delete_document(document_id: str, user: dict = Depends(get_current_user)):
    supabase = get_supabase()
    
    doc_response = supabase.table("documents").select("storage_path").eq("id", document_id).eq("user_id", user["id"]).single().execute()
    if not doc_response.data:
        raise HTTPException(404, "Document not found")
    
    storage_path = doc_response.data["storage_path"]
    
    supabase.table("documents").delete().eq("id", document_id).execute()
    
    try:
        supabase.storage.from_("documents").remove([storage_path])
    except Exception:
        pass
    
    return {"status": "deleted"}


@router.get("/{document_id}/chunks", response_model=ChunkListResponse)
async def list_chunks(
    document_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    supabase = get_supabase()
    
    doc_response = supabase.table("documents").select("id").eq("id", document_id).eq("user_id", user["id"]).single().execute()
    if not doc_response.data:
        raise HTTPException(404, "Document not found")
    
    offset = (page - 1) * page_size
    
    count_response = supabase.table("chunks").select("id", count="exact").eq("document_id", document_id).execute()
    total = count_response.count or 0
    
    chunks_response = supabase.table("chunks").select("id, document_id, content, chunk_index, metadata, created_at").eq("document_id", document_id).order("chunk_index").range(offset, offset + page_size - 1).execute()
    
    chunks = [ChunkResponse(**chunk) for chunk in chunks_response.data]
    
    return ChunkListResponse(chunks=chunks, total=total, page=page, page_size=page_size)


@router.post("/{document_id}/reprocess")
async def reprocess_document_endpoint(
    document_id: str,
    user: dict = Depends(get_current_user),
):
    supabase = get_supabase()
    
    doc_response = supabase.table("documents").select("*").eq("id", document_id).eq("user_id", user["id"]).single().execute()
    if not doc_response.data:
        raise HTTPException(404, "Document not found")

    async def event_generator() -> AsyncGenerator[str, None]:
        progress_events = []

        def capture_progress(status: str, data: dict):
            progress_events.append({"status": status, **data})

        try:
            await reprocess_document(supabase, document_id, user["id"], capture_progress)
            for event in progress_events:
                yield json.dumps(event)
        except Exception as e:
            yield json.dumps({"status": "failed", "error": str(e)})

    return EventSourceResponse(event_generator())
```

- [ ] **Step 3: Register documents router in main.py**

Modify `backend/app/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import chat, documents

app = FastAPI(title="RAG Chat API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router)
app.include_router(documents.router)


@app.get("/health")
async def health():
    return {"status": "healthy"}
```

- [ ] **Step 4: Test API starts**

Run: `cd backend && ./venv/Scripts/uvicorn app.main:app --reload --port 8001`

Expected: Server starts without errors, `/docs` shows new document endpoints.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/documents.py backend/app/main.py backend/requirements.txt
git commit -m "feat: add documents router with upload, CRUD, and reprocess"
```

---

## Task 8: Frontend Types

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Add Document and Chunk types**

Add to `frontend/src/types/index.ts`:

```typescript
export interface Document {
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

export interface Chunk {
  id: string
  document_id: string
  content: string
  chunk_index: number
  metadata: { start_pos: number; end_pos: number }
  created_at: string
}

export type UploadStatus = 'uploading' | 'chunking' | 'embedding' | 'completed' | 'failed'

export interface UploadEvent {
  status: UploadStatus
  document_id?: string
  chunk_count?: number
  progress?: number
  error?: string
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat: add Document, Chunk, and Upload types"
```

---

## Task 9: Frontend API Functions

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add document API functions**

Add to `frontend/src/lib/api.ts`:

```typescript
import type { Document, Chunk, UploadEvent } from '@/types'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001'

// ... existing streamChat function ...

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
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add document API functions"
```

---

## Task 10: useDocuments Hook

**Files:**
- Create: `frontend/src/hooks/useDocuments.ts`

- [ ] **Step 1: Create useDocuments hook**

Create `frontend/src/hooks/useDocuments.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchDocuments, deleteDocument as apiDeleteDocument } from '@/lib/api'
import type { Document } from '@/types'

export function useDocuments() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const docs = await fetchDocuments(session.access_token)
      setDocuments(docs)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch documents'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const deleteDocument = async (id: string) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Not authenticated')

    await apiDeleteDocument(id, session.access_token)
    setDocuments((prev) => prev.filter((d) => d.id !== id))
  }

  return {
    documents,
    loading,
    error,
    refresh,
    deleteDocument,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useDocuments.ts
git commit -m "feat: add useDocuments hook"
```

---

## Task 11: useUpload Hook

**Files:**
- Create: `frontend/src/hooks/useUpload.ts`

- [ ] **Step 1: Create useUpload hook**

Create `frontend/src/hooks/useUpload.ts`:

```typescript
import { useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { uploadDocument, reprocessDocument } from '@/lib/api'
import type { UploadStatus, UploadEvent } from '@/types'

export function useUpload(onComplete?: () => void) {
  const [status, setStatus] = useState<UploadStatus | null>(null)
  const [progress, setProgress] = useState(0)
  const [chunkCount, setChunkCount] = useState<number | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    setStatus(null)
    setProgress(0)
    setChunkCount(null)
    setError(null)
  }, [])

  const processEvent = useCallback((event: UploadEvent) => {
    setStatus(event.status)

    if (event.chunk_count !== undefined) {
      setChunkCount(event.chunk_count)
    }

    if (event.progress !== undefined) {
      setProgress(event.progress)
    }

    if (event.status === 'failed' && event.error) {
      setError(new Error(event.error))
    }

    if (event.status === 'completed') {
      onComplete?.()
    }
  }, [onComplete])

  const upload = useCallback(async (file: File) => {
    reset()
    abortControllerRef.current = new AbortController()

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      setStatus('uploading')

      for await (const event of uploadDocument(
        file,
        session.access_token,
        abortControllerRef.current.signal
      )) {
        processEvent(event)
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err)
        setStatus('failed')
      }
    }
  }, [reset, processEvent])

  const reprocess = useCallback(async (documentId: string) => {
    reset()
    abortControllerRef.current = new AbortController()

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      for await (const event of reprocessDocument(
        documentId,
        session.access_token,
        abortControllerRef.current.signal
      )) {
        processEvent(event)
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err)
        setStatus('failed')
      }
    }
  }, [reset, processEvent])

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort()
    reset()
  }, [reset])

  return {
    upload,
    reprocess,
    cancel,
    reset,
    status,
    progress,
    chunkCount,
    error,
    isUploading: status !== null && status !== 'completed' && status !== 'failed',
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useUpload.ts
git commit -m "feat: add useUpload hook with SSE progress"
```

---

## Task 12: useChunks Hook

**Files:**
- Create: `frontend/src/hooks/useChunks.ts`

- [ ] **Step 1: Create useChunks hook**

Create `frontend/src/hooks/useChunks.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchChunks } from '@/lib/api'
import type { Chunk } from '@/types'

export function useChunks(documentId: string | null) {
  const [chunks, setChunks] = useState<Chunk[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const loadChunks = useCallback(async () => {
    if (!documentId) {
      setChunks([])
      setTotal(0)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const result = await fetchChunks(documentId, page, session.access_token)
      setChunks(result.chunks)
      setTotal(result.total)
      setPageSize(result.page_size)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch chunks'))
    } finally {
      setLoading(false)
    }
  }, [documentId, page])

  useEffect(() => {
    loadChunks()
  }, [loadChunks])

  useEffect(() => {
    setPage(1)
  }, [documentId])

  const totalPages = Math.ceil(total / pageSize)

  return {
    chunks,
    total,
    page,
    setPage,
    totalPages,
    loading,
    error,
    refresh: loadChunks,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useChunks.ts
git commit -m "feat: add useChunks hook with pagination"
```

---

## Task 13: UploadZone Component

**Files:**
- Create: `frontend/src/components/documents/UploadZone.tsx`

- [ ] **Step 1: Create UploadZone component**

Create `frontend/src/components/documents/UploadZone.tsx`:

```typescript
import { useCallback, useState } from 'react'
import { Upload, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { UploadStatus } from '@/types'

interface UploadZoneProps {
  onFileSelect: (file: File) => void
  status: UploadStatus | null
  progress: number
  chunkCount: number | null
  isUploading: boolean
}

const ALLOWED_TYPES = ['.txt', '.md']

export function UploadZone({
  onFileSelect,
  status,
  progress,
  chunkCount,
  isUploading,
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)

      const file = e.dataTransfer.files[0]
      if (file && isValidFile(file)) {
        onFileSelect(file)
      }
    },
    [onFileSelect]
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file && isValidFile(file)) {
        onFileSelect(file)
      }
      e.target.value = ''
    },
    [onFileSelect]
  )

  const isValidFile = (file: File) => {
    return ALLOWED_TYPES.some((ext) => file.name.toLowerCase().endsWith(ext))
  }

  const getStatusMessage = () => {
    switch (status) {
      case 'uploading':
        return 'Uploading file...'
      case 'chunking':
        return chunkCount ? `Chunking... (${chunkCount} chunks)` : 'Chunking...'
      case 'embedding':
        return `Generating embeddings... ${progress}%`
      case 'completed':
        return 'Upload complete!'
      case 'failed':
        return 'Upload failed'
      default:
        return null
    }
  }

  return (
    <div
      className={`
        relative rounded-lg border-2 border-dashed p-8 text-center transition-colors
        ${isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}
        ${isUploading ? 'pointer-events-none opacity-75' : 'hover:border-primary/50'}
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept={ALLOWED_TYPES.join(',')}
        onChange={handleFileInput}
        className="hidden"
        id="file-upload"
        disabled={isUploading}
      />

      {isUploading ? (
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm font-medium">{getStatusMessage()}</p>
          {status === 'embedding' && (
            <div className="h-2 w-48 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      ) : (
        <label htmlFor="file-upload" className="cursor-pointer">
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-full bg-muted p-3">
              <Upload className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">Drop files here or click to upload</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Supports {ALLOWED_TYPES.join(', ')} files
              </p>
            </div>
            <Button variant="secondary" size="sm" asChild>
              <span>
                <FileText className="mr-2 h-4 w-4" />
                Select File
              </span>
            </Button>
          </div>
        </label>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/documents/UploadZone.tsx
git commit -m "feat: add UploadZone component with drag-and-drop"
```

---

## Task 14: ChunkList Component

**Files:**
- Create: `frontend/src/components/documents/ChunkList.tsx`

- [ ] **Step 1: Create ChunkList component**

Create `frontend/src/components/documents/ChunkList.tsx`:

```typescript
import { useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useChunks } from '@/hooks/useChunks'

interface ChunkListProps {
  documentId: string
}

export function ChunkList({ documentId }: ChunkListProps) {
  const { chunks, total, page, setPage, totalPages, loading } = useChunks(documentId)
  const [expandedChunk, setExpandedChunk] = useState<string | null>(null)

  if (loading) {
    return <div className="py-4 text-center text-sm text-muted-foreground">Loading chunks...</div>
  }

  if (chunks.length === 0) {
    return <div className="py-4 text-center text-sm text-muted-foreground">No chunks found</div>
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        {total} chunks total
      </div>

      <div className="space-y-2">
        {chunks.map((chunk) => {
          const isExpanded = expandedChunk === chunk.id
          const preview = chunk.content.slice(0, 200)
          const hasMore = chunk.content.length > 200

          return (
            <Card key={chunk.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Chunk {chunk.chunk_index}</span>
                    <span>|</span>
                    <span>Pos {chunk.metadata.start_pos}-{chunk.metadata.end_pos}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm">
                    {isExpanded ? chunk.content : preview}
                    {!isExpanded && hasMore && '...'}
                  </p>
                </div>
                {hasMore && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpandedChunk(isExpanded ? null : chunk.id)}
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            </Card>
          )
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(page + 1)}
            disabled={page >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/documents/ChunkList.tsx
git commit -m "feat: add ChunkList component with pagination"
```

---

## Task 15: DocumentRow Component

**Files:**
- Create: `frontend/src/components/documents/DocumentRow.tsx`

- [ ] **Step 1: Create DocumentRow component**

Create `frontend/src/components/documents/DocumentRow.tsx`:

```typescript
import { useState } from 'react'
import { ChevronDown, ChevronUp, Trash2, RefreshCw, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ChunkList } from './ChunkList'
import type { Document } from '@/types'

interface DocumentRowProps {
  document: Document
  onDelete: (id: string) => void
  onReprocess: (id: string) => void
  isReprocessing: boolean
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatusBadge({ status }: { status: Document['status'] }) {
  const styles = {
    pending: 'bg-gray-100 text-gray-700',
    processing: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status === 'processing' && <Loader2 className="h-3 w-3 animate-spin" />}
      {status}
    </span>
  )
}

export function DocumentRow({
  document,
  onDelete,
  onReprocess,
  isReprocessing,
}: DocumentRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete(document.id)
      setConfirmDelete(false)
    } else {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 3000)
    }
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-4 p-4">
        <FileText className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
        
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{document.filename}</span>
            <StatusBadge status={document.status} />
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {formatFileSize(document.file_size)} • {document.chunk_count} chunks • {formatDate(document.created_at)}
          </div>
          {document.error_message && (
            <div className="mt-1 text-xs text-red-600">
              Error: {document.error_message}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {document.status === 'completed' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          )}
          
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onReprocess(document.id)}
            disabled={isReprocessing || document.status === 'processing'}
            title="Reprocess document"
          >
            <RefreshCw className={`h-4 w-4 ${isReprocessing ? 'animate-spin' : ''}`} />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className={confirmDelete ? 'text-red-600 hover:text-red-700' : ''}
            title={confirmDelete ? 'Click again to confirm' : 'Delete document'}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {expanded && document.status === 'completed' && (
        <div className="border-t bg-muted/30 p-4">
          <ChunkList documentId={document.id} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/documents/DocumentRow.tsx
git commit -m "feat: add DocumentRow component with expand/delete/reprocess"
```

---

## Task 16: DocumentsView Component

**Files:**
- Create: `frontend/src/components/documents/DocumentsView.tsx`

- [ ] **Step 1: Create DocumentsView component**

Create `frontend/src/components/documents/DocumentsView.tsx`:

```typescript
import { useState } from 'react'
import { useDocuments } from '@/hooks/useDocuments'
import { useUpload } from '@/hooks/useUpload'
import { UploadZone } from './UploadZone'
import { DocumentRow } from './DocumentRow'

export function DocumentsView() {
  const { documents, loading, error, refresh, deleteDocument } = useDocuments()
  const { upload, reprocess, status, progress, chunkCount, isUploading, reset } = useUpload(() => {
    refresh()
    setTimeout(reset, 2000)
  })
  const [reprocessingId, setReprocessingId] = useState<string | null>(null)

  const handleReprocess = async (documentId: string) => {
    setReprocessingId(documentId)
    await reprocess(documentId)
    refresh()
    setReprocessingId(null)
  }

  const handleDelete = async (documentId: string) => {
    await deleteDocument(documentId)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <UploadZone
          onFileSelect={upload}
          status={status}
          progress={progress}
          chunkCount={chunkCount}
          isUploading={isUploading}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="py-8 text-center text-muted-foreground">
            Loading documents...
          </div>
        ) : error ? (
          <div className="py-8 text-center text-red-600">
            Error: {error.message}
          </div>
        ) : documents.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            No documents yet. Upload your first document above.
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <DocumentRow
                key={doc.id}
                document={doc}
                onDelete={handleDelete}
                onReprocess={handleReprocess}
                isReprocessing={reprocessingId === doc.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/documents/DocumentsView.tsx
git commit -m "feat: add DocumentsView component"
```

---

## Task 17: Layout Tab Navigation

**Files:**
- Modify: `frontend/src/components/Layout.tsx`

- [ ] **Step 1: Add tab navigation to Layout**

Replace the contents of `frontend/src/components/Layout.tsx`:

```typescript
import { useState } from 'react'
import { LogOut, Menu, X, MessageSquare, FileText } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useThreads } from '@/hooks/useThreads'
import { Button } from '@/components/ui/button'
import { ThreadList } from '@/components/chat/ThreadList'
import { ChatInterface } from '@/components/chat/ChatInterface'
import { DocumentsView } from '@/components/documents/DocumentsView'

type Tab = 'chat' | 'documents'

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
  const [activeTab, setActiveTab] = useState<Tab>('chat')

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
          {activeTab === 'chat' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          )}
          <h1 className="text-lg font-semibold">RAG Chat</h1>
          <div className="ml-4 flex rounded-lg border bg-muted p-1">
            <Button
              variant={activeTab === 'chat' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('chat')}
              className="gap-2"
            >
              <MessageSquare className="h-4 w-4" />
              Chat
            </Button>
            <Button
              variant={activeTab === 'documents' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('documents')}
              className="gap-2"
            >
              <FileText className="h-4 w-4" />
              Documents
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">{user?.email}</span>
          <Button variant="ghost" size="icon" onClick={signOut}>
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        {activeTab === 'chat' ? (
          <>
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
          </>
        ) : (
          <main className="flex-1">
            <DocumentsView />
          </main>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd frontend && npm run build`

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Layout.tsx
git commit -m "feat: add tab navigation for Chat and Documents"
```

---

## Task 18: End-to-End Testing

**Files:** None (manual testing)

- [ ] **Step 1: Start backend server**

Run: `cd backend && ./venv/Scripts/uvicorn app.main:app --reload --port 8001`

Expected: Server starts, `/docs` shows all endpoints including `/documents/*`.

- [ ] **Step 2: Start frontend dev server**

Run: `cd frontend && npm run dev`

Expected: Dev server starts on port 5173.

- [ ] **Step 3: Test document upload flow**

1. Log in to the app
2. Click "Documents" tab
3. Drag and drop a `.txt` file into the upload zone
4. Observe SSE progress: uploading → chunking → embedding → completed
5. Verify document appears in the list with "completed" status

Expected: Document uploads and processes successfully.

- [ ] **Step 4: Test chunk viewing**

1. Click the expand button on a completed document
2. Verify chunks display with index, content preview, and position metadata
3. Test pagination if more than 20 chunks

Expected: Chunks display correctly with pagination working.

- [ ] **Step 5: Test reprocess**

1. Click the refresh icon on a document
2. Observe reprocessing status
3. Verify chunk count may change

Expected: Document reprocesses without errors.

- [ ] **Step 6: Test delete**

1. Click the trash icon on a document
2. Click again to confirm
3. Verify document disappears from list

Expected: Document and its chunks deleted.

- [ ] **Step 7: Verify database state**

Run in Supabase SQL Editor:
```sql
SELECT d.filename, d.status, d.chunk_count, COUNT(c.id) as actual_chunks
FROM documents d
LEFT JOIN chunks c ON c.document_id = d.id
GROUP BY d.id;
```

Expected: chunk_count matches actual_chunks for each document.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat: complete Module 2 Phase 2 - Ingestion Pipeline"
```

---

## Task 19: Update Progress

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Update PROGRESS.md**

Update the Module 2 Phase 2 section in `PROGRESS.md`:

```markdown
#### Phase 2: Ingestion Pipeline
- [x] Database schema (documents, chunks tables with RLS)
- [x] File storage (Supabase Storage)
- [x] Ingestion UI (file upload)
- [x] Chunking service
- [x] Embedding service (pgvector)
- [x] Realtime ingestion status

**Configuration:**
- `EMBEDDING_PROVIDER`: openai, ollama, custom
- `EMBEDDING_API_KEY`: API key for provider
- `EMBEDDING_MODEL`: Model name (default: text-embedding-3-small)
- `EMBEDDING_DIMENSIONS`: Vector dimensions (default: 1536)
- `CHUNK_SIZE`: Characters per chunk (default: 1000)
- `CHUNK_OVERLAP`: Overlap between chunks (default: 200)
```

- [ ] **Step 2: Commit**

```bash
git add PROGRESS.md
git commit -m "docs: mark Module 2 Phase 2 as complete"
```
