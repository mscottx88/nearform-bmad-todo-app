"""Test-database safeguard.

Separate module (rather than defining inline in conftest.py) so the
logic is importable by its own test file. Leading underscore keeps
pytest from collecting this as a test module.
"""

from __future__ import annotations


def require_test_database(database_url: str) -> None:
    """Hard-stop the test session if the DATABASE_URL doesn't look test-like.

    The `_clean_db` fixture in conftest.py wipes todos, creatures, and
    group_memberships on every test. Against the developer's dev
    database that silently destroys real data before any assertion
    runs. The safeguard requires the DB name (path component after
    the last '/') to contain the substring 'test' — a heuristic that
    admits `todo_pond_test`, `pytest_tmp`, `integration_test`, etc.,
    and refuses bare `todo_pond` / `postgres` / `production`.

    Raises:
        SystemExit: with a human-readable remediation message, so
        pytest surfaces it at session startup rather than midway
        through a test run.
    """
    db_name = database_url.rsplit("/", 1)[-1].split("?", 1)[0]
    if "test" not in db_name.lower():
        raise SystemExit(
            "\n\n"
            "  REFUSING TO RUN TESTS against a non-test database.\n\n"
            f"  Current DATABASE_URL DB name: '{db_name}'\n"
            "  Tests wipe todos/creatures/group_memberships on every test\n"
            "  run via the `_clean_db` fixture. Set DATABASE_URL to point\n"
            "  at a database whose name contains 'test', e.g.:\n\n"
            "    export DATABASE_URL='postgresql+psycopg://postgres:"
            "postgres@localhost:5432/todo_pond_test'\n"
            "    uv run pytest\n\n"
            "  Or use `make test` (which sets this for you).\n"
        )
