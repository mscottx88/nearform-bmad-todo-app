from pydantic import Field, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/todo_pond"
    google_api_key: str = ""
    anthropic_api_key: str = ""
    embedding_model: str = "gemini-embedding-001"
    cors_origins: str = "http://localhost:5173"
    # archive is deprecated in v1 (see architecture.md) but the setting is
    # still honoured by any future re-enablement; zero/negative days would
    # silently archive everything, so enforce strict positivity.
    archive_threshold_days: int = Field(default=30, gt=0)

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    @field_validator("database_url")
    @classmethod
    def _validate_database_url(cls, value: str) -> str:
        # Catch the common misconfigurations at startup rather than
        # surfacing them as opaque SQLAlchemy errors on the first query.
        # We accept any `<driver>+<dialect>://...` form — SQLAlchemy will
        # do the real parsing; this is just a shape check.
        if not value:
            raise ValueError("DATABASE_URL must not be empty")
        if "://" not in value:
            raise ValueError(
                "DATABASE_URL must contain '://' (e.g. postgresql+psycopg://user:pass@host/db)",
            )
        return value

    @field_validator("anthropic_api_key")
    @classmethod
    def _validate_anthropic_api_key(cls, value: str) -> str:
        if value and not value.strip():
            raise ValueError(
                "ANTHROPIC_API_KEY is whitespace-only — "
                "set a real key or leave unset/empty",
            )
        return value

    @field_validator("google_api_key")
    @classmethod
    def _validate_google_api_key(cls, value: str) -> str:
        # Empty is the explicit "run without embeddings" mode — main.py
        # logs a WARNING and the worker gracefully leaves todos at
        # embedding_status='pending'. Whitespace-only, however, is
        # always a misconfiguration: it's truthy enough to sidestep the
        # `if not settings.google_api_key` guards, reaches the Google
        # API, and fails opaquely for every single todo. Normalise.
        if value and not value.strip():
            raise ValueError(
                "GOOGLE_API_KEY is whitespace-only — set a real key or leave unset/empty",
            )
        return value


settings = Settings()
