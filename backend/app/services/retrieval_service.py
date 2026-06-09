from dataclasses import dataclass

from langsmith import traceable
from supabase import Client

from app.services.embedding_service import embed_texts


@dataclass
class RetrievalResult:
    """Result from vector similarity search. Similarity is 0-1 (cosine)."""

    chunk_id: str
    document_id: str
    document_filename: str
    content: str
    chunk_index: int
    similarity: float


@traceable(name="search_documents")
async def search_documents(
    supabase: Client,
    query: str,
    user_id: str,
    threshold: float = 0.5,
    limit: int = 5,
) -> list[RetrievalResult]:
    if not query or not query.strip():
        return []

    embeddings = await embed_texts([query])
    if not embeddings:
        return []

    query_embedding = embeddings[0]

    response = supabase.rpc(
        "search_chunks",
        {
            "query_embedding": query_embedding,
            "match_user_id": user_id,
            "match_threshold": threshold,
            "match_count": limit,
        }
    ).execute()

    if hasattr(response, "error") and response.error:
        raise RuntimeError(f"Vector search failed: {response.error}")

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
