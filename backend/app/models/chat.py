from pydantic import BaseModel


class ChatRequest(BaseModel):
    thread_id: str
    message: str


class StreamEvent(BaseModel):
    type: str  # "text", "done", or "error"
    content: str
