import json
from typing import AsyncGenerator

from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse
from supabase import Client, create_client

from app.config import settings
from app.dependencies import get_current_user
from app.models.chat import ChatRequest
from app.services.llm_service import (
    get_model_metadata,
    get_chat_completion_with_tools,
    stream_chat_after_tool,
    stream_chat_completion,
)
from app.services.retrieval_service import search_documents

router = APIRouter(prefix="/chat", tags=["chat"])


def get_supabase() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def _format_sources_for_metadata(results) -> list[dict]:
    """Format retrieval results for message metadata."""
    return [
        {
            "chunk_id": r.chunk_id,
            "document_id": r.document_id,
            "document_filename": r.document_filename,
            "content": r.content[:200],
            "chunk_index": r.chunk_index,
            "similarity": round(r.similarity, 3),
        }
        for r in results
    ]


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
        sources = []
        messages = history.copy()

        # First call - may include tool calls
        assistant_message = await get_chat_completion_with_tools(messages, user["id"])

        # Check if LLM wants to call a tool
        if assistant_message.tool_calls:
            # Add assistant message with tool calls to history
            messages.append({
                "role": "assistant",
                "content": assistant_message.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        }
                    }
                    for tc in assistant_message.tool_calls
                ]
            })

            # Execute each tool call
            for tool_call in assistant_message.tool_calls:
                if tool_call.function.name == "search_documents":
                    args = json.loads(tool_call.function.arguments)
                    results = await search_documents(
                        supabase=supabase,
                        query=args["query"],
                        user_id=user["id"],
                    )
                    sources.extend(results)

                    # Format results for LLM
                    if results:
                        tool_result = "\n\n".join([
                            f"From '{r.document_filename}' (chunk {r.chunk_index}, similarity: {r.similarity:.2f}):\n{r.content}"
                            for r in results
                        ])
                    else:
                        tool_result = "No relevant documents found."

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": tool_result,
                    })

            # Stream final response after tool results
            full_response = ""
            async for chunk in stream_chat_after_tool(messages, user["id"]):
                full_response += chunk
                yield json.dumps({"type": "text", "content": chunk})
        else:
            # No tool calls - stream directly (fallback for simple queries)
            full_response = ""
            async for chunk in stream_chat_completion(history, user["id"], request.thread_id):
                full_response += chunk
                yield json.dumps({"type": "text", "content": chunk})

        # Build metadata
        metadata = get_model_metadata()
        if sources:
            metadata["sources"] = _format_sources_for_metadata(sources)

        supabase.table("messages").insert({
            "thread_id": request.thread_id,
            "role": "assistant",
            "content": full_response,
            "metadata": metadata,
        }).execute()

        supabase.table("threads").update({"updated_at": "now()"}).eq("id", request.thread_id).execute()

        yield json.dumps({"type": "done", "content": ""})

    return EventSourceResponse(event_generator())
