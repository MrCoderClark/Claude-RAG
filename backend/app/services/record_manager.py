import hashlib
from dataclasses import dataclass
from typing import Any, Callable

from supabase import Client

from app.services.chunking_service import chunk_text
from app.services.embedding_service import embed_texts


@dataclass
class DuplicateCheckResult:
    status: str  # "new", "unchanged", "changed"
    existing_document_id: str | None = None


@dataclass
class ReplaceSummary:
    chunks_added: int
    chunks_removed: int
    chunks_unchanged: int


def hash_content(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def hash_chunk(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def check_duplicate(
    supabase: Client,
    user_id: str,
    filename: str,
    content_bytes: bytes,
) -> DuplicateCheckResult:
    response = (
        supabase.table("documents")
        .select("id, content_hash")
        .eq("user_id", user_id)
        .eq("filename", filename)
        .eq("status", "completed")
        .execute()
    )

    if not response.data:
        return DuplicateCheckResult(status="new")

    existing = response.data[0]
    new_hash = hash_content(content_bytes)

    if existing.get("content_hash") == new_hash:
        return DuplicateCheckResult(
            status="unchanged",
            existing_document_id=existing["id"],
        )

    return DuplicateCheckResult(
        status="changed",
        existing_document_id=existing["id"],
    )


async def replace_document(
    supabase: Client,
    document_id: str,
    user_id: str,
    content_bytes: bytes,
    filename: str,
    on_progress: Callable[[str, dict[str, Any]], None],
) -> ReplaceSummary:
    doc_response = (
        supabase.table("documents")
        .select("*")
        .eq("id", document_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    doc = doc_response.data
    if not doc:
        raise ValueError("Document not found")

    supabase.table("documents").update({"status": "processing"}).eq(
        "id", document_id
    ).execute()

    try:
        on_progress("uploading", {})
        storage_path = doc["storage_path"]
        supabase.storage.from_("documents").update(storage_path, content_bytes)

        on_progress("chunking", {})
        content = content_bytes.decode("utf-8")
        new_chunks = chunk_text(content)
        content_hash = hash_content(content_bytes)

        new_chunk_hashes = {}
        for chunk in new_chunks:
            h = hash_chunk(chunk.content)
            new_chunk_hashes[h] = chunk

        on_progress("chunking", {"chunk_count": len(new_chunks)})

        existing_response = (
            supabase.table("chunks")
            .select("id, content_hash, chunk_index")
            .eq("document_id", document_id)
            .execute()
        )
        existing_chunks = existing_response.data or []

        old_hashes = {}
        for ec in existing_chunks:
            if ec.get("content_hash"):
                old_hashes[ec["content_hash"]] = ec

        unchanged_hashes = set(new_chunk_hashes.keys()) & set(old_hashes.keys())
        added_hashes = set(new_chunk_hashes.keys()) - set(old_hashes.keys())
        removed_hashes = set(old_hashes.keys()) - set(new_chunk_hashes.keys())

        removed_ids = [old_hashes[h]["id"] for h in removed_hashes]
        old_without_hash = [ec for ec in existing_chunks if not ec.get("content_hash")]
        removed_ids.extend(ec["id"] for ec in old_without_hash)

        if removed_ids:
            supabase.table("chunks").delete().in_("id", removed_ids).execute()

        for h in unchanged_hashes:
            new_chunk = new_chunk_hashes[h]
            old_chunk = old_hashes[h]
            if old_chunk["chunk_index"] != new_chunk.index:
                supabase.table("chunks").update(
                    {"chunk_index": new_chunk.index}
                ).eq("id", old_chunk["id"]).execute()

        chunks_to_embed = [new_chunk_hashes[h] for h in added_hashes]

        if chunks_to_embed:
            on_progress("embedding", {"progress": 0})
            batch_size = 100
            all_embeddings = []

            for i in range(0, len(chunks_to_embed), batch_size):
                batch = chunks_to_embed[i : i + batch_size]
                batch_texts = [c.content for c in batch]
                embeddings = await embed_texts(batch_texts)
                all_embeddings.extend(embeddings)

                prog = min(100, int((i + len(batch)) / len(chunks_to_embed) * 100))
                on_progress("embedding", {"progress": prog})

            chunk_records = []
            for chunk, embedding, h in zip(
                chunks_to_embed,
                all_embeddings,
                [h for h in added_hashes],
            ):
                chunk_records.append(
                    {
                        "document_id": document_id,
                        "content": chunk.content,
                        "chunk_index": chunk.index,
                        "embedding": embedding,
                        "content_hash": h,
                        "metadata": {
                            "start_pos": chunk.start_pos,
                            "end_pos": chunk.end_pos,
                        },
                    }
                )

            supabase.table("chunks").insert(chunk_records).execute()

        total_chunks = len(unchanged_hashes) + len(chunks_to_embed)
        supabase.table("documents").update(
            {
                "status": "completed",
                "content_hash": content_hash,
                "chunk_count": total_chunks,
            }
        ).eq("id", document_id).execute()

        summary = ReplaceSummary(
            chunks_added=len(added_hashes),
            chunks_removed=len(removed_hashes) + len(old_without_hash),
            chunks_unchanged=len(unchanged_hashes),
        )

        on_progress(
            "completed",
            {
                "document_id": document_id,
                "chunk_count": total_chunks,
                "chunks_added": summary.chunks_added,
                "chunks_removed": summary.chunks_removed,
                "chunks_unchanged": summary.chunks_unchanged,
            },
        )

        return summary

    except Exception as e:
        supabase.table("documents").update(
            {"status": "failed", "error_message": str(e)}
        ).eq("id", document_id).execute()
        on_progress("failed", {"error": str(e)})
        raise
