import os
from typing import AsyncGenerator

from langsmith import traceable
from langsmith.wrappers import wrap_openai
from openai import AsyncOpenAI

from app.config import settings

os.environ["LANGSMITH_API_KEY"] = settings.langsmith_api_key
os.environ["LANGSMITH_PROJECT"] = settings.langsmith_project
if settings.langsmith_tracing:
    os.environ["LANGSMITH_TRACING"] = "true"

client = wrap_openai(AsyncOpenAI(api_key=settings.openai_api_key))


@traceable(name="chat_completion")
async def stream_chat_completion(
    messages: list[dict], user_id: str, thread_id: str
) -> AsyncGenerator[str, None]:
    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        stream=True,
        user=user_id,
    )

    async for chunk in response:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
