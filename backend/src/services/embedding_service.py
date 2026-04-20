"""Google `text-embedding-004` wrapper — 768-dim vector for todo text.

Retry/backoff are the caller's responsibility (see
`src.workers.embedding_worker`). This module is a thin, stateless wrapper
that either returns a valid 768-dim `list[float]` or raises.
"""

from google import genai

from src.config import settings
from src.exceptions import EmbeddingApiKeyMissingError, EmbeddingDimensionError

EMBEDDING_DIMENSION = 768

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        if not settings.google_api_key:
            raise EmbeddingApiKeyMissingError()
        _client = genai.Client(api_key=settings.google_api_key)
    return _client


def generate_embedding(text: str) -> list[float]:
    if not settings.google_api_key:
        raise EmbeddingApiKeyMissingError()

    client = _get_client()
    response = client.models.embed_content(
        model=settings.embedding_model,
        contents=text,
    )

    embeddings = getattr(response, "embeddings", None) or []
    if not embeddings:
        raise EmbeddingDimensionError(got=0, expected=EMBEDDING_DIMENSION)

    values = list(embeddings[0].values or [])
    if len(values) != EMBEDDING_DIMENSION:
        raise EmbeddingDimensionError(got=len(values), expected=EMBEDDING_DIMENSION)

    return values
