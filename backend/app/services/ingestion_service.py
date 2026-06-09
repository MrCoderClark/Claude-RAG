from typing import Any, Callable

from supabase import Client

from app.services.chunking_service import chunk_text
from app.services.embedding_service import embed_texts
from app.services.record_manager import hash_content, hash_chunk


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
        content_bytes = file_response if isinstance(file_response, bytes) else file_response.encode("utf-8")
        content = content_bytes.decode("utf-8")
        content_hash = hash_content(content_bytes)

        chunks = chunk_text(content)
        on_progress("chunking", {"chunk_count": len(chunks)})

        if not chunks:
            supabase.table("documents").update({
                "status": "completed",
                "chunk_count": 0,
                "content_hash": content_hash,
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
                "content_hash": hash_chunk(chunk.content),
                "metadata": {"start_pos": chunk.start_pos, "end_pos": chunk.end_pos},
            })

        supabase.table("chunks").insert(chunk_records).execute()

        supabase.table("documents").update({
            "status": "completed",
            "chunk_count": len(chunks),
            "content_hash": content_hash,
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
