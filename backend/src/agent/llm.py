import logging
from typing import Any

from langchain_anthropic import ChatAnthropic
from pydantic import SecretStr

from src.config import settings

logger = logging.getLogger(__name__)

_llm_instance: ChatAnthropic | None = None


def get_llm_for_agent() -> Any:
    """Return a cached ChatAnthropic LLM instance for agent use."""
    global _llm_instance  # noqa: PLW0603
    if _llm_instance is None:
        if not settings.anthropic_api_key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY not configured — agent chat is unavailable"
            )
        logger.info("Initialising agent LLM: claude-sonnet-4-6")
        _llm_instance = ChatAnthropic(  # type: ignore[call-arg]
            model="claude-sonnet-4-6",
            anthropic_api_key=SecretStr(settings.anthropic_api_key),
            temperature=0.3,
            max_tokens=4096,
        )
    return _llm_instance
