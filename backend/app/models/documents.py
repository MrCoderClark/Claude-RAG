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
    content_hash: Optional[str] = None
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
    status: Literal[
        "uploading", "chunking", "embedding", "completed", "failed",
        "duplicate_unchanged", "duplicate_changed",
    ]
    document_id: Optional[str] = None
    filename: Optional[str] = None
    chunk_count: Optional[int] = None
    progress: Optional[int] = None
    error: Optional[str] = None
    chunks_added: Optional[int] = None
    chunks_removed: Optional[int] = None
    chunks_unchanged: Optional[int] = None
