"""Google `gemini-embedding-001` wrapper — 768-dim vector for todo text.

The model natively returns 3072-dim vectors; we force 768 via
`EmbedContentConfig(output_dimensionality=768)` to match the
`VECTOR(768)` column + HNSW index landed in Epic 1's initial migration.

Retry/backoff are the caller's responsibility (see
`src.workers.embedding_worker`). This module is a thin, stateless wrapper
that either returns a valid 768-dim `list[float]` or raises.

The HTTP client is configured with a bounded per-request timeout so a
stuck Google endpoint cannot pin a worker thread (and, transitively,
cannot pin FastAPI lifespan shutdown waiting for the executor to drain).
"""

from google import genai
from google.genai import types

from src.config import settings
from src.exceptions import EmbeddingApiKeyMissingError, EmbeddingDimensionError

EMBEDDING_DIMENSION = 768
EMBEDDING_REQUEST_TIMEOUT_MS = 15_000

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        if not settings.google_api_key:
            raise EmbeddingApiKeyMissingError()
        _client = genai.Client(
            api_key=settings.google_api_key,
            http_options=types.HttpOptions(timeout=EMBEDDING_REQUEST_TIMEOUT_MS),
        )
    return _client


def generate_embedding(text: str) -> list[float]:
    if not settings.google_api_key:
        raise EmbeddingApiKeyMissingError()

    client = _get_client()
    response = client.models.embed_content(
        model=settings.embedding_model,
        contents=text,
        config=types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIMENSION),
    )

    embeddings = getattr(response, "embeddings", None) or []
    if not embeddings:
        raise EmbeddingDimensionError(got=0, expected=EMBEDDING_DIMENSION)

    values = list(embeddings[0].values or [])
    if len(values) != EMBEDDING_DIMENSION:
        raise EmbeddingDimensionError(got=len(values), expected=EMBEDDING_DIMENSION)

    return values
