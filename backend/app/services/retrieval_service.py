from dataclasses import dataclass

from langsmith import traceable
from supabase import create_client

from app.config import settings
from app.services.embedding_service import embed_texts


@dataclass
class RetrievalResult:
    chunk_id: str
    document_id: str
    document_filename: str
    content: str
    chunk_index: int
    similarity: float


def _get_supabase():
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


@traceable(name="search_documents")
async def search_documents(
    query: str,
    user_id: str,
    threshold: float = 0.7,
    limit: int = 5,
) -> list[RetrievalResult]:
    """
    Search user's documents for relevant chunks.

    1. Embed the query
    2. Query pgvector with cosine similarity
    3. Filter by user_id and threshold
    4. Return top-k results with document metadata
    """
    embeddings = await embed_texts([query])
    if not embeddings:
        return []

    query_embedding = embeddings[0]

    supabase = _get_supabase()

    response = supabase.rpc(
        "search_chunks",
        {
            "query_embedding": query_embedding,
            "match_user_id": user_id,
            "match_threshold": threshold,
            "match_count": limit,
        }
    ).execute()

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
