# Story 1.1: Project Scaffolding & Infrastructure

Status: review

## Story

As a developer,
I want to initialize the full-stack project with backend, frontend, database, and CI/CD,
so that all subsequent stories have a working development environment with a single `make dev` command.

## Acceptance Criteria

1. **Given** a fresh clone of the repository, **When** I run `make dev`, **Then** docker-compose starts PostgreSQL 17 with pgvector, FastAPI starts with hot reload on port 8000, and Vite dev server starts on port 5173.

2. **Given** the database container is running, **When** I run `alembic upgrade head`, **Then** all 4 tables are created: `todos`, `groups`, `group_memberships`, `creatures` with correct columns and constraints.

3. **Given** the backend is running, **When** I call `GET /api/todos`, **Then** I receive an empty JSON array `[]` with status 200.

4. **Given** the frontend dev server is running, **When** I open `http://localhost:5173` in Chrome, **Then** I see a blank React app (placeholder — pond scene comes in Story 1.2).

5. **Given** the `.env.example` file exists, **When** I copy it to `.env` and fill in values, **Then** both backend and frontend can read their configuration.

6. **Given** code is pushed to the repository, **When** GitHub Actions CI runs, **Then** backend job runs ruff lint + mypy type check + pytest, and frontend job runs tsc type check + vitest + vite build.

## Tasks / Subtasks

- [x] Task 1: Backend FastAPI Setup (AC: #1, #3)
  - [x] Add FastAPI dependencies: `uv add fastapi uvicorn sqlalchemy asyncpg alembic`
  - [x] Add dev dependencies: `uv add --group dev httpx`
  - [x] Create `src/main.py` — FastAPI app with CORS middleware
  - [x] Create `src/config.py` — Pydantic Settings loading from `.env`
  - [x] Create `src/database.py` — async SQLAlchemy engine + session factory
  - [x] Create `src/exceptions.py` — base exception classes
  - [x] Create placeholder route: `GET /api/todos` returning `[]`

- [x] Task 2: Database Schema + Migrations (AC: #2)
  - [x] Create `src/models/__init__.py`
  - [x] Create `src/models/todo.py` — Todo model with all columns
  - [x] Create `src/models/group.py` — Group + GroupMembership models
  - [x] Create `src/models/creature.py` — Creature model with rarity enum
  - [x] Initialize Alembic: `alembic init migrations`
  - [x] Configure `migrations/env.py` for async SQLAlchemy
  - [x] Generate initial migration: `alembic revision --autogenerate -m "initial schema"`
  - [x] Verify migration creates all 4 tables with correct indexes

- [x] Task 3: Docker Compose (AC: #1)
  - [x] Create `docker-compose.yml` with pgvector/pgvector:pg17 image
  - [x] Configure persistent volume, ports (5432), and env vars

- [x] Task 4: Frontend Vite + React + TypeScript (AC: #4)
  - [x] Run `npm create vite@latest frontend -- --template react-ts`
  - [x] Install core dependencies: `npm install three @react-three/fiber @react-three/postprocessing @react-three/drei @tanstack/react-query zustand axios`
  - [x] Install dev dependencies: `npm install -D @types/three vitest @testing-library/react`
  - [x] Create `frontend/src/api/client.ts` — axios instance with snake_case ↔ camelCase interceptors
  - [x] Create `frontend/src/styles/neon-tokens.css` — CSS custom properties (all neon colors from design system)
  - [x] Create `frontend/src/styles/global.css` — global styles, `cursor: none`, font imports
  - [x] Create `frontend/src/types/index.ts` — TypeScript interfaces for Todo, Group, Creature, etc.
  - [x] Create placeholder `App.tsx` rendering "nearform-bmad-todo-app" text
  - [x] Configure `vite.config.ts` with proxy to backend API on port 8000

- [x] Task 5: Environment Configuration (AC: #5)
  - [x] Create `.env.example` with: DATABASE_URL, GOOGLE_API_KEY, EMBEDDING_MODEL, CORS_ORIGINS, VITE_API_URL, ARCHIVE_THRESHOLD_DAYS
  - [x] Add `.env` to `.gitignore`
  - [x] Create `.env` from example with local dev values

- [x] Task 6: Makefile + Dev Command (AC: #1)
  - [x] Create `Makefile` with targets: `dev`, `dev-backend`, `dev-frontend`, `dev-db`, `test`, `lint`, `migrate`
  - [x] `make dev` runs: docker-compose up -d && uvicorn src.main:app --reload --port 8000 & cd frontend && npm run dev
  - [x] `make test` runs: pytest && cd frontend && npx vitest run
  - [x] `make lint` runs: ruff check . && ruff format --check . && mypy . && cd frontend && npx tsc --noEmit

- [x] Task 7: CI/CD GitHub Actions (AC: #6)
  - [x] Create `.github/workflows/ci-backend.yml` — runs on push/PR: ruff, mypy, pytest with PostgreSQL service container
  - [x] Create `.github/workflows/ci-frontend.yml` — runs on push/PR: tsc, vitest, vite build

## Dev Notes

### Database Schema (from Architecture)

```sql
todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  color VARCHAR(7) DEFAULT '#00eeff',
  position_x FLOAT,
  position_y FLOAT,
  embedding VECTOR(768),
  embedding_status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'complete', 'failed'
  archived BOOLEAN DEFAULT FALSE,
  archived_at TIMESTAMP,
  deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
)

groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT,
  position_x FLOAT,
  position_y FLOAT,
  created_at TIMESTAMP DEFAULT NOW()
)

group_memberships (
  todo_id UUID REFERENCES todos(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (todo_id, group_id)
)

creatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id UUID REFERENCES todos(id) UNIQUE,  -- NULL for resident creatures
  creature_type VARCHAR(50) NOT NULL,
  rarity VARCHAR(20) NOT NULL,  -- 'common','uncommon','rare','legendary','resident'
  created_at TIMESTAMP DEFAULT NOW()
)
```

**Required indexes:**
- GIN index on `todos.text` using `to_tsvector('english', text)` for full-text search
- HNSW or IVFFlat index on `todos.embedding` for vector similarity
- Partial index on `todos(deleted, archived)` for active todo queries

### Neon Design Tokens (from UX Spec — create in `neon-tokens.css`)

```css
:root {
  --neon-pink: #ff10f0;
  --neon-cyan: #00eeff;
  --neon-orange: #ff6600;
  --neon-green: #39ff14;
  --neon-gold: #ffd700;
  --pond-dark: #000000;
  --water-surface: rgba(0, 20, 40, 0.8);
  --water-deep: rgba(0, 10, 25, 0.95);
  --water-reflection: rgba(0, 238, 255, 0.05);
  --glow-intensity: 1.0;
}
```

### TypeScript Interfaces (create in `types/index.ts`)

```typescript
export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  color: string;
  positionX: number | null;
  positionY: number | null;
  embeddingStatus: 'pending' | 'complete' | 'failed';
  archived: boolean;
  archivedAt: string | null;
  deleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Group {
  id: string;
  label: string | null;
  positionX: number | null;
  positionY: number | null;
  createdAt: string;
  memberIds: string[];
}

export interface Creature {
  id: string;
  todoId: string | null;
  creatureType: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary' | 'resident';
  createdAt: string;
}

export type AtmosphereMode = 'zen' | 'cyberpunk';
```

### Axios Client with Case Transform (create in `api/client.ts`)

```typescript
import axios from 'axios';
import camelcaseKeys from 'camelcase-keys';
import decamelizeKeys from 'decamelize-keys';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

apiClient.interceptors.response.use((res) => ({
  ...res,
  data: camelcaseKeys(res.data, { deep: true }),
}));

apiClient.interceptors.request.use((cfg) => ({
  ...cfg,
  data: cfg.data ? decamelizeKeys(cfg.data, { separator: '_' }) : cfg.data,
}));

export default apiClient;
```

**NOTE:** Install `camelcase-keys` and `decamelize-keys`: `npm install camelcase-keys decamelize-keys`

### Naming Conventions (from Architecture)

- **Python:** snake_case for files, functions, variables. PascalCase for classes.
- **TypeScript:** PascalCase.tsx for components, camelCase.ts for non-components. camelCase for variables/functions. PascalCase for types/interfaces.
- **Database:** snake_case for tables (plural) and columns.
- **API JSON:** snake_case throughout. Frontend transforms via axios interceptor.

### Project Structure Notes

This story creates the foundational directory structure. All paths must match the architecture exactly:

```
nearform-bmad-todo-app/
├── frontend/src/api/client.ts
├── frontend/src/styles/neon-tokens.css
├── frontend/src/styles/global.css
├── frontend/src/types/index.ts
├── frontend/src/App.tsx
├── frontend/src/main.tsx
├── frontend/vite.config.ts
├── frontend/tsconfig.json
├── frontend/package.json
├── src/main.py
├── src/config.py
├── src/database.py
├── src/exceptions.py
├── src/api/__init__.py
├── src/models/__init__.py
├── src/models/todo.py
├── src/models/group.py
├── src/models/creature.py
├── src/schemas/__init__.py
├── migrations/env.py
├── migrations/versions/
├── tests/conftest.py
├── docker-compose.yml
├── Makefile
├── .env.example
├── .github/workflows/ci-backend.yml
├── .github/workflows/ci-frontend.yml
```

**DO NOT** create files for future stories (no route handlers beyond the placeholder, no services, no frontend components beyond App.tsx).

### Anti-Patterns to Avoid

- DO NOT create all API endpoints — only the placeholder `GET /api/todos` returning `[]`
- DO NOT create service layer files — those come in Story 2.1
- DO NOT create any Three.js scene components — that's Story 1.2
- DO NOT install sound-related packages — that's Epic 8
- DO NOT create Pydantic request/response schemas beyond what's needed for the placeholder endpoint
- DO NOT set up the Google API integration — that's Story 5.1
- DO use `gen_random_uuid()` in PostgreSQL for UUID generation, not Python-side UUID generation

### References

- [Source: architecture.md#Starter Template Evaluation] — initialization commands
- [Source: architecture.md#Data Architecture] — database schema
- [Source: architecture.md#Implementation Patterns] — naming conventions, axios client pattern
- [Source: architecture.md#Infrastructure & Deployment] — docker-compose, Makefile, CI/CD
- [Source: ux-design-specification.md#Visual Design Foundation] — neon design tokens
- [Source: prd.md#FR47-FR49] — dev infrastructure requirements

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Fixed Pydantic Settings rejecting VITE_API_URL env var — added `extra: "ignore"` to model_config
- Fixed all ruff lint/format violations across backend code (line lengths, import ordering)
- Updated PostgreSQL credentials from pond/pond_dev to postgres/postgres to match existing local pgvector instance
- Fixed frontend decamelizeKeys call — was passing '-' string instead of using default '_' separator
- Downgraded Vite 8 → 6 and Vitest 4 → 3 for Node 22.6 compatibility (rolldown native bindings issue)
- Switched frontend test env from jsdom to happy-dom (ESM require() compat issue with jsdom 27)
- Fixed Makefile to use `python -m alembic` instead of `alembic` CLI (module resolution issue)
- Excluded .claude, _bmad, _bmad-output, migrations/versions from ruff linting

### Completion Notes List

- All 7 tasks completed, all 6 acceptance criteria satisfied
- Backend: FastAPI app with CORS, async SQLAlchemy, Pydantic Settings, placeholder GET /api/todos endpoint
- Database: 4 tables (todos, groups, group_memberships, creatures) with correct columns, FKs, indexes, and pgvector support
- Frontend: React 19 + TypeScript + Vite + React Three Fiber + TanStack Query + Zustand scaffold, with neon design tokens and axios case-transform client
- Infrastructure: Docker Compose (pgvector/pg17), Makefile (dev/test/lint/migrate), .env config
- CI/CD: GitHub Actions for backend (ruff + mypy + pytest with PG service) and frontend (tsc + vitest + build)
- Tests: 1 backend test (GET /api/todos returns []), 1 frontend test (App renders title)
- All quality checks pass: ruff lint, ruff format, mypy, pytest, tsc, vitest, vite build

### Change Log

- 2026-04-15: Implemented all story tasks. Fixed config, lint, compatibility, and credential issues.

### File List

- pyproject.toml (modified — added ruff excludes, updated deps)
- src/main.py
- src/config.py (modified — added extra: ignore, updated DB credentials)
- src/database.py
- src/exceptions.py (modified — line length fix)
- src/api/__init__.py
- src/api/todos.py
- src/models/__init__.py
- src/models/base.py
- src/models/todo.py (modified — line length fixes)
- src/models/group.py (modified — line length fix)
- src/models/creature.py (modified — line length fix)
- src/schemas/__init__.py
- src/services/__init__.py
- migrations/env.py (modified — line length fix, import reorder)
- migrations/versions/63f2bce6548a_initial_schema.py (new — auto-generated)
- migrations/script.py.mako
- alembic.ini (modified — updated credentials)
- docker-compose.yml (modified — updated credentials)
- Makefile (modified — use python -m alembic)
- .env.example (modified — updated credentials)
- .env (modified — updated credentials)
- .gitignore
- .github/workflows/ci-backend.yml (modified — updated credentials)
- .github/workflows/ci-frontend.yml
- tests/__init__.py
- tests/conftest.py (modified — line length fix)
- tests/api/__init__.py
- tests/api/test_todos.py
- tests/services/__init__.py
- frontend/package.json (modified — downgraded vite/vitest, added happy-dom)
- frontend/package-lock.json
- frontend/vite.config.ts (modified — added vitest config, happy-dom)
- frontend/tsconfig.json
- frontend/tsconfig.app.json
- frontend/tsconfig.node.json
- frontend/eslint.config.js
- frontend/index.html
- frontend/src/main.tsx
- frontend/src/App.tsx
- frontend/src/App.test.tsx (new)
- frontend/src/api/client.ts (modified — fixed decamelizeKeys)
- frontend/src/styles/global.css
- frontend/src/styles/neon-tokens.css
- frontend/src/types/index.ts
- frontend/src/test/setup.ts (new)
