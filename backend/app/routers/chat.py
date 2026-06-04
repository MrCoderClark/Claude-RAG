import json
from typing import AsyncGenerator

from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse
from supabase import Client, create_client

from app.config import settings
from app.dependencies import get_current_user
from app.models.chat import ChatRequest
from app.services.llm_service import get_model_metadata, stream_chat_completion

router = APIRouter(prefix="/chat", tags=["chat"])


def get_supabase() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


@router.post("/stream")
async def stream_chat(
    request: ChatRequest,
    user: dict = Depends(get_current_user),
):
    supabase = get_supabase()

    thread_response = supabase.table("threads").select("*").eq("id", request.thread_id).eq("user_id", user["id"]).single().execute()
    if not thread_response.data:
        return EventSourceResponse(
            iter([json.dumps({"type": "error", "content": "Thread not found"})])
        )

    messages_response = supabase.table("messages").select("role, content").eq("thread_id", request.thread_id).order("created_at").execute()
    history = [{"role": m["role"], "content": m["content"]} for m in (messages_response.data or [])]

    history.append({"role": "user", "content": request.message})

    supabase.table("messages").insert({
        "thread_id": request.thread_id,
        "role": "user",
        "content": request.message,
    }).execute()

    async def event_generator() -> AsyncGenerator[str, None]:
        full_response = ""
        async for chunk in stream_chat_completion(history, user["id"], request.thread_id):
            full_response += chunk
            yield json.dumps({"type": "text", "content": chunk})

        supabase.table("messages").insert({
            "thread_id": request.thread_id,
            "role": "assistant",
            "content": full_response,
            "metadata": get_model_metadata(),
        }).execute()

        supabase.table("threads").update({"updated_at": "now()"}).eq("id", request.thread_id).execute()

        yield json.dumps({"type": "done", "content": ""})

    return EventSourceResponse(event_generator())
