.PHONY: dev dev-db dev-backend dev-frontend test test-coverage test-db-setup lint migrate migrate-generate

# Tests MUST run against a database whose name contains "test" — the
# `_clean_db` fixture in conftest.py wipes todos/creatures on every
# test and will refuse to run otherwise (safeguard against accidentally
# clobbering dev data). Keep this value in sync with `test-db-setup`.
TEST_DATABASE_URL := postgresql+psycopg://postgres:postgres@localhost:5432/todo_pond_test

dev-db:
	docker compose up -d

dev-backend:
	cd backend && uv run uvicorn src.main:app --reload --port 8000

dev-frontend:
	cd frontend && npm run dev

dev: dev-db
	@echo "Starting backend and frontend..."
	trap 'kill 0' INT TERM; (cd backend && uv run uvicorn src.main:app --reload --port 8000) & (cd frontend && npm run dev) & wait

test: test-db-setup
	cd backend && DATABASE_URL='$(TEST_DATABASE_URL)' uv run pytest
	cd frontend && npx vitest run

# Run both suites with coverage measurement and the 70% threshold gate.
# Backend coverage config lives in backend/pyproject.toml ([tool.coverage.*]).
# Frontend coverage config lives in frontend/vite.config.ts (test.coverage).
test-coverage: test-db-setup
	cd backend && DATABASE_URL='$(TEST_DATABASE_URL)' uv run pytest --cov=src --cov-report=term-missing --cov-fail-under=70
	cd frontend && npx vitest run --coverage

# One-shot: create `todo_pond_test`, install pgvector, apply
# migrations. Idempotent — safe to re-run. Uses the backend's own
# Python to talk to the actually-connected Postgres (which may or
# may not be the Docker container, depending on local setup).
test-db-setup:
	cd backend && uv run python -c "from sqlalchemy import create_engine, text; e = create_engine('postgresql+psycopg://postgres:postgres@localhost:5432/postgres', isolation_level='AUTOCOMMIT'); c = e.connect(); \
exists = c.execute(text(\"SELECT 1 FROM pg_database WHERE datname = 'todo_pond_test'\")).scalar(); \
(None if exists else c.execute(text('CREATE DATABASE todo_pond_test'))); c.close()"
	cd backend && uv run python -c "from sqlalchemy import create_engine, text; e = create_engine('$(TEST_DATABASE_URL)'); c = e.connect(); c.execute(text('CREATE EXTENSION IF NOT EXISTS vector')); c.commit(); c.close()"
	cd backend && DATABASE_URL='$(TEST_DATABASE_URL)' uv run python -m alembic upgrade head

lint:
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy .
	cd frontend && npx tsc --noEmit

migrate:
	cd backend && uv run python -m alembic upgrade head

migrate-generate:
	cd backend && uv run python -m alembic revision --autogenerate -m "$(msg)"
