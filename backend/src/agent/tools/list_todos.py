import json
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from src.agent.tools.base import PooledTool
from src.services import todo_service


class ListTodosTool(PooledTool):
    name: str = "list_todos"
    description: str = (
        "List todos from the pond. "
        "filter: 'active' (default), 'completed', or 'all'. "
        "limit: max results (default 100, hard cap 500)."
    )

    def __init__(self, session_factory: Callable[[], Session], **kwargs: Any) -> None:
        super().__init__(session_factory=session_factory, **kwargs)

    def _run(
        self,
        filter: str = "active",
        limit: int = 100,
    ) -> str:
        with self._session_factory() as session:
            todos = todo_service.list_for_agent(session, filter=filter, limit=limit)
        return json.dumps(
            [
                {
                    "id": str(t.id),
                    "text": t.text,
                    "done": t.completed,
                    "color": t.color,
                    "x": t.position_x,
                    "z": t.position_y,
                    "created": t.created_at.isoformat(),
                }
                for t in todos
            ]
        )
