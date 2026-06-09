# Progress

Track your progress through the masterclass. Update this file as you complete modules - Claude Code reads this to understand where you are in the project.

## Convention
- `[ ]` = Not started
- `[-]` = In progress
- `[x]` = Completed

## Modules

### Module 1: App Shell + Observability

- [x] Phase 1: Environment Setup
  - [x] Initialize Frontend (Vite + React + TypeScript + Tailwind + shadcn/ui)
  - [x] Initialize Backend (FastAPI + venv)
  - [x] Environment Configuration (.env.example files)
- [x] Phase 2: Database Schema
  - [x] Create Supabase Migration (threads, messages tables with RLS)
- [x] Phase 3: Authentication
  - [x] Frontend Auth (AuthContext, LoginForm)
  - [x] Backend JWT Validation (dependencies.py)
- [x] Phase 4: OpenAI Integration
  - [x] OpenAI Service with LangSmith tracing
  - [x] Chat Router with SSE streaming
- [x] Phase 5: Chat UI
  - [x] ThreadList component
  - [x] ChatInterface, MessageList, MessageInput components
  - [x] Layout component

**Status:** ✅ Complete and validated

**To start servers:**
- Frontend: `cd frontend && npm run dev` (port 5173)
- Backend: `cd backend && ./venv/Scripts/uvicorn app.main:app --reload --port 8001`

**Validated:**
- Sign up / Sign in working
- JWT validation working
- Thread CRUD with RLS
- SSE streaming chat responses
- Messages persisted to Supabase
- LangSmith tracing configured

### Module 2: BYO Retrieval + Memory

**Status:** ✅ Complete and validated

#### Phase 1: Multi-Provider LLM Abstraction ✅
- [x] LLMProvider enum and PROVIDER_PRESETS in config.py
- [x] New llm_service.py with provider-agnostic client
- [x] Update chat.py to use llm_service + model metadata
- [x] Update .env.example files with new LLM_* vars
- [x] Delete openai_service.py, remove openai_api_key from Settings
- [x] Create migration 002_remove_openai_thread_id.sql

**Configuration:**
- `LLM_PROVIDER`: openai, openrouter, ollama, lm_studio, custom
- `LLM_API_KEY`: API key for provider
- `LLM_MODEL`: Model name (optional, uses provider default)
- `LLM_BASE_URL`: Custom endpoint (optional)

#### Phase 2: Ingestion Pipeline ✅
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

**Validated:**
- Document upload with drag-and-drop
- SSE progress streaming (uploading → chunking → embedding → completed)
- Recursive text chunking
- OpenAI embeddings stored in pgvector
- Document list with status badges
- Chunk viewer with pagination
- Delete and reprocess functionality
- Tab navigation between Chat and Documents

**Note:** Storage bucket must be created manually for Docker Supabase:
```powershell
docker exec -i supabase-db psql -U postgres -d postgres -c "INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('documents', 'documents', false, 52428800, ARRAY['text/plain', 'text/markdown']) ON CONFLICT (id) DO NOTHING;"
```

#### Phase 3: Retrieval ✅
- [x] Vector search service (retrieval_service.py)
- [x] search_chunks database function (migration 004)
- [x] Tool definition in llm_service.py
- [x] Tool orchestration in chat router
- [x] Source/MessageMetadata types
- [x] SourcesList component
- [x] Citations in MessageList

**To apply migration (required before testing):**
```powershell
Get-Content supabase/migrations/004_search_chunks_function.sql | docker exec -i supabase-db psql -U postgres -d postgres
```

**Validated:**
- LLM calls search_documents tool when appropriate
- Vector search with similarity threshold (0.5) working
- Sources displayed in collapsible UI
- list_documents tool for file listing queries
- System prompt guides tool usage

### Module 3: Record Manager

**Status:** [-] In progress (design complete, implementation pending)

#### Phase 1: Record Manager
- [ ] Migration 005: add content_hash to documents and chunks tables
- [ ] record_manager.py service (duplicate check, chunk-level diffing)
- [ ] Update ingestion_service.py to store content hashes
- [ ] PUT /documents/{id}/replace endpoint
- [ ] Duplicate detection in upload flow
- [ ] Frontend confirmation dialog for changed files
- [ ] api.ts replaceDocument function
- [ ] Progress summary (chunks added/removed/unchanged)

**Design spec:** `docs/superpowers/specs/2026-06-09-record-manager-design.md`