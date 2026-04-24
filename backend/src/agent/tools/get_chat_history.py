import json
import uuid
from collections.abc import Callable
from typing import Any

from pydantic import PrivateAttr
from sqlalchemy.orm import Session

from src.agent.tools.base import PooledTool
from src.services import chat_service


class GetChatHistoryTool(PooledTool):
    name: str = "get_chat_history"
    description: str = (
        "Retrieve chat history for THIS session. "
        "limit: max messages to return (default 20, max 200)."
    )

    # Story 6.1 CR P19: session_id is now injected at construction time
    # from SkillContext.session_id — the LLM NO LONGER supplies it as a
    # tool argument. Previously the tool signature took `session_id:
    # str`, which let prompt-injected user text trick the agent into
    # fetching history for an unrelated session (horizontal data leak).
    _session_id: uuid.UUID = PrivateAttr()

    def __init__(
        self,
        session_factory: Callable[[], Session],
        session_id: uuid.UUID,
        **kwargs: Any,
    ) -> None:
        super().__init__(session_factory=session_factory, **kwargs)
        self._session_id = session_id

    # Story 6.1 CR P15: broad try/except returning a JSON error string so
    # the CrewAI `_run -> str` contract is always satisfied.
    def _run(self, limit: int = 20) -> str:
        try:
            with self._session_factory() as session:
                messages = chat_service.list_messages(
                    session, self._session_id, limit=limit
                )
            return json.dumps(
                [
                    {
                        "role": m.role,
                        "content": m.content,
                        "created": m.created_at.isoformat(),
                    }
                    for m in messages
                ]
            )
        except Exception as exc:  # noqa: BLE001
            return json.dumps({"error": str(exc)})
