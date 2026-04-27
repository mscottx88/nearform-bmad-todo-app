# Pond Todo

A neon 3D Todo application built as a Nearform demo and BMad-method
learning project. Each todo is a luminescent lily pad floating on a
dark pond surface; an oracle frog and an LLM-backed agent panel sit
to one side. The domain is deliberately minimal — the project's
purpose is to showcase a full-stack craft bar (visual quality,
interaction polish, agentic UX), not to solve a novel productivity
problem.

**Stack**

| Tier | Choices |
|---|---|
| Frontend | React 19 · TypeScript · Three.js (`@react-three/fiber` + drei + postprocessing) · Zustand · TanStack Query · Vitest |
| Backend  | Python 3.13 · FastAPI (sync handlers) · SQLAlchemy 2 · Alembic · psycopg + psycopg-pool · CrewAI (Anthropic) · pgvector · pytest |
| Database | Postgres 17 with `pgvector` extension (via `pgvector/pgvector:pg17`) |
| Tooling  | uv (Python) · npm (Node) · ruff · mypy --strict · ESLint · pre-commit · Conventional Commits |

> **Concurrency model:** thread-based throughout the backend.
> `async`/`await`/`asyncio` are prohibited per
> [CLAUDE.md](CLAUDE.md). FastAPI handlers are all synchronous.

---

## Requirements

- **Python 3.13+**
- **Node.js 20+** and **npm**
- **Docker** (for the Postgres container) — or a local Postgres 17 with `pgvector` available
- [**uv**](https://docs.astral.sh/uv/) — Python package manager
- An **Anthropic API key** for the agent panel (chat / rephrase /
  create-todo skills). The app starts without one but agent features
  will fail at request time.

---

## Quick start

```bash
# 1. Clone + enter the repo
git clone <this-repo>
cd nearform-bmad-todo-app

# 2. Install Python toolchain + venv
uv python install 3.13
uv venv .venv --python 3.13
source .venv/bin/activate    # .venv\Scripts\activate on Windows
cd backend && uv sync --extra dev && cd ..

# 3. Install frontend deps
cd frontend && npm install && cd ..

# 4. Configure secrets
cp .env.example .env         # if present; otherwise create .env
# Edit .env and set ANTHROPIC_API_KEY=sk-ant-...

# 5. Start the database
make dev-db                  # docker compose up -d  (Postgres on :5432)

# 6. Apply migrations + seed (one-shot)
make migrate

# 7. Run backend + frontend in parallel
make dev                     # backend on :8000, frontend on :5173

# Visit http://localhost:5173
```

---

## Make targets

| Command | What it does |
|---|---|
| `make dev`              | Spin up db + backend + frontend in parallel (Ctrl-C kills the group). |
| `make dev-db`           | Start Postgres (pgvector) via `docker compose up -d`. |
| `make dev-backend`      | Run uvicorn against the local db on `:8000` (hot reload). |
| `make dev-frontend`     | Run Vite dev server on `:5173` (hot reload). |
| `make test`             | Set up `todo_pond_test` (creates db, installs pgvector, runs migrations) and run the full backend + frontend test suites. |
| `make test-db-setup`    | Create the test database only — idempotent. |
| `make lint`             | Run ruff (check + format) + mypy --strict for the backend, `tsc --noEmit` for the frontend. |
| `make migrate`          | Apply Alembic migrations to the dev database. |
| `make migrate-generate msg="…"` | Autogenerate a new Alembic revision from current model state. |

---

## Project layout

```
backend/                 # FastAPI app + CrewAI agent + alembic
  src/                     route handlers, services, models, agent skills
  tests/                   pytest suite (~199 tests)
  alembic/                 migration history
frontend/                # Vite + React 19 + Three.js
  src/components/pond/     R3F scene, lily pads, water surface, ripples
  src/components/agent/    chat panel, oracle frog, message renderer
  src/components/ui/       NeonScrollbar, popups, callouts
  src/components/effects/  CursorFirefly (custom neon cursor)
  src/stores/              Zustand stores (agent, pond, world)
docs/                    Long-form design notes
_bmad/                   BMad workflow + module configuration
_bmad-output/            BMad planning + implementation artifacts
  planning-artifacts/      PRD, architecture, UX spec, epics
  implementation-artifacts/ stories + sprint-status.yaml
```

The BMad-method artifacts under `_bmad-output/` are the source of truth
for the project's product/architecture/sprint state. Story files have
acceptance criteria, dev notes, completion notes, and code review
records — they're worth reading alongside the code.

---

## Testing

```bash
# Full suite (backend + frontend)
make test

# Backend only — requires todo_pond_test to exist
cd backend
DATABASE_URL='postgresql+psycopg://postgres:postgres@localhost:5432/todo_pond_test' \
  uv run pytest

# Backend with coverage
cd backend
DATABASE_URL='postgresql+psycopg://postgres:postgres@localhost:5432/todo_pond_test' \
  uv run pytest --cov=src --cov-report=term-missing --cov-fail-under=70

# Frontend only
cd frontend
npx vitest run

# Frontend with coverage
cd frontend
npx vitest run --coverage
```

> The backend test fixture **refuses to run** unless the database
> name contains `"test"` — see [`conftest.py`](backend/tests/conftest.py)
> `_safeguard.py`. This is on purpose: it stops the wipe-on-test
> fixture from ever clobbering dev data.

---

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `POSTGRES_DB`            | `todo_pond` | Container db name. |
| `POSTGRES_USER`          | `postgres`  | |
| `POSTGRES_PASSWORD`      | `postgres`  | |
| `POSTGRES_PORT`          | `5432`      | Host-side port mapping. |
| `DATABASE_URL`           | derived     | Sync `postgresql+psycopg://…` URL — read by SQLAlchemy + Alembic. |
| `ANTHROPIC_API_KEY`      | (none)      | Required for the agent panel chat / rephrase / create-todo skills. |
| `EMBEDDING_API_KEY`      | (none)      | If using a non-Anthropic embedding provider — see [backend/src/services/embeddings.py](backend/src/services/embeddings.py). |

`make dev-db` reads `.env`. The backend reads it via `pydantic-settings`.

---

## Documentation

- [`_bmad-output/planning-artifacts/prd.md`](_bmad-output/planning-artifacts/prd.md) — Product Requirements Document
- [`_bmad-output/planning-artifacts/architecture.md`](_bmad-output/planning-artifacts/architecture.md) — System architecture and decisions
- [`_bmad-output/planning-artifacts/ux-design-specification.md`](_bmad-output/planning-artifacts/ux-design-specification.md) — UX spec (3D pond, neon palette, interactions)
- [`_bmad-output/planning-artifacts/epics.md`](_bmad-output/planning-artifacts/epics.md) — Epic + story map
- [`_bmad-output/implementation-artifacts/sprint-status.yaml`](_bmad-output/implementation-artifacts/sprint-status.yaml) — Live sprint state with per-story notes
- [`docs/ai-integration-log.md`](docs/ai-integration-log.md) — How AI was used during development (BMad method, agents, skills, models)
- [`CLAUDE.md`](CLAUDE.md) — Project-wide engineering rules (commit cadence, concurrency model, etc.)

---

## License

Internal Nearform demo project.

[![banner](https://raw.githubusercontent.com/nearform/.github/refs/heads/master/assets/os-banner-green.svg)](https://www.nearform.com/contact/?utm_source=open-source&utm_medium=banner&utm_campaign=os-project-pages)
