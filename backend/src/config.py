from pydantic import Field, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/todo_pond"
    google_api_key: str = ""
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


settings = Settings()
