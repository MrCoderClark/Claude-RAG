# Record Manager Design Spec

## Overview

Add content hashing and chunk-level diffing to the ingestion pipeline. When a user re-uploads a file with the same name, the system detects whether content has changed, prompts for confirmation, and only re-embeds the chunks that are new or modified.

## Goals

- Prevent duplicate documents in retrieval results
- Minimize embedding API calls on re-uploads
- Teach content hashing, deduplication, and incremental updates

## Schema Changes

### Migration: `005_record_manager.sql`

Add content hash columns to existing tables:

```sql
ALTER TABLE documents ADD COLUMN content_hash text;
ALTER TABLE chunks ADD COLUMN content_hash text;
CREATE INDEX chunks_content_hash_idx ON chunks(content_hash);
```

Both are SHA-256 hex strings. `documents.content_hash` is the hash of the full file content. `chunks.content_hash` is the hash of the individual chunk text.

Backfill is not required — existing documents will have NULL hashes and will be treated as "no hash available" (forces full reprocess on next re-upload).

## Upload Flow

### Duplicate Detection (POST /documents/upload)

Before creating a new document, check if the user already has a document with the same filename:

1. Query: `SELECT id, content_hash FROM documents WHERE user_id = ? AND filename = ? AND status = 'completed'`
2. **No match** → proceed with normal ingestion (same as today, but now stores content_hash and chunk content_hash values)
3. **Match found, same content_hash** → return `{"status": "duplicate_unchanged", "filename": "..."}`, skip processing
4. **Match found, different content_hash (or NULL)** → return `{"status": "duplicate_changed", "document_id": "...", "filename": "..."}`, wait for user confirmation

### Replace Endpoint (PUT /documents/{id}/replace)

New endpoint that handles confirmed replacements. Accepts multipart form data (same as upload):

1. Accept file upload (multipart) for the given document_id
2. Upload new file to storage (overwrite existing path)
3. Hash the new file content
4. Chunk the new content
5. Hash each new chunk
6. Load existing chunk hashes: `SELECT id, content_hash, chunk_index FROM chunks WHERE document_id = ?`
7. Diff:
   - **Unchanged chunks** (hash in both old and new): keep existing row, update `chunk_index` if position changed
   - **New chunks** (hash only in new set): embed and insert
   - **Removed chunks** (hash only in old set): delete rows
8. Update document record: new `content_hash`, `updated_at`, `chunk_count`, status back to `completed`
9. Stream progress via SSE with summary: `{"status": "completed", "chunks_added": N, "chunks_removed": N, "chunks_unchanged": N}`

### Hashing

- Algorithm: SHA-256
- Document hash: `hashlib.sha256(file_bytes).hexdigest()`
- Chunk hash: `hashlib.sha256(chunk_text.encode('utf-8')).hexdigest()`

## Backend Changes

### New Service: `record_manager.py`

Responsibilities:
- `check_duplicate(supabase, user_id, filename, content_bytes) -> DuplicateCheckResult`
  - Returns: `new`, `unchanged`, or `changed` with existing document_id
- `replace_document(supabase, document_id, user_id, content_bytes, filename, on_progress) -> ReplaceSummary`
  - Handles the chunk diff + selective re-embedding logic
  - Returns: `ReplaceSummary(chunks_added, chunks_removed, chunks_unchanged)`

### Changes to Existing Code

- `ingestion_service.py`: Store `content_hash` on document and `content_hash` on each chunk during initial ingestion
- `documents.py` router: Add duplicate check to `upload_document`, add new `replace_document_endpoint`
- `chunking_service.py`: No changes needed

## Frontend Changes

### UploadZone Component

Modify the upload handler to detect duplicate responses:

1. Parse SSE events from upload
2. If `status === "duplicate_unchanged"`: show info toast "File is already up to date", no further action
3. If `status === "duplicate_changed"`: show confirmation dialog
4. On confirm: call `PUT /documents/{document_id}/replace` with the same file, stream progress as normal
5. On cancel: do nothing

### Confirmation Dialog

Simple modal using shadcn/ui AlertDialog:
- Title: "Replace existing file?"
- Body: "{filename} already exists. Content has changed — replace it?"
- Actions: Cancel / Replace

### api.ts

Add new function:
- `replaceDocument(documentId: string, file: File, token: string): AsyncGenerator<UploadEvent>`

### Progress Events

The completed event gains optional fields for replacements:
- `chunks_added`, `chunks_removed`, `chunks_unchanged`

The DocumentsView should show these in the status update when available (e.g., "Updated: 2 added, 1 removed, 5 unchanged").

## Edge Cases

- **Document in failed/processing state**: duplicate check only matches `status = 'completed'` documents, so a failed upload of the same filename allows a fresh upload
- **NULL content_hash on existing document**: treated as "changed" (forces full reprocess, which populates the hashes going forward)
- **Concurrent uploads of same filename**: the duplicate check is not transactional, but this is acceptable for a single-user-at-a-time workflow
- **Chunk hash collision**: SHA-256 collision is astronomically unlikely; not worth handling
