import json
import queue
import random
import time
from collections.abc import Iterator
from typing import Any

from src.agent.skills.registry import SKILL_REGISTRY, SkillContext

AGENT_CHUNK_DELAY_MS: int = 50


def _chunk_words(text: str) -> list[str]:
    """Split text into word groups of 2-5 words each."""
    words = text.split()
    chunks: list[str] = []
    idx = 0
    while idx < len(words):
        size = random.randint(2, 5)  # noqa: S311
        group = words[idx : idx + size]
        chunks.append(" ".join(group))
        idx += size
    return chunks


def run_crew(ctx: SkillContext, skill_name: str) -> None:
    """Run the crew in a daemon thread, emitting SSE events via ctx.event_queue."""
    q: queue.Queue[dict[str, Any] | None] = ctx.event_queue
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
            q.put({"type": "chunk", "text": prose})
        else:
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
        q.put(None)

    except Exception as exc:  # noqa: BLE001
        q.put(
            {
                "type": "error",
                "code": "agent_crew_failed",
                "message": str(exc),
                "recoverable": False,
            }
        )
        q.put(None)


def stream_sse(event_queue: "queue.Queue[dict[str, Any] | None]") -> Iterator[str]:
    """Yield SSE-formatted strings until the None sentinel is received."""
    while True:
        item = event_queue.get()
        if item is None:
            break
        yield f"data: {json.dumps(item)}\n\n"
