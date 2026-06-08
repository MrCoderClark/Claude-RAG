import os
from dataclasses import dataclass
from typing import Optional

from langsmith import traceable
from langsmith.wrappers import wrap_openai
from openai import AsyncOpenAI

from app.config import EmbeddingProvider, EMBEDDING_PRESETS, settings

os.environ["LANGSMITH_API_KEY"] = settings.langsmith_api_key
os.environ["LANGSMITH_PROJECT"] = settings.langsmith_project


@dataclass
class EmbeddingConfig:
    provider: EmbeddingProvider
    base_url: Optional[str]
    api_key: str
    model: str
    dimensions: int


def resolve_embedding_config() -> EmbeddingConfig:
    provider = settings.embedding_provider
    preset = EMBEDDING_PRESETS.get(provider, {})

    api_key = settings.embedding_api_key

    if settings.embedding_base_url:
        base_url = settings.embedding_base_url
    elif provider == EmbeddingProvider.CUSTOM:
        base_url = settings.embedding_base_url
    else:
        base_url = preset.get("base_url")

    model = settings.embedding_model or preset.get("default_model", "text-embedding-3-small")
    dimensions = settings.embedding_dimensions

    return EmbeddingConfig(
        provider=provider,
        base_url=base_url,
        api_key=api_key,
        model=model,
        dimensions=dimensions,
    )


_config = resolve_embedding_config()

_client_kwargs = {"api_key": _config.api_key or "not-needed"}
if _config.base_url:
    _client_kwargs["base_url"] = _config.base_url

client = wrap_openai(AsyncOpenAI(**_client_kwargs))


@traceable(name="embed_texts")
async def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []

    response = await client.embeddings.create(
        model=_config.model,
        input=texts,
        dimensions=_config.dimensions,
    )

    return [item.embedding for item in response.data]


def get_embedding_dimensions() -> int:
    return _config.dimensions
