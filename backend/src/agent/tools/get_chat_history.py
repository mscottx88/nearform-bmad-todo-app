import json
import uuid
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from src.agent.tools.base import PooledTool
from src.services import chat_service


class GetChatHistoryTool(PooledTool):
    name: str = "get_chat_history"
    description: str = (
        "Retrieve chat history for the current session. "
        "session_id: UUID of the chat session. "
        "limit: max messages to return (default 20)."
    )

    def __init__(self, session_factory: Callable[[], Session], **kwargs: Any) -> None:
        super().__init__(session_factory=session_factory, **kwargs)

    def _run(self, session_id: str, limit: int = 20) -> str:
        try:
            sid = uuid.UUID(session_id)
        except ValueError:
            return json.dumps({"error": f"Invalid session UUID: {session_id!r}"})
        with self._session_factory() as session:
            messages = chat_service.list_messages(session, sid, limit=limit)
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
