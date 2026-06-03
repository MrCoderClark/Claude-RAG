from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    supabase_jwt_secret: str
    openai_api_key: str
    langsmith_api_key: str = ""
    langsmith_project: str = "claude-rag"
    langsmith_tracing: bool = True


settings = Settings()
