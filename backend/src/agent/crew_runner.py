import json
import queue
import random
import threading
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from src.agent.skills.registry import SKILL_REGISTRY, SkillContext

AGENT_CHUNK_DELAY_MS: int = 50
# Per-chunk delay must stay inside the spec's 30-80ms range. Validated at
# module load (deferred from Group C: "AGENT_CHUNK_DELAY_MS no range
# validation") so a config typo fails loudly at import rather than
# silently shipping a bad UX.
assert 30 <= AGENT_CHUNK_DELAY_MS <= 80, (  # noqa: S101
    f"AGENT_CHUNK_DELAY_MS must be in [30, 80] ms; got {AGENT_CHUNK_DELAY_MS}"
)

# Hard cap on the number of chunks produced for a single LLM response.
# Deferred from Group C: a 100k-word LLM run would otherwise produce 100k
# queue events, balloon memory, and saturate the SSE consumer. Once the
# cap is reached `_chunk_words` truncates and adds an explicit ellipsis
# marker so the SSE consumer can render "[truncated]" if it cares.
MAX_CHUNKS_PER_RUN: int = 500


@dataclass(frozen=True)
class CrewResult:
    """Outcome of `run_crew` for the API layer to finalise the assistant row.

    Story 6.1 CR P24 introduced this so the wrapper in `api/agent.py` can
    write `content=prose, status='complete'` on success or
    `content='Agent run failed', status='failed', error=...` on failure
    — without the wrapper having to inspect the streamed event queue.

    Story 6.2 Group A CR P1: `cancelled` lets `finalise_assistant_message`
    distinguish a user-cancelled run (status='cancelled') from a generic
    failure (status='failed'). `success` stays False on the cancel path
    so existing branches treat it as a non-success terminal state.

    Story 6.3: `metadata` carries the proposal envelope (`{"proposal":
    {...}}`) for skills whose `proposal_kind` is non-None. The API layer
    passes it through to `chat_service.update_message(metadata=...)` so
    the frontend can re-hydrate the proposal from
    `GET /api/agent/sessions/{id}/messages` after a panel close+reopen.
    """

    success: bool
    prose: str
    error: str | None
    cancelled: bool = False
    metadata: dict[str, Any] | None = None


def _chunk_words(text: str) -> list[str]:
    """Split text into word groups of 2-5 words, preserving line breaks.

    Story 6.1 CR P18: the previous implementation called `text.split()` /
    `" ".join(group)` which discarded every whitespace run — code fences,
    bullets, and paragraph breaks in LLM output collapsed to a single
    line on the client. We now split on `\\n` first and emit each line
    break as its own chunk so the SSE consumer can reconstruct paragraph
    structure by concatenating the texts.

    Story 6.2 fix: each non-first chunk on a line is prefixed with a
    leading space so raw concatenation of every chunk reconstructs the
    original prose with word boundaries intact. The previous shape
    (``"hello"``, ``"world"``) concatenated to ``"helloworld"`` because
    the SSE consumer in `useAgentSse` does a byte-level stitch — not a
    space-joined merge — which surfaced as run-together output in the
    chat panel (e.g. ``"don'thave access"``). Newline chunks reset the
    "first chunk on line" flag so the chunk after a `\\n` does NOT pick
    up an unwanted leading space.

    Story 6.2 Group A CR:
    - **P3** — split on `\\r?\\n` (normalize `\\r\\n` and bare `\\r` to
      `\\n` first) so Windows-style line endings round-trip cleanly
      through the byte-level SSE stitch.
    - **P4** — `MAX_CHUNKS_PER_RUN` cap is checked before the per-line
      newline append as well, so a 1000-line empty-line response can't
      slip past the cap by emitting only `\\n` chunks.
    - **P9** — fenced code blocks (lines starting with ` ``` ` after
      lstrip) stream verbatim line-by-line — leading whitespace and
      multi-space runs survive byte-level concat. Prose outside fences
      keeps the existing word-tokenization behavior (multi-space runs
      in prose still collapse to single spaces; that's a deliberate
      product decision per the code-review D3 ruling).
    """
    # P3: normalize line endings so a `\r\n` stream from the LLM can
    # round-trip via raw concat without dropping the trailing `\r`.
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    chunks: list[str] = []
    truncated = False
    in_code_block = False
    for i, line in enumerate(lines):
        if truncated:
            break

        is_fence = line.lstrip().startswith("```")
        if is_fence:
            # P9: fence boundary toggles code-block mode; the fence line
            # itself is emitted verbatim so `"".join(chunks)` reconstructs
            # the original text.
            in_code_block = not in_code_block
            if len(chunks) >= MAX_CHUNKS_PER_RUN:
                truncated = True
                break
            chunks.append(line)
        elif in_code_block:
            # P9: inside a fenced block — emit the line verbatim,
            # preserving leading whitespace (indentation) and any
            # multi-space runs that the prose path would otherwise
            # collapse via `line.split()`.
            if len(chunks) >= MAX_CHUNKS_PER_RUN:
                truncated = True
                break
            chunks.append(line)
        else:
            words = line.split()
            idx = 0
            is_first_chunk_on_line = True
            while idx < len(words):
                if len(chunks) >= MAX_CHUNKS_PER_RUN:
                    truncated = True
                    break
                size = random.randint(2, 5)  # noqa: S311
                group = words[idx : idx + size]
                text_part = " ".join(group)
                # Restore the inter-chunk space the splitter consumed so
                # `"".join(chunks)` round-trips to the original prose
                # (modulo whitespace runs collapsed to single spaces).
                if not is_first_chunk_on_line:
                    text_part = " " + text_part
                chunks.append(text_part)
                is_first_chunk_on_line = False
                idx += size

        # P4: the cap check now also gates the per-line newline append so
        # a pathological response (1000 empty lines, no words) can't
        # bypass `MAX_CHUNKS_PER_RUN` via `\n`-only chunks.
        if not truncated and i < len(lines) - 1:
            if len(chunks) >= MAX_CHUNKS_PER_RUN:
                truncated = True
                break
            chunks.append("\n")
    if truncated:
        chunks.append("…[truncated]")
    return chunks


@dataclass(frozen=True)
class _ProposalParseError:
    """Sentinel returned by `_extract_proposal_envelope` on failure.

    Distinct codes (`agent_invalid_proposal_missing` vs
    `agent_invalid_proposal_shape`) make ops triage easier — a
    consistently-empty `result.pydantic` points at a CrewAI parse
    failure, while a shape mismatch hints at a schema drift.
    """

    code: str
    message: str


def _extract_proposal_envelope(
    crew_output: Any,
    proposal_kind: str,
    resolved_target_id: uuid.UUID | None,
    resolved_candidates: Any = None,
) -> dict[str, Any] | _ProposalParseError:
    """Convert a `CrewOutput` whose Task carries `output_pydantic` into
    the canonical wire envelope for the `proposal` SSE event +
    `chat_messages.metadata.proposal` row.

    Story 6.3: CrewAI sets `CrewOutput.pydantic` to the parsed model
    instance after schema validation. If that attribute is missing or
    not a BaseModel (CrewAI failed to parse the LLM output despite
    `output_pydantic`), we fail the run with a controlled error code.

    The envelope's `targets` list is single-element for v1's
    `text_rewrite` kind. Future kinds (e.g. `position_deltas`) may
    populate multiple ids; the wire shape is array-typed already.

    `resolved_candidates` (when non-empty) is folded into
    `payload.candidates` so the renderer can show clickable
    disambiguation chips. The LLM does not produce these — they come
    from the server-side search resolver inside the skill's `build()`.
    """
    pydantic_instance = getattr(crew_output, "pydantic", None)
    if pydantic_instance is None or not isinstance(pydantic_instance, BaseModel):
        return _ProposalParseError(
            code="agent_invalid_proposal_missing",
            message="Skill produced no parseable structured output",
        )
    payload = pydantic_instance.model_dump()
    # Validate the keys we care about are present — model_dump() of a
    # well-formed RephraseEnvelope will always include them, but a
    # future skill might wire a different model and we don't want a
    # silent KeyError downstream.
    if "reasoning" not in payload or "suggestions" not in payload:
        return _ProposalParseError(
            code="agent_invalid_proposal_shape",
            message="Structured output is missing required keys",
        )
    reasoning = payload.pop("reasoning")
    if not isinstance(reasoning, str) or not reasoning.strip():
        return _ProposalParseError(
            code="agent_invalid_proposal_shape",
            message="Structured output `reasoning` must be a non-empty string",
        )
    if resolved_candidates:
        # Pydantic models in the candidates list need to round-trip
        # through model_dump for JSON serialisation; UUIDs become
        # strings, etc.
        payload["candidates"] = [
            c.model_dump(mode="json") if hasattr(c, "model_dump") else c
            for c in resolved_candidates
        ]
    targets = [str(resolved_target_id)] if resolved_target_id is not None else []
    return {
        "kind": proposal_kind,
        "payload": payload,
        "targets": targets,
        "reasoning": reasoning,
    }


def run_crew(
    ctx: SkillContext,
    skill_name: str,
    assistant_message_id: uuid.UUID,
    cancel_event: threading.Event | None = None,
) -> CrewResult:
    """Run the crew in a daemon thread, emitting SSE events via ctx.event_queue.

    Returns a `CrewResult` so the calling wrapper can finalise the
    assistant DB row (Story 6.1 CR P24). The terminal `None` sentinel is
    enqueued in a `finally` block (P16). An empty LLM response surfaces
    as `agent_empty_response` and is reported as a failed result (P20).

    Story 6.2 AC 11: `assistant_message_id` is echoed back in the `start`
    event payload so the SSE consumer can bind subsequent
    `chunk`/`done`/`error` events to the right assistant DB row.

    Story 6.2 Group A CR:
    - **P1** — `cancel_event` is now threaded through. Checked before
      `crew.kickoff()` (cheap pre-check), and between every chunk emit
      (between LLM-call completion and chunk streaming, the user can
      still abort the typing animation). The LLM call itself is not
      interruptible from the outside; we accept best-effort cancel and
      stop emitting further chunks. On cancel we emit a `cancelled`
      event and return `CrewResult(success=False, cancelled=True, ...)`
      so `finalise_assistant_message` writes status='cancelled'.
    - **P5** — `skill_name` is validated against `SKILL_REGISTRY` before
      we dispatch. A KeyError on a missing skill name now surfaces as a
      controlled `unknown_skill` error code with no leak of the raw
      KeyError repr into the user-visible payload.
    """
    q: queue.Queue[dict[str, Any] | None] = ctx.event_queue
    prose = ""

    # P5: pre-check the skill name. Previously a missing skill produced
    # a `KeyError` caught by the broad-except below and reported as
    # `agent_crew_failed` with the raw `KeyError(<skill name>)` repr in
    # the user-visible message field. Surfacing the raw key name is a
    # mild leak (a buggy classifier could echo arbitrary strings into
    # the error payload). Emit a controlled error code instead.
    if skill_name not in SKILL_REGISTRY:
        q.put(
            {
                "type": "error",
                "code": "unknown_skill",
                "message": "Requested skill is not registered",
                "recoverable": False,
            }
        )
        q.put(None)
        return CrewResult(success=False, prose="", error="unknown_skill")

    def _emit_cancelled() -> CrewResult:
        q.put({"type": "cancelled", "message_id": str(assistant_message_id)})
        return CrewResult(
            success=False,
            prose=prose,
            error="cancelled",
            cancelled=True,
        )

    try:
        spec = SKILL_REGISTRY[skill_name]
        crew = spec.builder(ctx)

        q.put(
            {
                "type": "start",
                "session_id": str(ctx.session_id),
                "skill": skill_name,
                "message_id": str(assistant_message_id),
            }
        )

        # P1: cheap pre-check so an instantly-cancelled request avoids
        # paying for the LLM round-trip. Past this point `crew.kickoff()`
        # blocks uninterruptibly until the LLM responds.
        if cancel_event is not None and cancel_event.is_set():
            return _emit_cancelled()

        result = crew.kickoff()

        # P1: the LLM call may have taken seconds to minutes; the user
        # may have hit Cancel during it. Re-check before we start the
        # typing-animation chunk stream — the user expects "Cancel"
        # to at least stop new content from appearing.
        if cancel_event is not None and cancel_event.is_set():
            return _emit_cancelled()

        # Story 6.3: skills with a `proposal_kind` set produce a
        # Pydantic-validated envelope (Task.output_pydantic). CrewAI
        # exposes the parsed model via `CrewOutput.pydantic`; we fold
        # it into the canonical wire shape and emit the `proposal`
        # event before any chunks fire. On extraction failure, emit
        # `agent_invalid_proposal` and fail the run — never silently
        # fall back to streaming the raw output.
        envelope_metadata: dict[str, Any] | None = None
        if spec.proposal_kind is not None:
            extracted = _extract_proposal_envelope(
                result,
                spec.proposal_kind,
                ctx.resolved_target_id,
                getattr(ctx, "resolved_candidates", None),
            )
            if isinstance(extracted, _ProposalParseError):
                q.put(
                    {
                        "type": "error",
                        "code": extracted.code,
                        "message": extracted.message,
                        "recoverable": False,
                    }
                )
                return CrewResult(success=False, prose="", error=extracted.code)
            envelope = extracted
            q.put(
                {
                    "type": "proposal",
                    "kind": envelope["kind"],
                    "payload": envelope["payload"],
                    "targets": envelope["targets"],
                    "reasoning": envelope["reasoning"],
                }
            )
            envelope_metadata = {"proposal": envelope}
            prose = envelope["reasoning"]
        else:
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
            # P1: per-chunk cancel check. Best-effort: the chunk emit is
            # cheap, so we re-read the Event flag rather than wait on it.
            if cancel_event is not None and cancel_event.is_set():
                return _emit_cancelled()
            q.put({"type": "chunk", "text": chunk})
            time.sleep(actual_delay_s)

        q.put({"type": "done"})
        return CrewResult(
            success=True, prose=prose, error=None, metadata=envelope_metadata
        )

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
