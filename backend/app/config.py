from enum import Enum
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class LLMProvider(str, Enum):
    OPENAI = "openai"
    OPENROUTER = "openrouter"
    OLLAMA = "ollama"
    LM_STUDIO = "lm_studio"
    CUSTOM = "custom"


PROVIDER_PRESETS = {
    LLMProvider.OPENAI: {
        "base_url": None,
        "default_model": "gpt-4o-mini",
        "requires_key": True,
    },
    LLMProvider.OPENROUTER: {
        "base_url": "https://openrouter.ai/api/v1",
        "default_model": "openai/gpt-4o-mini",
        "requires_key": True,
    },
    LLMProvider.OLLAMA: {
        "base_url": "http://localhost:11434/v1",
        "default_model": "llama3.2",
        "requires_key": False,
    },
    LLMProvider.LM_STUDIO: {
        "base_url": "http://localhost:1234/v1",
        "default_model": "local-model",
        "requires_key": False,
    },
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    supabase_jwt_secret: str

    # LLM settings
    llm_provider: LLMProvider = LLMProvider.OPENAI
    llm_api_key: str = ""
    llm_model: Optional[str] = None
    llm_base_url: Optional[str] = None
    openrouter_app_name: str = "Claude RAG"

    langsmith_api_key: str = ""
    langsmith_project: str = "claude-rag"
    langsmith_tracing: bool = True


settings = Settings()
