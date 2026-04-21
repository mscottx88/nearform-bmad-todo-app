"""Unit tests for src.config.Settings validators."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.config import Settings


def test_database_url_must_not_be_empty() -> None:
    with pytest.raises(ValidationError, match="must not be empty"):
        Settings(database_url="")


def test_database_url_must_contain_scheme() -> None:
    with pytest.raises(ValidationError, match="'://'"):
        Settings(database_url="not-a-url")


def test_database_url_accepts_sqlalchemy_compound_driver() -> None:
    # Our real default uses this form; must pass without raising.
    s = Settings(database_url="postgresql+psycopg://u:p@host:5432/db")
    assert s.database_url == "postgresql+psycopg://u:p@host:5432/db"


def test_archive_threshold_days_rejects_zero() -> None:
    with pytest.raises(ValidationError):
        Settings(archive_threshold_days=0)


def test_archive_threshold_days_rejects_negative() -> None:
    with pytest.raises(ValidationError):
        Settings(archive_threshold_days=-1)


def test_archive_threshold_days_accepts_positive() -> None:
    s = Settings(archive_threshold_days=7)
    assert s.archive_threshold_days == 7
