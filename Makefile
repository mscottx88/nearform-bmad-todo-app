.PHONY: dev dev-db dev-backend dev-frontend test lint migrate

dev-db:
	docker compose up -d

dev-backend:
	cd backend && uv run uvicorn src.main:app --reload --port 8000

dev-frontend:
	cd frontend && npm run dev

dev: dev-db
	@echo "Starting backend and frontend..."
	trap 'kill 0' INT TERM; (cd backend && uv run uvicorn src.main:app --reload --port 8000) & (cd frontend && npm run dev) & wait

test:
	cd backend && uv run pytest
	cd frontend && npx vitest run

lint:
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy .
	cd frontend && npx tsc --noEmit

migrate:
	cd backend && uv run python -m alembic upgrade head

migrate-generate:
	cd backend && uv run python -m alembic revision --autogenerate -m "$(msg)"
