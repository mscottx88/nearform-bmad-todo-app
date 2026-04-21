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
    the last '/') to match one of:
      * exactly `test`
      * starts with `test_` (e.g. `test_data`)
      * ends with `_test` (e.g. `todo_pond_test`, `integration_test`)

    The earlier substring check was too permissive — it admitted
    innocent-looking names like `latest_backup`, `greatest_hits`, or
    `contest`, any of which would have been silently wiped on test
    start-up.

    Raises:
        SystemExit: with a human-readable remediation message, so
        pytest surfaces it at session startup rather than midway
        through a test run.
    """
    db_name = database_url.rsplit("/", 1)[-1].split("?", 1)[0]
    name_lower = db_name.lower()
    looks_test_like = (
        name_lower == "test"
        or name_lower.startswith("test_")
        or name_lower.endswith("_test")
    )
    if not looks_test_like:
        raise SystemExit(
            "\n\n"
            "  REFUSING TO RUN TESTS against a non-test database.\n\n"
            f"  Current DATABASE_URL DB name: '{db_name}'\n"
            "  Tests wipe todos/creatures/group_memberships on every test\n"
            "  run via the `_clean_db` fixture. Set DATABASE_URL to point\n"
            "  at a database whose name is exactly 'test', starts with\n"
            "  'test_', or ends with '_test', e.g.:\n\n"
            "    export DATABASE_URL='postgresql+psycopg://postgres:"
            "postgres@localhost:5432/todo_pond_test'\n"
            "    uv run pytest\n\n"
            "  Or use `make test` (which sets this for you).\n"
        )
