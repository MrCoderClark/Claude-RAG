import os
from dataclasses import dataclass
from typing import AsyncGenerator, Optional

from langsmith import traceable
from langsmith.wrappers import wrap_openai
from openai import AsyncOpenAI

from app.config import LLMProvider, PROVIDER_PRESETS, settings

os.environ["LANGSMITH_API_KEY"] = settings.langsmith_api_key
os.environ["LANGSMITH_PROJECT"] = settings.langsmith_project
if settings.langsmith_tracing:
    os.environ["LANGSMITH_TRACING"] = "true"


SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "search_documents",
        "description": "Search the user's uploaded documents by content similarity. Use when the user asks a question that their documents might answer.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query - what to look for in the documents"
                }
            },
            "required": ["query"]
        }
    }
}

LIST_DOCUMENTS_TOOL = {
    "type": "function",
    "function": {
        "name": "list_documents",
        "description": "List all documents the user has uploaded. Use when the user asks what files or documents they have.",
        "parameters": {
            "type": "object",
            "properties": {},
        }
    }
}


@dataclass
class LLMConfig:
    provider: LLMProvider
    base_url: Optional[str]
    api_key: str
    model: str
    extra_headers: dict


def resolve_llm_config() -> LLMConfig:
    provider = settings.llm_provider
    preset = PROVIDER_PRESETS.get(provider, {})

    api_key = settings.llm_api_key

    # Resolve base URL (explicit override > preset > None for OpenAI)
    if settings.llm_base_url:
        base_url = settings.llm_base_url
    elif provider == LLMProvider.CUSTOM:
        base_url = settings.llm_base_url
    else:
        base_url = preset.get("base_url")

    # Resolve model (explicit override > preset default)
    model = settings.llm_model or preset.get("default_model", "gpt-4o-mini")

    # Extra headers for OpenRouter
    extra_headers = {}
    if provider == LLMProvider.OPENROUTER:
        extra_headers["HTTP-Referer"] = settings.openrouter_app_name

    return LLMConfig(
        provider=provider,
        base_url=base_url,
        api_key=api_key,
        model=model,
        extra_headers=extra_headers,
    )


_config = resolve_llm_config()

# Build client with resolved config
_client_kwargs = {"api_key": _config.api_key or "not-needed"}
if _config.base_url:
    _client_kwargs["base_url"] = _config.base_url
if _config.extra_headers:
    _client_kwargs["default_headers"] = _config.extra_headers

client = wrap_openai(AsyncOpenAI(**_client_kwargs))


def get_model_metadata() -> dict:
    return {"provider": _config.provider.value, "model": _config.model}


@traceable(name="chat_completion")
async def stream_chat_completion(
    messages: list[dict], user_id: str, thread_id: str
) -> AsyncGenerator[str, None]:
    response = await client.chat.completions.create(
        model=_config.model,
        messages=messages,
        stream=True,
        user=user_id,
    )

    async for chunk in response:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


@traceable(name="chat_completion_with_tools")
async def get_chat_completion_with_tools(
    messages: list[dict],
    user_id: str,
):
    """
    Get a chat completion that may include tool calls.
    Returns the full response object (not streaming).
    """
    response = await client.chat.completions.create(
        model=_config.model,
        messages=messages,
        tools=[SEARCH_TOOL, LIST_DOCUMENTS_TOOL],
        user=user_id,
    )
    return response.choices[0].message


@traceable(name="chat_completion_after_tool")
async def stream_chat_after_tool(
    messages: list[dict],
    user_id: str,
) -> AsyncGenerator[str, None]:
    """
    Stream a chat completion after tool results have been added.
    No tools offered - this is the final response.
    """
    response = await client.chat.completions.create(
        model=_config.model,
        messages=messages,
        stream=True,
        user=user_id,
    )

    async for chunk in response:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
