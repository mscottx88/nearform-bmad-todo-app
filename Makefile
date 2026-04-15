.PHONY: dev dev-db dev-backend dev-frontend test lint migrate

dev-db:
	docker compose up -d

dev-backend:
	uv run uvicorn backend.src.main:app --reload --port 8000

dev-frontend:
	cd frontend && npm run dev

dev: dev-db
	@echo "Starting backend and frontend..."
	uv run uvicorn backend.src.main:app --reload --port 8000 & cd frontend && npm run dev

test:
	uv run pytest
	cd frontend && npx vitest run

lint:
	uv run ruff check .
	uv run ruff format --check .
	uv run mypy .
	cd frontend && npx tsc --noEmit

migrate:
	uv run python -m alembic -c backend/alembic.ini upgrade head

migrate-generate:
	uv run python -m alembic -c backend/alembic.ini revision --autogenerate -m "$(msg)"
