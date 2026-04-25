import json
import queue
import random
import time
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from src.agent.skills.registry import SKILL_REGISTRY, SkillContext

AGENT_CHUNK_DELAY_MS: int = 50


@dataclass(frozen=True)
class CrewResult:
    """Outcome of `run_crew` for the API layer to finalise the assistant row.

    Story 6.1 CR P24 introduced this so the wrapper in `api/agent.py` can
    write `content=prose, status='complete'` on success or
    `content='Agent run failed', status='failed', error=...` on failure
    — without the wrapper having to inspect the streamed event queue.
    """

    success: bool
    prose: str
    error: str | None


def _chunk_words(text: str) -> list[str]:
    """Split text into word groups of 2-5 words, preserving line breaks.

    Story 6.1 CR P18: the previous implementation called `text.split()` /
    `" ".join(group)` which discarded every whitespace run — code fences,
    bullets, and paragraph breaks in LLM output collapsed to a single
    line on the client. We now split on `\\n` first and emit each line
    break as its own chunk so the SSE consumer can reconstruct paragraph
    structure by concatenating the texts.
    """
    lines = text.split("\n")
    chunks: list[str] = []
    for i, line in enumerate(lines):
        words = line.split()
        idx = 0
        while idx < len(words):
            size = random.randint(2, 5)  # noqa: S311
            group = words[idx : idx + size]
            chunks.append(" ".join(group))
            idx += size
        if i < len(lines) - 1:
            chunks.append("\n")
    return chunks


def run_crew(ctx: SkillContext, skill_name: str) -> CrewResult:
    """Run the crew in a daemon thread, emitting SSE events via ctx.event_queue.

    Returns a `CrewResult` so the calling wrapper can finalise the
    assistant DB row (Story 6.1 CR P24). The terminal `None` sentinel is
    enqueued in a `finally` block (P16). An empty LLM response surfaces
    as `agent_empty_response` and is reported as a failed result (P20).
    """
    q: queue.Queue[dict[str, Any] | None] = ctx.event_queue
    prose = ""
    try:
        spec = SKILL_REGISTRY[skill_name]
        crew = spec.builder(ctx)

        q.put(
            {
                "type": "start",
                "session_id": str(ctx.session_id),
                "skill": skill_name,
            }
        )

        result = crew.kickoff()
        prose = str(result).strip()
        chunks = _chunk_words(prose)
        chunk_count = len(chunks)

        if chunk_count == 0:
            q.put(
                {
                    "type": "error",
                    "code": "agent_empty_response",
                    "message": "Agent returned no content",
                    "recoverable": True,
                }
            )
            return CrewResult(success=False, prose="", error="agent returned no content")

        # Cap total simulated typing at 3 seconds.
        raw_delay_s = AGENT_CHUNK_DELAY_MS / 1000.0
        if chunk_count * raw_delay_s > 3.0:
            actual_delay_s = 3.0 / chunk_count
        else:
            actual_delay_s = raw_delay_s

        for chunk in chunks:
            q.put({"type": "chunk", "text": chunk})
            time.sleep(actual_delay_s)

        q.put({"type": "done"})
        return CrewResult(success=True, prose=prose, error=None)

    except Exception as exc:  # noqa: BLE001
        q.put(
            {
                "type": "error",
                "code": "agent_crew_failed",
                "message": str(exc),
                "recoverable": False,
            }
        )
        return CrewResult(success=False, prose="", error=str(exc))
    finally:
        q.put(None)


def stream_sse(event_queue: "queue.Queue[dict[str, Any] | None]") -> Iterator[str]:
    """Yield SSE-formatted strings until the None sentinel is received."""
    while True:
        item = event_queue.get()
        if item is None:
            break
        yield f"data: {json.dumps(item)}\n\n"
