import json
import uuid
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from src.agent.tools.base import PooledTool
from src.services import todo_service


class GetTodoTool(PooledTool):
    name: str = "get_todo"
    description: str = "Fetch a single todo by its UUID id."

    # Pydantic auto-generates a per-subclass __init__ from declared
    # fields (name, description). Without this wrapper, callers cannot
    # pass `session_factory` through to PooledTool's PrivateAttr-setter.
    def __init__(self, session_factory: Callable[[], Session], **kwargs: Any) -> None:
        super().__init__(session_factory=session_factory, **kwargs)

    # Story 6.1 CR P15: broad try/except returning a JSON error string so
    # the CrewAI `_run -> str` contract is always satisfied.
    def _run(self, id: str) -> str:  # noqa: A002  (LLM-facing arg name)
        try:
            todo_id = uuid.UUID(id)
        except ValueError:
            return json.dumps({"error": f"Invalid UUID: {id!r}"})
        try:
            with self._session_factory() as session:
                todo = todo_service.get_todo(session, todo_id)
            return json.dumps(
                {
                    "id": str(todo.id),
                    "text": todo.text,
                    "done": todo.completed,
                    "color": todo.color,
                    "x": todo.position_x,
                    "z": todo.position_y,
                    # Story 6.3: surface the due deadline (datetime
                    # + tz) so the rephrase skill can tell whether
                    # the user already has one set.
                    "due_date": (todo.due_date.isoformat() if todo.due_date else None),
                    "created": todo.created_at.isoformat(),
                }
            )
        except Exception as exc:  # noqa: BLE001
            return json.dumps({"error": str(exc)})
