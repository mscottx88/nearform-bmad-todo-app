"""Shared helpers for skills that build task descriptions.

This module is `_`-prefixed because it's an implementation detail of
the `skills` package — not a public API for the rest of the
application. Skills import from here to avoid duplicating prompt
machinery (and to avoid the "two skills slowly drift on the same
helper" failure mode).
"""

from datetime import UTC, date, datetime


def today_anchor_line(today: date | None = None) -> str:
    """Render the "today is …" line every skill injects into its task
    description so the LLM has a concrete calendar anchor for date
    phrases ("May 1", "next Monday", "by Friday"). Without this, the
    model falls back on its training-data prior and can pick a year
    off by ±1.

    `today` defaults to `datetime.now(UTC).date()` for production
    callers; tests pass a fixed date for determinism.
    """
    if today is None:
        today = datetime.now(UTC).date()
    weekday = today.strftime("%A")
    return f"Today's date is {today.isoformat()} ({weekday})."
