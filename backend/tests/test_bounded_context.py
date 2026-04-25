"""Story 6.1 CR Group E TP12: AC 6 + DoD bounded-context import rule.

DoD literally says: *"`src/agent/` has zero imports from `src/api/`
(bounded context enforced)"*. AC 6 says: *"only `backend/src/api/agent.py`
imports from `src/agent/` — no other file in `src/` does"*.

This is the kind of architectural rule that silently rots without an
explicit test. A drive-by `from src.api.agent import ...` inside any
agent skill or tool will pass mypy + ruff + every other test, but
collapse the bounded-context boundary the next time anyone tries to
extract the agent into its own package.
"""

import re
from pathlib import Path

_REPO_BACKEND = Path(__file__).resolve().parent.parent
_AGENT_DIR = _REPO_BACKEND / "src" / "agent"
_SRC_DIR = _REPO_BACKEND / "src"

_API_IMPORT = re.compile(r"^\s*(from|import)\s+src\.api(\b|\.)", re.MULTILINE)
_AGENT_IMPORT = re.compile(r"^\s*(from|import)\s+src\.agent(\b|\.)", re.MULTILINE)


def _python_files(root: Path) -> list[Path]:
    return [p for p in root.rglob("*.py") if "__pycache__" not in p.parts]


def test_agent_does_not_import_from_api() -> None:
    """No file under `src/agent/` may import from `src/api/`."""
    offenders: list[str] = []
    for path in _python_files(_AGENT_DIR):
        text = path.read_text(encoding="utf-8")
        if _API_IMPORT.search(text):
            offenders.append(str(path.relative_to(_REPO_BACKEND)))
    assert not offenders, (
        "AC 6 / DoD violation: src/agent/ must not import from src/api/. "
        f"Offending files: {offenders}"
    )


def test_only_api_agent_imports_from_src_agent() -> None:
    """Across all of `src/`, only `src/api/agent.py` may import `src.agent`."""
    allowed = (_SRC_DIR / "api" / "agent.py").resolve()
    offenders: list[str] = []
    for path in _python_files(_SRC_DIR):
        if path.resolve() == allowed:
            continue
        # `src/agent/**` files import from src.agent.* internally — that's
        # not the bounded-context concern; we're checking OUTSIDE the
        # bounded context.
        try:
            path.relative_to(_AGENT_DIR)
            continue
        except ValueError:
            pass
        text = path.read_text(encoding="utf-8")
        if _AGENT_IMPORT.search(text):
            offenders.append(str(path.relative_to(_REPO_BACKEND)))
    assert not offenders, (
        "AC 6 violation: only src/api/agent.py may import from src/agent/. "
        f"Offending files: {offenders}"
    )
