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
from app.services.record_manager import check_duplicate, replace_document

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

    dup_result = check_duplicate(supabase, user["id"], file.filename or "file.txt", content)

    if dup_result.status == "unchanged":
        async def unchanged_generator() -> AsyncGenerator[str, None]:
            yield json.dumps({"status": "duplicate_unchanged", "filename": file.filename})
        return EventSourceResponse(unchanged_generator())

    if dup_result.status == "changed":
        async def changed_generator() -> AsyncGenerator[str, None]:
            yield json.dumps({
                "status": "duplicate_changed",
                "document_id": dup_result.existing_document_id,
                "filename": file.filename,
            })
        return EventSourceResponse(changed_generator())

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

            progress_events = []

            def capture_progress(status: str, data: dict):
                progress_events.append({"status": status, **data})

            await ingest_document(supabase, document_id, user["id"], capture_progress)

            for event in progress_events:
                yield json.dumps(event)

        except Exception as e:
            yield json.dumps({"status": "failed", "error": str(e)})

    return EventSourceResponse(event_generator())


@router.put("/{document_id}/replace")
async def replace_document_endpoint(
    document_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    supabase = get_supabase()

    doc_response = supabase.table("documents").select("id").eq("id", document_id).eq("user_id", user["id"]).single().execute()
    if not doc_response.data:
        raise HTTPException(404, "Document not found")

    content = await file.read()

    async def event_generator() -> AsyncGenerator[str, None]:
        progress_events = []

        def capture_progress(status: str, data: dict):
            progress_events.append({"status": status, **data})

        try:
            await replace_document(
                supabase, document_id, user["id"], content, file.filename or "file.txt", capture_progress
            )
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
