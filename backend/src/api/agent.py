import logging
import queue
import threading
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from src.agent.crew_runner import CrewResult, run_crew, stream_sse
from src.agent.llm import get_llm_for_agent
from src.agent.skills.registry import SKILL_REGISTRY, SkillContext
from src.database import SessionLocal, get_db
from src.exceptions import AppError, ChatMessageNotFoundError
from src.schemas.agent import (
    ChatMessageResponse,
    ChatRequest,
    ChatSessionResponse,
)
from src.services import chat_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent")

# In-memory cancellation map: session_id → {assistant_message_id → Event}.
#
# Story 6.1 CR P23: previously a flat dict keyed by assistant_message_id, which
# made `cancel_chat(session_id)` a global kill-switch (it iterated every entry
# and set every Event). The two-level shape lets `cancel_chat` look up only
# the events for the supplied session_id and leave other sessions untouched.
#
# Story 6.1 CR P27: every mutation goes through `_CANCEL_MAP_LOCK` because the
# chat handler, the worker thread's `finally`, and `cancel_chat` all touch
# this dict concurrently. Single-process only — multi-worker would need
# external state (Redis), already noted as a known limitation.
_CANCEL_MAP: dict[str, dict[str, threading.Event]] = {}
_CANCEL_MAP_LOCK = threading.Lock()

# Story 6.2 Group A CR P10: per-session lock to serialize the
# create-message + read-history critical section. Without this, two
# concurrent POSTs for the same session can interleave: request A's
# `list_recent_messages` may see request B's just-committed user row
# (which is NOT in A's `excluded_ids` set), so the agent receives an
# orphaned user line with no assistant reply. The frontend's Send/Stop
# guard makes this rare in practice (a single browser session can only
# have one stream in flight at a time), but two browser tabs on the
# same session, or a determined double-click, can still trigger it.
#
# The lock dict is bounded by the number of sessions ever seen by this
# process — pragmatic leak; restart drops it. Cleanup on session delete
# would couple this module to the lifecycle of a service-layer entity
# for negligible memory savings, so we accept the bound.
_SESSION_LOCKS: dict[str, threading.Lock] = {}
_SESSION_LOCKS_LOCK = threading.Lock()


def _get_session_lock(session_key: str) -> threading.Lock:
    """Return (creating if needed) the per-session critical-section lock."""
    with _SESSION_LOCKS_LOCK:
        lock = _SESSION_LOCKS.get(session_key)
        if lock is None:
            lock = threading.Lock()
            _SESSION_LOCKS[session_key] = lock
        return lock


# Internal skill names cannot be invoked directly through the API. The
# intent classifier is registered for `_classify_intent` to use; exposing
# it as a user-facing skill leaks an internal routing primitive.
_INTERNAL_SKILLS: frozenset[str] = frozenset({"intent_classifier"})

# Story 6.2 AC 12: how many recent messages we pre-load and pass to
# the chat skill via `SkillContext.history`. The chat handler trims
# this down to `complete` user/assistant rows (excluding the
# in-flight assistant placeholder) before building the SkillContext.
#
# 2026-04-26: bumped 20 → 50 after observing cross-skill context
# loss in real user flows. The chat skill could discuss a todo
# accurately on turn N (todo created earlier in the session), but
# turn N+1's rephrase-skill handoff lost the todo identity because
# the original turn that mentioned the todo's id had scrolled past
# the 20-turn window. Anything deeper than 50 still goes through
# `GetChatHistoryTool`. Token cost: ~50 turns × ~150 chars avg =
# ~7.5KB extra context per chat — negligible vs. the model's
# context window.
_HISTORY_WINDOW = 50


def finalise_assistant_message(
    assistant_msg_id: uuid.UUID,
    resolved_skill: str,
    result: CrewResult,
) -> None:
    """Write the final assistant DB row based on the run_crew CrewResult.

    Extracted as a module-level function (Story 6.1 CR Group E TP2) so
    the success / failure / row-vanished branches can be unit-tested
    without driving the full chat handler. Called from inside the worker
    thread spawned by `chat()` and bypasses the request-scoped session
    by opening its own `SessionLocal()`.

    P24: handles success path (update with content=prose, status=complete).
    P28: failure path writes generic 'Agent run failed.' into the
    user-visible content column; raw exception text only goes into the
    `error` column.

    Story 6.2 Group A CR:
    - **P1** — `result.cancelled` writes status='cancelled' so a
      user-aborted run is visually distinct from a generic crash.
    - **P7** — the success-path write and the failure-path write each
      get their own `SessionLocal()` block. Previously an unexpected
      exception during the success-path `update_message` (after partial
      ORM mutation) would roll back inside the single `with` block and
      leave the assistant row stuck in `pending` forever; we now
      attempt a fallback `failed` write in a fresh session so the row
      always reaches a terminal state.
    """
    try:
        if result.cancelled:
            with SessionLocal() as session:
                # CR: thread `result.metadata` through so a cancel that
                # arrives AFTER the proposal SSE emit still persists the
                # envelope to the row — otherwise reload would drop the
                # proposal block from a cancelled bubble.
                chat_service.update_message(
                    session,
                    assistant_msg_id,
                    content=result.prose or "Cancelled.",
                    status="cancelled",
                    skill=resolved_skill,
                    metadata=result.metadata,
                )
            return

        if result.success:
            with SessionLocal() as session:
                # Story 6.3: proposal-producing skills populate
                # `result.metadata` with `{"proposal": <envelope>}`;
                # plain chat skills leave it None. The frontend
                # rehydrates `metadata.proposal` from this row when
                # the panel re-opens.
                chat_service.update_message(
                    session,
                    assistant_msg_id,
                    content=result.prose,
                    status="complete",
                    skill=resolved_skill,
                    metadata=result.metadata,
                )
            return

        with SessionLocal() as session:
            chat_service.update_message(
                session,
                assistant_msg_id,
                content="Agent run failed.",
                status="failed",
                skill=resolved_skill,
                error=result.error,
            )
    except ChatMessageNotFoundError:
        logger.warning(
            "assistant message %s vanished during finalisation",
            assistant_msg_id,
        )
    except Exception:  # noqa: BLE001
        # Deferred from Group D: previously any non-NotFound exception
        # bubbled out of the daemon thread to stderr with no DB record.
        # Swallow + log so the SSE stream still terminates cleanly and
        # ops have a single grep-able line per failure.
        logger.exception(
            "assistant message %s finalisation failed unexpectedly",
            assistant_msg_id,
        )
        # P7: fallback write in a fresh session so the assistant row
        # doesn't get stuck in 'pending' if the success/cancelled path
        # raised after the SessionLocal context began rolling back. Any
        # exception in this fallback is itself logged and swallowed —
        # better to leave a 'pending' row than to crash the worker.
        try:
            with SessionLocal() as session:
                chat_service.update_message(
                    session,
                    assistant_msg_id,
                    content="Agent run failed.",
                    status="failed",
                    skill=resolved_skill,
                    error="finalisation_error",
                )
        except Exception:  # noqa: BLE001
            logger.exception(
                "fallback failure-write also failed for assistant message %s",
                assistant_msg_id,
            )


@router.post("/sessions", response_model=ChatSessionResponse)
def create_session(db: Session = Depends(get_db)) -> ChatSessionResponse:
    return chat_service.create_session(db)


@router.get("/sessions", response_model=list[ChatSessionResponse])
def list_sessions(db: Session = Depends(get_db)) -> list[ChatSessionResponse]:
    return chat_service.list_sessions(db)


@router.get("/sessions/{session_id}", response_model=ChatSessionResponse)
def get_session_detail(
    session_id: uuid.UUID, db: Session = Depends(get_db)
) -> ChatSessionResponse:
    """Story 6.1 CR P29: AC 2 explicitly specifies the 404 contract for
    GET /api/agent/sessions/{id}; this endpoint was missing entirely.
    Returns the session row or raises ChatSessionNotFoundError (404)."""
    return ChatSessionResponse.model_validate(chat_service.get_session(db, session_id))


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    chat_service.delete_session(db, session_id)
    return Response(status_code=204)


@router.get("/sessions/{session_id}/messages", response_model=list[ChatMessageResponse])
def get_messages(
    session_id: uuid.UUID, db: Session = Depends(get_db)
) -> list[ChatMessageResponse]:
    return chat_service.list_messages(db, session_id)


@router.post("/sessions/{session_id}/chat")
def chat(
    session_id: uuid.UUID,
    body: ChatRequest,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    chat_service.get_session(db, session_id)

    # Story 6.1 CR P25: also reject internal-only skills explicitly.
    if body.skill is not None and (
        body.skill not in SKILL_REGISTRY or body.skill in _INTERNAL_SKILLS
    ):
        raise AppError(
            error="invalid_skill",
            message=f"Unknown skill: {body.skill!r}",
            status_code=400,
        )

    session_key = str(session_id)

    # Story 6.2 Group A CR P10: serialize the create-message + read-history
    # critical section per session so two concurrent POSTs for the same
    # session can't see each other's just-committed rows. Released before
    # the worker thread starts — concurrent worker threads are still fine,
    # only the DB-state-snapshot read needs serializing.
    session_lock = _get_session_lock(session_key)
    with session_lock:
        user_msg = chat_service.create_message(
            db, session_id, role="user", content=body.content
        )
        user_msg_id = user_msg.id
        assistant_msg = chat_service.create_message(
            db, session_id, role="assistant", content="", status="pending"
        )
        assistant_msg_id = assistant_msg.id

        resolved_skill = body.skill
        if resolved_skill is None:
            resolved_skill = _classify_intent(body.content, session_id)

        # Story 6.2 AC 12: load recent transcript for the chat skill. We
        # query AFTER inserting the user + assistant placeholder rows so
        # the new turn is in scope, then filter both of them out (the
        # latest user message is fed in separately as the Task
        # description's "User's latest message:" line — including it
        # twice wastes tokens; the assistant placeholder is
        # `status='pending'` and isn't useful context).
        # `list_recent_messages` returns the MOST RECENT N rows in
        # chronological order — crucial for sessions longer than the
        # window where plain `list_messages(... limit=N)` would return
        # the OLDEST N rows instead of the LATEST N.
        #
        # Story 6.2 Group A CR P2: we previously fetched only
        # `_HISTORY_WINDOW + 2` rows. The `+2` only absorbed the two
        # filtered placeholder rows — under a streak of failed/cancelled
        # assistant turns the surviving history could shrink below
        # `_HISTORY_WINDOW` (silently truncating context). Fetch a
        # larger buffer (`_HISTORY_WINDOW * 4`) so up to ~3× window's
        # worth of non-`complete` rows can be filtered out before the
        # surviving history under-fills. Pathologically deep failure
        # streaks (~60+ in a row) would still under-fill, but at that
        # point context loss is the least of the user's worries.
        raw_history = chat_service.list_recent_messages(
            db, session_id, limit=_HISTORY_WINDOW * 4
        )
        excluded_ids = {user_msg_id, assistant_msg_id}
        history = tuple(
            m
            for m in raw_history
            if m.status == "complete"
            and m.role in ("user", "assistant")
            and m.id not in excluded_ids
        )[-_HISTORY_WINDOW:]

    q: queue.Queue[dict[str, Any] | None] = queue.Queue()
    cancel_event = threading.Event()

    msg_key = str(assistant_msg_id)
    with _CANCEL_MAP_LOCK:
        _CANCEL_MAP.setdefault(session_key, {})[msg_key] = cancel_event

    ctx = SkillContext(
        session_id=session_id,
        user_message=body.content,
        session_factory=SessionLocal,
        llm=get_llm_for_agent(),
        event_queue=q,
        history=history,
        # Story 6.3 AC 2: skills like `rephrase` resolve their target
        # todo from `context.todo_ids[0]`. The chat skill ignores it.
        context=body.context,
    )

    def _run_and_finalise() -> None:
        try:
            # Story 6.2 Group A CR P1: thread cancel_event into run_crew
            # so the chunk loop can stop emitting on user abort.
            result = run_crew(ctx, resolved_skill, assistant_msg_id, cancel_event)
            finalise_assistant_message(assistant_msg_id, resolved_skill, result)
        finally:
            with _CANCEL_MAP_LOCK:
                session_events = _CANCEL_MAP.get(session_key)
                if session_events is not None:
                    session_events.pop(msg_key, None)
                    if not session_events:
                        _CANCEL_MAP.pop(session_key, None)

    t = threading.Thread(target=_run_and_finalise, daemon=True)
    t.start()

    return StreamingResponse(stream_sse(q), media_type="text/event-stream")


@router.post("/sessions/{session_id}/cancel", status_code=202)
def cancel_chat(session_id: uuid.UUID) -> Response:
    """Story 6.1 CR P23: cancel ONLY the events for the supplied session.
    Previously this iterated every entry in `_CANCEL_MAP` and called
    `event.set()` globally — any user could abort every other in-flight
    chat across the entire process."""
    with _CANCEL_MAP_LOCK:
        session_events = _CANCEL_MAP.pop(str(session_id), {})
    for event in session_events.values():
        event.set()
    return Response(status_code=202)


def _classify_intent(user_message: str, session_id: uuid.UUID) -> str:
    """Run the intent classifier synchronously and return a skill name.

    Story 6.1 CR P26: uses `SKILL_REGISTRY["intent_classifier"].builder`
    via the registry that's already imported at module top — drops the
    local-import workaround and the dead `# isort: skip_file` comment.
    """
    q: queue.Queue[dict[str, Any] | None] = queue.Queue()
    ctx = SkillContext(
        session_id=session_id,
        user_message=user_message,
        session_factory=SessionLocal,
        llm=get_llm_for_agent(),
        event_queue=q,
    )
    try:
        crew = SKILL_REGISTRY["intent_classifier"].builder(ctx)
        result = str(crew.kickoff()).strip().lower()
        if result in SKILL_REGISTRY and result not in _INTERNAL_SKILLS:
            return result
    except Exception as exc:  # noqa: BLE001
        logger.debug("Intent classifier failed: %s", exc)
    return "chat"
