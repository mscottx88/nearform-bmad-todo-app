from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/todo_pond"
    google_api_key: str = ""
    embedding_model: str = "models/text-embedding-004"
    cors_origins: str = "http://localhost:5173"
    archive_threshold_days: int = 30

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
