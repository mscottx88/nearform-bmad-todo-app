import json
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from src.agent.tools.base import PooledTool
from src.services import search_service


class SearchTodosTool(PooledTool):
    name: str = "search_todos"
    description: str = (
        "Search todos using hybrid full-text + semantic search. "
        "text: the search query string. "
        "limit: max results to return (default 10)."
    )

    def __init__(self, session_factory: Callable[[], Session], **kwargs: Any) -> None:
        super().__init__(session_factory=session_factory, **kwargs)

    def _run(self, text: str, limit: int = 10) -> str:
        with self._session_factory() as session:
            response = search_service.hybrid_search(session, query_text=text)
        top = response.results[:limit]
        return json.dumps(
            [
                {
                    "id": str(r.todo.id),
                    "text": r.todo.text,
                    "done": r.todo.completed,
                    "color": r.todo.color,
                    "score": r.score,
                    "created": r.todo.created_at.isoformat(),
                }
                for r in top
            ]
        )
