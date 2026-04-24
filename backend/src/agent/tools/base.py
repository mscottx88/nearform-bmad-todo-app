from collections.abc import Callable
from typing import Any

from crewai.tools import BaseTool
from pydantic import PrivateAttr
from sqlalchemy.orm import Session


class PooledTool(BaseTool):
    """BaseTool subclass that receives a session_factory via __init__ injection."""

    _session_factory: Callable[[], Session] = PrivateAttr()

    def __init__(self, session_factory: Callable[[], Session], **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._session_factory = session_factory

    def _run(self, *args: Any, **kwargs: Any) -> str:
        raise NotImplementedError
