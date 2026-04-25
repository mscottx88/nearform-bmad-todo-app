import logging
import threading
from typing import Any

from crewai import LLM

from src.config import settings

logger = logging.getLogger(__name__)

# Story 6.1 CR P17: double-checked locking around the singleton.
# The previous `if _llm_instance is None: _llm_instance = ChatAnthropic(...)`
# was racy — two concurrent first requests (a common burst when SSE
# connections open) would both pass the None-check and both construct a
# client, with the second clobbering the first. Fast-path still reads the
# cached instance without taking the lock; only the first-construction
# path pays the lock cost.
#
# Story 6.2 fix: switched from LangChain's `ChatAnthropic` to CrewAI's
# native `LLM` class. CrewAI 1.0+ wraps non-native LLM objects via
# LiteLLM-style adapters and falls back to OpenAI when it can't
# recognise the provider — that fallback path raises
# "Error importing native provider: OPENAI_API_KEY is required" the
# moment a real chat hits the wire, even with `ANTHROPIC_API_KEY`
# correctly set. Using `crewai.LLM(model="anthropic/...")` routes
# through LiteLLM's anthropic provider directly with no fallback.
_llm_instance: LLM | None = None
_llm_lock = threading.Lock()


def get_llm_for_agent() -> Any:
    """Return a cached CrewAI LLM instance configured for Claude.

    Lazily constructs a `crewai.LLM` on first call and caches it for the
    rest of the process. Raises if `ANTHROPIC_API_KEY` is unset rather
    than letting CrewAI's OpenAI fallback path surface a confusing
    "OPENAI_API_KEY is required" error at chat time.
    """
    global _llm_instance  # noqa: PLW0603
    if _llm_instance is None:
        with _llm_lock:
            if _llm_instance is None:
                if not settings.anthropic_api_key:
                    raise RuntimeError(
                        "ANTHROPIC_API_KEY not configured — agent chat is unavailable"
                    )
                logger.info("Initialising agent LLM: claude-sonnet-4-6")
                # `model="anthropic/<id>"` is the LiteLLM-style provider
                # prefix CrewAI uses to pick the Anthropic native client.
                _llm_instance = LLM(
                    model="anthropic/claude-sonnet-4-6",
                    api_key=settings.anthropic_api_key,
                    temperature=0.3,
                    max_tokens=4096,
                )
    return _llm_instance
