from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from src.exceptions import EmbeddingApiKeyMissingError, EmbeddingDimensionError


def _mock_response(values: list[float]) -> SimpleNamespace:
    embedding = SimpleNamespace(values=values)
    return SimpleNamespace(embeddings=[embedding])


@pytest.fixture(autouse=True)
def _reset_service_client() -> None:  # type: ignore[misc]
    # Each test gets a fresh lazy client so `patch` on `genai.Client` takes effect.
    from src.services import embedding_service

    embedding_service._client = None
    yield
    embedding_service._client = None


def test_generate_embedding_happy_path() -> None:
    from src.services import embedding_service

    values = [0.1] * 768
    fake_client = MagicMock()
    fake_client.models.embed_content.return_value = _mock_response(values)

    with (
        patch("src.services.embedding_service.settings.google_api_key", "fake-key"),
        patch("google.genai.Client", return_value=fake_client) as client_ctor,
    ):
        result = embedding_service.generate_embedding("hello world")

    assert result == values
    assert len(result) == 768
    # Client is constructed with the key AND an http_options carrying a
    # bounded timeout (ms) so a stuck API can't pin a worker thread.
    assert client_ctor.call_count == 1
    ctor_kwargs = client_ctor.call_args.kwargs
    assert ctor_kwargs["api_key"] == "fake-key"
    assert ctor_kwargs["http_options"].timeout and ctor_kwargs["http_options"].timeout > 0
    fake_client.models.embed_content.assert_called_once()
    call_kwargs = fake_client.models.embed_content.call_args.kwargs
    assert call_kwargs["contents"] == "hello world"
    assert call_kwargs["model"]  # embedding_model from settings
    # output_dimensionality is forced to 768 so gemini-embedding-001
    # returns vectors matching our VECTOR(768) schema.
    assert call_kwargs["config"].output_dimensionality == 768


def test_generate_embedding_wrong_dimension() -> None:
    from src.services import embedding_service

    fake_client = MagicMock()
    fake_client.models.embed_content.return_value = _mock_response([0.1] * 512)

    with (
        patch("src.services.embedding_service.settings.google_api_key", "fake-key"),
        patch("google.genai.Client", return_value=fake_client),
        pytest.raises(EmbeddingDimensionError),
    ):
        embedding_service.generate_embedding("hi")


def test_generate_embedding_missing_api_key() -> None:
    from src.services import embedding_service

    with (
        patch("src.services.embedding_service.settings.google_api_key", ""),
        pytest.raises(EmbeddingApiKeyMissingError),
    ):
        embedding_service.generate_embedding("hi")


def test_generate_embedding_api_error_propagates() -> None:
    from src.services import embedding_service

    fake_client = MagicMock()
    fake_client.models.embed_content.side_effect = RuntimeError("boom")

    with (
        patch("src.services.embedding_service.settings.google_api_key", "fake-key"),
        patch("google.genai.Client", return_value=fake_client),
        pytest.raises(RuntimeError, match="boom"),
    ):
        embedding_service.generate_embedding("hi")


def test_generate_embedding_client_is_lazily_constructed_once() -> None:
    from src.services import embedding_service

    values = [0.1] * 768
    fake_client = MagicMock()
    fake_client.models.embed_content.return_value = _mock_response(values)

    with (
        patch("src.services.embedding_service.settings.google_api_key", "fake-key"),
        patch("google.genai.Client", return_value=fake_client) as client_ctor,
    ):
        embedding_service.generate_embedding("first")
        embedding_service.generate_embedding("second")
        embedding_service.generate_embedding("third")

    assert client_ctor.call_count == 1
    assert fake_client.models.embed_content.call_count == 3
