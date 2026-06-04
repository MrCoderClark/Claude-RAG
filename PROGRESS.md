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

**Status:** [-] In progress

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

#### Phase 2: Ingestion Pipeline (pending)
- [ ] Database schema (documents, chunks tables with RLS)
- [ ] File storage (Supabase Storage)
- [ ] Ingestion UI (file upload)
- [ ] Chunking service
- [ ] Embedding service (pgvector)
- [ ] Realtime ingestion status

#### Phase 3: Retrieval (pending)
- [ ] Vector search service
- [ ] Retrieval tool for chat
- [ ] Relevance thresholds