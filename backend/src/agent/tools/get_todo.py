import json
import uuid
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from src.agent.tools.base import PooledTool
from src.exceptions import TodoNotFoundError
from src.services import todo_service


class GetTodoTool(PooledTool):
    name: str = "get_todo"
    description: str = "Fetch a single todo by its UUID id."

    def __init__(self, session_factory: Callable[[], Session], **kwargs: Any) -> None:
        super().__init__(session_factory=session_factory, **kwargs)

    def _run(self, id: str) -> str:
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
                    "created": todo.created_at.isoformat(),
                }
            )
        except TodoNotFoundError:
            return json.dumps({"error": f"Todo {id!r} not found"})
