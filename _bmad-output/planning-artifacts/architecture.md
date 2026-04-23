---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-04-14'
inputDocuments: ['_bmad-output/planning-artifacts/prd.md', '_bmad-output/planning-artifacts/ux-design-specification.md']
workflowType: 'architecture'
project_name: 'nearform-bmad-todo-app'
user_name: 'Michael'
date: '2026-04-14'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
49 FRs across 10 capability areas. The requirements divide into three architectural domains:

1. **3D Rendering & Interaction (FR1-FR12, FR25-FR32, FR37-FR40)** — the pond scene, lily pads, creature controls, camera, atmosphere, animations. This is the largest and most technically complex domain, requiring Three.js/React Three Fiber with custom shaders, physics simulation, and GPU-optimized rendering.

2. **Search & Embeddings (FR13-FR24)** — hybrid full-text + vector search with type-anywhere UX, async embedding generation, and real-time result ranking. Backend-heavy with PostgreSQL pgvector and Google API integration.

3. **Data & Infrastructure (FR33-FR36, FR41-FR49)** — persistence, trash/archive, sound design, CI/CD. Standard web application concerns with PostgreSQL backend.

**Non-Functional Requirements:**
- 60fps 3D rendering with 30+ pads and active ecosystem
- 2-second page load to interactive
- 200ms CRUD visual feedback
- 300ms search debounce with progressive results
- Zero data loss across sessions
- Graceful degradation when Google API unavailable

**Scale & Complexity:**

- Primary domain: Full-stack with GPU-intensive frontend
- Complexity level: Medium
- Estimated architectural components: ~12 (PondScene, LilyPad, CreatureManager, EcosystemManager, SearchEngine, EmbeddingPipeline, TodoAPI, Database, CursorSnake, AtmosphereController, SoundManager, CameraController, ColorPicker). ClusterManager removed 2026-04-23 per sprint-change-proposal-2026-04-23.md.

### Technical Constraints & Dependencies

- **React 18 + TypeScript + Vite** — frontend framework (matches rag-csv-crew)
- **Three.js + React Three Fiber + Postprocessing** — 3D rendering (Bloom effects)
- **Python 3.13+ backend** — API server (FastAPI from rag-csv-crew precedent)
- **PostgreSQL 17 + pgvector** — persistence and vector search
- **Google API** — embedding generation (key available)
- **docker-compose** — local development orchestration
- **GitHub Actions** — CI/CD pipeline
- **Desktop Chrome only** — single browser target, no mobile
- **rag-csv-crew codebase** — component library source for porting

### Cross-Cutting Concerns Identified

- **3D Performance** — every feature must be evaluated for GPU impact. Lily pad count, creature count, Bloom resolution, ripple physics all compete for frame budget. LOD, frustum culling, and instanced rendering are architectural requirements, not optimizations.
- **Async Embedding Pipeline** — affects todo creation flow, search accuracy, error handling. Embedding state (pending/complete/failed) is a first-class data concern.
- **Creature State Management** — 1:1 mapping between completed todos and ecosystem creatures. Creature records are inserted during the popup Complete action; completed todos remain soft-persisted and their creature records are retained indefinitely (no uncomplete in v1).
- **Custom UI Primitives** — the neon snake cursor means every native browser element must be custom-rendered. This affects every UI surface: todo input, the in-scene Action Popup, and any future overlay components.
- **State Persistence Scope** — todo text, completion, color, group membership, position, timestamps all persist. Groups/clusters have their own state (member list, label, position). This is a wider persistence surface than typical todo apps.

## Starter Template Evaluation

### Primary Technology Domain

Full-stack with GPU-intensive frontend. Two distinct starters serve the two halves:

- **Backend:** Existing Nearform Python project template (already in repo)
- **Frontend:** New Vite + React + TypeScript project with Three.js additions

### Starter Options Considered

**Backend — Nearform Python Template (selected, already in repo):**
- Python 3.13+ with uv package manager
- ruff for linting and formatting
- mypy for type checking
- pytest for testing
- pre-commit hooks (ruff, mypy, pytest, conventional commits)
- GitHub Actions CI/CD
- Already configured and working

**Frontend — Vite React TypeScript:**
- `npm create vite@latest` with React + TypeScript template
- Minimal, fast, well-maintained
- No opinions on state management, routing, or styling — we add what we need
- Alternative considered: Next.js — rejected (no SSR needed, no routing complexity, SPA is sufficient, adds unnecessary weight)

### Selected Starters

**Backend: Nearform Python Template + FastAPI**

The existing project template provides the development tooling foundation. FastAPI adds the API layer on top.

**Initialization:** Already in repo. Add FastAPI and dependencies:
```bash
uv add fastapi uvicorn sqlalchemy asyncpg alembic python-jose
uv add --group dev httpx
```

**Frontend: Vite + React + TypeScript**

**Initialization Command:**
```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install three @react-three/fiber @react-three/postprocessing @react-three/drei
npm install @tanstack/react-query zustand axios
npm install -D @types/three vitest @testing-library/react
```

### Architectural Decisions Provided by Starters

**Language & Runtime:**
- Backend: Python 3.13+ with type hints, async/await via FastAPI
- Frontend: TypeScript 5.x with strict mode
- Both enforce static type checking (mypy + tsc)

**Backend Framework:**
- FastAPI — async Python, automatic OpenAPI docs, Pydantic validation, dependency injection
- Matches rag-csv-crew precedent — proven at Nearform for this pattern
- SQLAlchemy 2.0 async for database ORM
- Alembic for database migrations
- asyncpg for PostgreSQL async driver

**Frontend Framework:**
- React 18 with TypeScript
- Vite for build and dev server (HMR, fast builds)
- Three.js + React Three Fiber for 3D rendering
- @react-three/postprocessing for Bloom effects
- @react-three/drei for OrbitControls and helpers

**State Management:**
- TanStack React Query — server state (todo CRUD, search, embedding status)
- Zustand — client state (camera, atmosphere, creature registry, selection, search text, sound)
- No Redux — unnecessary complexity for this scope

**Styling Solution:**
- CSS custom properties for neon design tokens (ported from rag-csv-crew index.css)
- CSS Modules or plain CSS for non-3D overlay components (todo input)
- Three.js materials and shaders for all 3D elements
- No Tailwind/CSS framework — incompatible with Three.js-dominant UI

**Build Tooling:**
- Vite for frontend (fast HMR, optimized production builds)
- uv for backend dependency management
- docker-compose for PostgreSQL + pgvector local orchestration

**Testing Framework:**
- Backend: pytest (existing template)
- Frontend: Vitest + React Testing Library (component tests, not 3D scene tests)
- 3D scene testing: manual visual testing — no reliable automated testing for Three.js rendering

**Code Organization:**

```
nearform-bmad-todo-app/
├── frontend/                    # React + Three.js SPA
│   ├── src/
│   │   ├── components/
│   │   │   ├── pond/            # PondScene, LilyPad, water, ripples
│   │   │   ├── creatures/       # Ecosystem creatures (Firefly, Frog, Dragonfly, etc.)
│   │   │   ├── ui/              # TodoInput, ActionPopup, PopupActionButton, PopupColorSwatch
│   │   │   ├── effects/         # CursorSnake, LightningBorder (ported)
│   │   │   └── atmosphere/      # AtmosphereController, SoundManager
│   │   ├── hooks/               # usePond, useSearch, useCreatures, useAtmosphere
│   │   ├── stores/              # Zustand stores (camera, atmosphere, creatures, selection)
│   │   ├── api/                 # React Query hooks + axios client
│   │   ├── styles/              # CSS variables, global styles
│   │   └── types/               # TypeScript interfaces
│   ├── public/
│   │   └── sounds/              # Audio assets (last feature)
│   └── vite.config.ts
├── src/                         # Python backend (FastAPI)
│   ├── api/                     # Route handlers
│   ├── models/                  # SQLAlchemy models
│   ├── services/                # Business logic (embedding, search)
│   ├── schemas/                 # Pydantic request/response schemas
│   └── config.py                # Settings and configuration
├── migrations/                  # Alembic database migrations
├── tests/                       # pytest test suite
├── docker-compose.yml           # PostgreSQL + pgvector
├── pyproject.toml               # Python project config (existing)
└── .github/workflows/           # CI/CD (existing)
```

**Development Experience:**
- Frontend: Vite HMR for instant React/Three.js hot reload
- Backend: uvicorn with --reload for FastAPI auto-restart
- Database: docker-compose up for PostgreSQL + pgvector
- Single command: a top-level script starting all three (docker-compose + uvicorn + vite dev)

**Note:** Project initialization using these commands should be the first implementation story.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Normalized database schema (todos, groups, group_memberships, creatures)
- REST API structure with soft-delete and hybrid search endpoint
- Background embedding generation via async worker
- Three.js scene graph rendering strategy (mesh vs. HTML overlay per element)

**Important Decisions (Shape Architecture):**
- Zustand store structure (5 stores by domain)
- Rag-csv-crew porting strategy (copy + adapt)
- docker-compose for database only (app runs natively)
- Batch position update endpoint

**Deferred Decisions (Post-MVP):**
- Authentication architecture (v2)
- Multi-user data isolation (v2)
- External monitoring/APM (not needed for internal demo)
- Sound asset sourcing and spatial audio implementation (last feature)

### Data Architecture

**Schema: Normalized (4 core tables + pgvector)**

```sql
-- Core todo storage
todos (
  id            UUID PRIMARY KEY,
  text          TEXT NOT NULL,
  completed     BOOLEAN DEFAULT FALSE,
  color         VARCHAR(7) DEFAULT '#00eeff',  -- hex neon color
  position_x    FLOAT,
  position_y    FLOAT,
  embedding     VECTOR(768),                    -- Google embedding dimension
  embedding_status ENUM('pending','complete','failed') DEFAULT 'pending',
  archived      BOOLEAN DEFAULT FALSE,  -- DEPRECATED: auto-archive removed in v1 simplification
  archived_at   TIMESTAMP,              -- DEPRECATED: auto-archive removed in v1 simplification
  deleted       BOOLEAN DEFAULT FALSE,
  deleted_at    TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
)

-- Groups / group_memberships tables REMOVED 2026-04-23 per
-- sprint-change-proposal-2026-04-23.md. Selection-based temporary
-- grouping (Story 4.7) is session-only, no persisted schema.

-- Creature registry (tracks hatched creatures for despawn on uncomplete)
creatures (
  id            UUID PRIMARY KEY,
  todo_id       UUID REFERENCES todos(id) UNIQUE,  -- 1:1 with completed todo
  creature_type VARCHAR(50) NOT NULL,                -- 'frog', 'firefly', 'golden_koi', etc.
  rarity        VARCHAR(20) NOT NULL,                -- 'common', 'uncommon', 'rare', 'legendary'
  created_at    TIMESTAMP DEFAULT NOW()
)
```

**Indexes:**
- `todos.embedding` — IVFFlat or HNSW index for vector similarity search
- `todos(completed, deleted)` — partial index for active todos (pads that render in the pond)
- Full-text search — GIN index on `todos.text` using `tsvector`

**Migration strategy:** Alembic with auto-generation from SQLAlchemy models. Initial migration creates all tables. Future migrations for schema evolution.

### Authentication & Security

**v1: No authentication.** Single-user, no sessions, no tokens.

**Security baseline:**
- Google API key in server-side environment variable only — never in frontend bundle
- FastAPI input validation via Pydantic schemas on all endpoints
- SQL injection prevention via SQLAlchemy parameterized queries
- CORS restricted to frontend origin (`VITE_API_URL`)

**Future-proofing:** API route handlers accept a dependency-injectable `current_user` parameter defaulting to `None`. When auth is added in v2, this becomes a real user without changing route signatures.

### API & Communication Patterns

**REST API — FastAPI endpoints:**

```
POST   /api/todos              # Create todo → returns todo, triggers async embedding
GET    /api/todos              # List all active todos (with positions, colors, creatures)
PATCH  /api/todos/:id          # Update (completion, color, position)
DELETE /api/todos/:id          # Soft-delete (sets deleted=true, deleted_at=NOW())

PATCH  /api/todos/positions    # Batch position update [{id, x, y}, ...]

# /api/groups endpoints REMOVED 2026-04-23 per sprint-change-proposal-2026-04-23.md.

GET    /api/search?q=...       # Hybrid search (full-text + vector, ranked results)
```

**Search endpoint internals:**
1. Receive query text
2. Run PostgreSQL full-text search (fast, immediate results)
3. Generate embedding for query via Google API
4. Run pgvector cosine similarity search
5. Combine scores with weighted ranking (configurable weights)
6. Return unified ranked results

**Embedding background worker:**
- FastAPI BackgroundTasks for async embedding generation
- On `POST /api/todos`: save todo immediately with `embedding_status: 'pending'`, trigger background task
- Background task: call Google API, store embedding, update status to `'complete'` or `'failed'`
- Failed embeddings: auto-retry with exponential backoff (3 attempts max)

**Error response format:**
```json
{
  "error": "embedding_generation_failed",
  "message": "Embedding service temporarily unavailable",
  "todo_id": "uuid",
  "recoverable": true
}
```

**Auto-archive:** Removed in v1. Completed todos remain in the DB indefinitely (with `completed=true`) but are excluded from the pond render and search results.

### Frontend Architecture

**Three.js scene graph rendering strategy:**

| Element | Rendering | Rationale |
|---|---|---|
| Water surface | Three.js mesh + custom shader | GPU ripple physics |
| Lily pads | Three.js instanced meshes | Performance at 30+ |
| Ecosystem wildlife | Instanced meshes + particle system | Many small objects |
| Pad text | CSS2DRenderer HTML overlay | Sharp text at all zoom levels |
| Cluster labels | CSS2DRenderer HTML overlay | Same rationale |
| Search text on water | CSS2DRenderer with opacity | Feels "on the water" |
| Todo input | React HTML portal | Standard text input behavior |
| Action Popup | Three.js wireframe geometry + CSS2DRenderer labels | Anchored to focused pad, one instance at a time, Bloom-lit neon aesthetic |
| Color picker ring | Three.js sprites | Stays in 3D space near pad |
| Cursor snake | Separate canvas overlay | Proven approach from rag-csv-crew |
| Bloom/glow | @react-three/postprocessing | Full-scene postprocessing |

**Zustand store structure:**

| Store | Responsibility | Key State |
|---|---|---|
| `usePondStore` | Camera, atmosphere, viewport | cameraPosition, atmosphereMode, viewportSize |
| `useTodoStore` | Local todo cache, optimistic updates | todos[], pendingCreates[], pendingDeletes[] |
| `useCreatureStore` | Creature registry (todo↔creature map) | creatures Map<todoId, {type, rarity, instanceId}> |
| `useSelectionStore` | Multi-select, search, focus | selectedIds[], searchText, focusedPadId |
| `useSoundStore` | Audio state | muted, ambientVolume, interactionVolume |

**Rag-csv-crew porting strategy:**
- Copy source files to `frontend/src/components/effects/`
- Adapt imports/types for new project structure
- CursorSnake: direct port, minimal changes
- NeonScrollbar: not currently used (removed along with lizard belly list); keep available in reference port if a future need arises
- CSS variables: port to `frontend/src/styles/neon-tokens.css`
- LightningBorder: adapt for cluster glow aura

### Infrastructure & Deployment

**docker-compose:** Database only — app runs natively for fast hot reload.

```yaml
services:
  db:
    image: pgvector/pgvector:pg17
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    environment:
      POSTGRES_DB: todo_pond
      POSTGRES_USER: pond
      POSTGRES_PASSWORD: pond_dev
```

**Environment variables:**
- `.env` at project root (gitignored), `.env.example` committed
- `DATABASE_URL`, `GOOGLE_API_KEY`, `EMBEDDING_MODEL`, `CORS_ORIGINS`
- FastAPI: Pydantic Settings with `.env` support
- Frontend: `VITE_API_URL` for API base URL

**Development startup:**
```bash
make dev  # docker-compose up -d && uvicorn src.main:app --reload & cd frontend && npm run dev
```

**CI/CD (extend existing GitHub Actions):**
- Backend job: ruff lint → mypy type check → pytest
- Frontend job: tsc type check → vitest → vite build
- Both run on push and PR

**Monitoring:** Console/structured logging only. No external APM for v1 internal demo.

### Decision Impact Analysis

**Implementation sequence:**
1. docker-compose + database schema + Alembic migrations
2. FastAPI CRUD endpoints + Pydantic schemas
3. Frontend Vite project init + Three.js pond scene (water only)
4. Lily pads rendering + CRUD integration
5. Action Popup primitive (in-scene wireframe, pad-anchored)
6. Popup Complete action with rarity tier creature burst + unified dissolve
7. Popup Delete action with unified dissolve (soft delete)
8. Popup Color Swatch sub-panel
9. Popup Group/Ungroup actions
10. Search endpoint + embedding pipeline + type-anywhere UX
11. Groups/clusters
12. Ecosystem manager + creature registry
13. Atmosphere modes + camera polish
14. Rag-csv-crew component ports (CursorSnake, NeonScrollbar)
15. Sound design (last)

**Cross-component dependencies:**
- Embedding pipeline must exist before search works (but CRUD works without it)
- Action Popup is the core interaction primitive — Complete/Delete/Color/Group actions all depend on it landing first
- Ecosystem manager depends on both todo count (ambient creatures) and creature registry (hatched creatures)
- Atmosphere mode affects every visual component — implement as global Zustand state early, wire into components progressively

## Implementation Patterns & Consistency Rules

### Naming Patterns

**Database Naming (PostgreSQL):**
- Tables: `snake_case`, plural — `todos`, `groups`, `group_memberships`, `creatures`
- Columns: `snake_case` — `todo_id`, `created_at`, `embedding_status`
- Foreign keys: `{referenced_table_singular}_id` — `todo_id`, `group_id`
- Indexes: `ix_{table}_{column}` — `ix_todos_embedding`, `ix_todos_deleted_archived`
- Enums: `snake_case` values — `'pending'`, `'complete'`, `'failed'`

**API Naming (REST):**
- Endpoints: `snake_case`, plural nouns — `/api/todos`, `/api/groups`, `/api/search`
- Route parameters: `snake_case` — `/api/todos/{todo_id}`
- Query parameters: `snake_case` — `/api/search?q=...&limit=20`
- JSON fields: `snake_case` throughout — `{ "todo_id": "...", "created_at": "..." }`
- HTTP methods: standard REST (GET list, POST create, PATCH update, DELETE remove)

**Backend Code (Python):**
- Files: `snake_case.py` — `todo_service.py`, `search_router.py`
- Classes: `PascalCase` — `TodoSchema`, `SearchService`, `CreatureModel`
- Functions: `snake_case` — `create_todo()`, `generate_embedding()`
- Variables: `snake_case` — `todo_id`, `embedding_status`
- Constants: `UPPER_SNAKE_CASE` — `MAX_RETRY_ATTEMPTS`, `DEFAULT_ARCHIVE_DAYS`

**Frontend Code (TypeScript):**
- Files: `PascalCase.tsx` for components — `LilyPad.tsx`, `PondScene.tsx`
- Files: `camelCase.ts` for non-components — `usePond.ts`, `todoApi.ts`
- Components: `PascalCase` — `<LilyPad />`, `<ActionPopup />`
- Functions/hooks: `camelCase` — `useTodoStore()`, `handlePadClick()`
- Variables: `camelCase` — `todoId`, `embeddingStatus`
- Types/interfaces: `PascalCase` — `Todo`, `CreatureType`, `PondState`
- Constants: `UPPER_SNAKE_CASE` — `NEON_COLORS`, `DEBOUNCE_MS`
- Zustand stores: `use{Name}Store` — `usePondStore`, `useCreatureStore`

**API boundary transformation:**
```typescript
// axios interceptor transforms snake_case → camelCase on response
// and camelCase → snake_case on request
const apiClient = axios.create({ baseURL: import.meta.env.VITE_API_URL });
apiClient.interceptors.response.use(res => ({ ...res, data: camelizeKeys(res.data) }));
apiClient.interceptors.request.use(cfg => ({ ...cfg, data: decamelizeKeys(cfg.data) }));
```

### Structure Patterns

**Backend project organization (by layer):**
```
src/
├── api/
│   ├── __init__.py
│   ├── todos.py          # Todo route handlers
│   ├── groups.py         # Group route handlers
│   └── search.py         # Search route handler
├── models/
│   ├── __init__.py
│   ├── todo.py           # SQLAlchemy Todo model
│   ├── group.py          # SQLAlchemy Group + GroupMembership models
│   └── creature.py       # SQLAlchemy Creature model
├── schemas/
│   ├── __init__.py
│   ├── todo.py           # Pydantic TodoCreate, TodoUpdate, TodoResponse
│   ├── group.py          # Pydantic GroupCreate, GroupUpdate, GroupResponse
│   └── search.py         # Pydantic SearchResponse, SearchResult
├── services/
│   ├── __init__.py
│   ├── todo_service.py   # Todo business logic
│   ├── search_service.py # Hybrid search logic
│   └── embedding_service.py # Google API embedding generation
├── config.py             # Pydantic Settings
├── database.py           # SQLAlchemy async engine + session
└── main.py               # FastAPI app creation + middleware
```

**Frontend component organization (by domain):**
```
src/
├── components/
│   ├── pond/             # 3D scene components
│   │   ├── PondScene.tsx
│   │   ├── WaterSurface.tsx
│   │   ├── LilyPad.tsx
│   │   └── PondCamera.tsx
│   ├── creatures/        # Ecosystem creature components
│   │   └── EcosystemManager.tsx
│   ├── ui/               # HTML overlay components
│   │   ├── TodoInput.tsx
│   │   ├── ActionPopup.tsx
│   │   ├── PopupActionButton.tsx
│   │   ├── PopupColorSwatch.tsx
│   │   └── SearchOverlay.tsx
│   ├── effects/          # Ported rag-csv-crew components
│   │   ├── CursorSnake.tsx
│   │   ├── CursorSnake.css
│   │   ├── NeonScrollbar.tsx
│   │   └── LightningBorder.tsx
│   └── atmosphere/       # Environment control components
│       ├── AtmosphereController.tsx
│       └── SoundManager.tsx
├── hooks/                # Custom React hooks
│   ├── usePondInteraction.ts
│   ├── useSearch.ts
│   ├── useActionPopup.ts
│   ├── usePopupComplete.ts
│   ├── usePopupDelete.ts
│   └── useKeyboardShortcuts.ts
├── stores/               # Zustand stores
│   ├── usePondStore.ts
│   ├── useTodoStore.ts
│   ├── useCreatureStore.ts
│   ├── useSelectionStore.ts
│   └── useSoundStore.ts
├── api/                  # React Query + axios
│   ├── client.ts         # Axios instance with snake/camel transform
│   ├── todoApi.ts        # React Query hooks for todo CRUD
│   ├── groupApi.ts       # React Query hooks for groups
│   └── searchApi.ts      # React Query hooks for search
├── styles/
│   └── neon-tokens.css   # CSS custom properties (ported)
├── types/
│   └── index.ts          # Shared TypeScript interfaces
├── App.tsx
└── main.tsx
```

**Test location:**
- Backend: `tests/` directory mirroring `src/` structure — `tests/api/test_todos.py`, `tests/services/test_search_service.py`
- Frontend: co-located `*.test.tsx` files — `LilyPad.test.tsx` next to `LilyPad.tsx`

### Format Patterns

**API response format — direct response, no wrapper:**
```json
// Single item
{ "id": "uuid", "text": "...", "completed": false, ... }

// List
[{ "id": "uuid", ... }, { "id": "uuid", ... }]

// Search results (includes score)
{ "results": [{ "todo": {...}, "score": 0.87 }], "query": "..." }
```

**Error response format — consistent structure:**
```json
{
  "error": "not_found",
  "message": "Todo with id {id} not found",
  "detail": null
}
```
- HTTP 400: validation errors (Pydantic auto-generates)
- HTTP 404: resource not found
- HTTP 500: unexpected server error (logged, generic message to client)
- HTTP 503: embedding service unavailable (recoverable)

**Date format:** ISO 8601 strings in UTC — `"2026-04-14T17:30:00Z"`. No timestamps, no locale-specific formats.

**Null handling:** Explicit `null` in JSON for absent optional fields. Never omit the field — presence is consistent, value is nullable.

### Communication Patterns

**React Query conventions:**
```typescript
// Query keys: [domain, action, ...params]
queryKey: ['todos', 'list']
queryKey: ['todos', 'detail', todoId]
queryKey: ['search', 'results', queryText]

// Mutation naming: use{Action}{Entity}
useMutation: useCreateTodo, useUpdateTodo, useDeleteTodo
useMutation: useCreateGroup
```

**Zustand update pattern — always immutable:**
```typescript
// Good
set((state) => ({ todos: state.todos.map(t => t.id === id ? { ...t, completed: true } : t) }))

// Bad — never mutate
set((state) => { state.todos[0].completed = true })
```

**Three.js component pattern:**
```typescript
// Every 3D component follows this structure:
export function LilyPad({ todo, onHover, onClick }: LilyPadProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const atmosphere = usePondStore(s => s.atmosphereMode)

  useFrame((state, delta) => {
    // Animation logic per frame
  })

  return (
    <mesh ref={meshRef} position={[todo.positionX, 0, todo.positionY]}>
      {/* geometry + material */}
    </mesh>
  )
}
```

### Process Patterns

**Error handling — backend:**
- Services throw typed exceptions (`TodoNotFoundError`, `EmbeddingServiceError`)
- Route handlers catch exceptions and return appropriate HTTP responses
- Unexpected exceptions caught by FastAPI exception handler, logged, return 500

**Error handling — frontend:**
- React Query `onError` callbacks per mutation
- Global error boundary catches unhandled React errors
- 3D scene errors: biological decay visual on affected pad, auto-retry in background
- Network errors: pond continues working with cached state, syncs when connectivity returns

**Loading states:**
- React Query provides `isLoading`, `isFetching` per query — use directly
- Initial pond load: staggered pad materialization (not spinner)
- Search in progress: water surface shift animation
- Embedding pending: subtle pad shimmer (outline pulse) on affected pad

**Optimistic updates:**
```typescript
// Todo creation: add pad to pond immediately
// Server confirms: update with real ID
// Server fails: remove pad with error ripple animation
useMutation({
  onMutate: (newTodo) => { /* add optimistic pad */ },
  onError: (err, newTodo, context) => { /* remove pad, show error */ },
  onSettled: () => { queryClient.invalidateQueries(['todos']) }
})
```

### Enforcement Guidelines

**All AI agents MUST:**
- Use `snake_case` for all Python code, database columns, and API JSON fields
- Use `camelCase` for all TypeScript variables/functions, with the axios interceptor handling API transformation
- Use `PascalCase` for React components, TypeScript types, and Python classes
- Follow the directory structure defined above — no ad-hoc file placement
- Use React Query for all server state, Zustand for all client state — never mix
- Return consistent error response format from all API endpoints
- Use ISO 8601 UTC for all date/time values

**Anti-patterns to avoid:**
- Mixing `snake_case` and `camelCase` in the same layer
- Storing server state in Zustand (use React Query)
- Using `useEffect` for data fetching (use React Query)
- Raw `fetch()` calls (use the configured axios client)
- Inline styles in Three.js components (use material properties or CSS custom properties)
- `any` type in TypeScript (use proper types or `unknown`)

## Project Structure & Boundaries

### Complete Project Directory Structure

```
nearform-bmad-todo-app/
├── .github/
│   └── workflows/
│       ├── ci-backend.yml        # Python: ruff + mypy + pytest
│       └── ci-frontend.yml       # TypeScript: tsc + vitest + build
├── frontend/
│   ├── public/
│   │   └── sounds/               # Audio assets (last feature)
│   ├── src/
│   │   ├── components/
│   │   │   ├── pond/
│   │   │   │   ├── PondScene.tsx          # Root Three.js canvas + postprocessing
│   │   │   │   ├── WaterSurface.tsx       # Water mesh + ripple shader
│   │   │   │   ├── LilyPad.tsx            # Individual todo pad (3D mesh + HTML text overlay)
│   │   │   │   ├── LilyPadCluster.tsx     # Group of pads with shared aura
│   │   │   │   └── PondCamera.tsx         # OrbitControls + auto-framing logic
│   │   │   ├── creatures/
│   │   │   │   ├── EcosystemManager.tsx    # Spawns/manages ambient + hatched creatures
│   │   │   │   └── creatures/              # Individual creature meshes/sprites
│   │   │   │       ├── Firefly.tsx
│   │   │   │       ├── Frog.tsx
│   │   │   │       ├── Fish.tsx
│   │   │   │       ├── Dragonfly.tsx
│   │   │   │       ├── WaterStrider.tsx
│   │   │   │       └── LegendaryCreatures.tsx
│   │   │   ├── ui/
│   │   │   │   ├── TodoInput.tsx           # Neon text input (React portal)
│   │   │   │   ├── ActionPopup.tsx         # In-scene neon wireframe popup anchored to focused pad
│   │   │   │   ├── PopupActionButton.tsx   # Neon wireframe action button (Complete, Delete, Set Color, Group/Ungroup)
│   │   │   │   ├── PopupColorSwatch.tsx    # Color swatch sub-panel inside ActionPopup
│   │   │   │   └── SearchOverlay.tsx       # Search text on water (CSS2DRenderer)
│   │   │   ├── effects/
│   │   │   │   ├── CursorSnake.tsx         # Ported from rag-csv-crew
│   │   │   │   ├── CursorSnake.css
│   │   │   │   ├── NeonScrollbar.tsx       # Ported from rag-csv-crew
│   │   │   │   ├── NeonScrollbar.css
│   │   │   │   └── LightningBorder.tsx     # Ported, adapted for cluster aura
│   │   │   └── atmosphere/
│   │   │       ├── AtmosphereController.tsx # Zen/cyberpunk toggle
│   │   │       └── SoundManager.tsx         # Audio layer (last feature)
│   │   ├── hooks/
│   │   │   ├── usePondInteraction.ts       # Hover, click, drag pad logic
│   │   │   ├── useSearch.ts                # Type-anywhere + debounce + surface/submerge
│   │   │   ├── useActionPopup.ts           # Popup open/close/position state for focused pad
│   │   │   ├── usePopupComplete.ts         # Complete action: rarity roll, creature spawn, pad dissolve orchestration
│   │   │   ├── usePopupDelete.ts           # Delete action: pad dissolve + soft-delete API call
│   │   │   ├── useKeyboardShortcuts.ts     # Global keyboard event routing
│   │   │   └── useAutoFrame.ts             # Camera auto-framing for search results
│   │   ├── stores/
│   │   │   ├── usePondStore.ts             # Camera, atmosphere, viewport
│   │   │   ├── useTodoStore.ts             # Local cache, optimistic updates
│   │   │   ├── useCreatureStore.ts         # Todo↔creature registry
│   │   │   ├── useSelectionStore.ts        # Multi-select, search text, focused pad
│   │   │   └── useSoundStore.ts            # Muted, volumes
│   │   ├── api/
│   │   │   ├── client.ts                   # Axios instance + snake/camel interceptors
│   │   │   ├── todoApi.ts                  # useCreateTodo, useUpdateTodo, useDeleteTodo, useTodos
│   │   │   ├── groupApi.ts                 # useCreateGroup, useUpdateGroup, useDeleteGroup
│   │   │   └── searchApi.ts                # useSearch (debounced)
│   │   ├── styles/
│   │   │   ├── neon-tokens.css             # CSS custom properties (ported)
│   │   │   └── global.css                  # Global styles, font imports, cursor:none
│   │   ├── types/
│   │   │   └── index.ts                    # Todo, Group, Creature, SearchResult, AtmosphereMode
│   │   ├── App.tsx                          # Root: QueryClientProvider + PondScene + overlays
│   │   └── main.tsx                         # React entry point
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── package.json
│   └── vitest.config.ts
├── src/                                     # Python backend
│   ├── api/
│   │   ├── __init__.py
│   │   ├── todos.py                         # CRUD + batch position update
│   │   ├── groups.py                        # Group CRUD
│   │   └── search.py                        # Hybrid search endpoint
│   ├── models/
│   │   ├── __init__.py
│   │   ├── todo.py                          # Todo SQLAlchemy model
│   │   ├── group.py                         # Group + GroupMembership models
│   │   └── creature.py                      # Creature model (hatched + resident)
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── todo.py                          # TodoCreate, TodoUpdate, TodoResponse, TodoPositionBatch
│   │   ├── group.py                         # GroupCreate, GroupUpdate, GroupResponse
│   │   ├── creature.py                      # CreatureResponse
│   │   └── search.py                        # SearchQuery, SearchResult, SearchResponse
│   ├── services/
│   │   ├── __init__.py
│   │   ├── todo_service.py                  # Todo business logic
│   │   ├── group_service.py                 # Group business logic
│   │   ├── search_service.py                # Full-text + vector ranking
│   │   ├── embedding_service.py             # Google API integration + retry
│   │   └── creature_service.py              # Creature spawning, rarity, resident management
│   ├── config.py                            # Pydantic Settings
│   ├── database.py                          # Async SQLAlchemy engine + session factory
│   ├── exceptions.py                        # Typed exceptions
│   └── main.py                              # FastAPI app, CORS, exception handlers, startup
├── migrations/
│   ├── env.py                               # Alembic environment config
│   ├── versions/                            # Migration files
│   └── alembic.ini
├── tests/
│   ├── conftest.py                          # Fixtures: test DB, async client
│   ├── api/
│   │   ├── test_todos.py
│   │   ├── test_groups.py
│   │   └── test_search.py
│   └── services/
│       ├── test_todo_service.py
│       ├── test_search_service.py
│       ├── test_embedding_service.py
│       └── test_creature_service.py
├── docker-compose.yml                       # PostgreSQL + pgvector
├── Makefile                                 # dev, test, lint, migrate commands
├── pyproject.toml                           # Python config (existing)
├── .pre-commit-config.yaml                  # Pre-commit hooks (existing)
├── .env.example                             # DATABASE_URL, GOOGLE_API_KEY, etc.
├── .gitignore
└── README.md
```

### Creature Rarity System & Resident Creatures

**Rarity tiers (updated with resident tier):**

| Rarity | Source | Examples | Count |
|---|---|---|---|
| Common | Egg hatch (~50%) | Firefly, water strider | Scales with completions |
| Uncommon | Egg hatch (~35%) | Frog, dragonfly, butterfly | Scales with completions |
| Rare | Egg hatch (~12%) | Fish, turtle | Scales with completions |
| Legendary | Egg hatch (~3%) | Golden koi, neon phoenix, glowing jellyfish | Scales with completions |

**Creatures table supports all tiers:**
```sql
creatures (
  id            UUID PRIMARY KEY,
  todo_id       UUID REFERENCES todos(id) UNIQUE NULL,  -- NULL for resident creatures
  creature_type VARCHAR(50) NOT NULL,
  rarity        VARCHAR(20) NOT NULL,  -- 'common','uncommon','rare','legendary','resident'
  created_at    TIMESTAMP DEFAULT NOW()
)
```

- Hatched creatures: `todo_id` links to the completed todo (1:1). Despawns on uncomplete.
- Resident creatures: `todo_id = NULL`. System-managed. Not tied to any todo.

**First-run experience:** Empty-pond hint ("just start typing...") from Story 1.4 covers onboarding. No tutorial-complete flag needed; the pond's empty state is self-explanatory.

### First-Run Experience

**Onboarding:** The empty-pond state (Story 1.4) shows subtle water movement, ambient glow, and the hint text "just start typing..." — sufficient for a zero-guidance first interaction.

### Architectural Boundaries

**API Boundary (backend ↔ frontend):**
- All communication via REST JSON over HTTP
- Frontend knows nothing about database schema — only Pydantic response shapes
- Backend knows nothing about 3D rendering — only data CRUD
- CORS restricts API to frontend origin

**Service Boundary (within backend):**
- Route handlers → Services → Database. Never skip layers.
- `todo_service.py` owns todo logic. `search_service.py` owns ranking. `embedding_service.py` owns Google API. `creature_service.py` owns rarity selection and resident management.
- Services don't import each other's models directly — they communicate through function parameters.

**3D Scene Boundary (within frontend):**
- Three.js components live in `components/pond/` and `components/creatures/`
- HTML overlay components live in `components/ui/`
- 3D components receive data via props or Zustand — never call API directly
- API calls happen in `hooks/` and `api/` only — 3D components are purely visual

**Data Boundary:**
- SQLAlchemy models are the single source of truth for database shape
- Pydantic schemas are the single source of truth for API shape
- TypeScript types in `types/index.ts` are the single source of truth for frontend data shape
- These three must stay aligned — changes to one require changes to the others

### Requirements to Structure Mapping

| FR Category | Backend | Frontend |
|---|---|---|
| Task Management (FR1-FR8) | `api/todos.py`, `services/todo_service.py`, `models/todo.py` | `pond/LilyPad.tsx`, `ui/ActionPopup.tsx`, `ui/PopupActionButton.tsx` |
| Task Organization (FR9-FR13) | `api/groups.py`, `services/group_service.py`, `models/group.py` | `pond/LilyPadCluster.tsx`, `ui/PopupColorSwatch.tsx` |
| Task Discovery (FR13-FR21) | `api/search.py`, `services/search_service.py` | `hooks/useSearch.ts`, `ui/SearchOverlay.tsx`, `hooks/useAutoFrame.ts` |
| Embedding Generation (FR22-FR24) | `services/embedding_service.py` | (transparent — backend only) |
| Pond Environment (FR25-FR32) | `services/creature_service.py` | `pond/PondScene.tsx`, `pond/WaterSurface.tsx`, `pond/PondCamera.tsx`, `atmosphere/`, `effects/CursorSnake.tsx` |
| Application States (FR37-FR40) | Error responses from all endpoints | `pond/PondScene.tsx` (empty/loading), `pond/LilyPad.tsx` (error decay) |
| Data Persistence (FR41-FR43) | `models/`, `database.py`, `migrations/` | (transparent — backend only) |
| Sound Design (FR44-FR46) | — | `atmosphere/SoundManager.tsx`, `public/sounds/` |
| Dev Infrastructure (FR47-FR49) | `docker-compose.yml`, `Makefile`, `.github/workflows/` | `vite.config.ts`, `package.json` |

### Data Flow

```
User Interaction → React Event Handler → Hook (useSearch, usePondInteraction)
  → Zustand (client state) + React Query mutation (server state)
    → Axios client (camelCase → snake_case transform)
      → FastAPI route handler
        → Service layer (business logic)
          → SQLAlchemy model (database)
          → Google API (embedding, async)
        ← Pydantic response schema
      ← Axios interceptor (snake_case → camelCase transform)
    ← React Query cache update
  ← Zustand state update
← Three.js re-render (pond responds visually)
```

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:** Pass — React 18 + Three.js/R3F + Vite, FastAPI + SQLAlchemy 2.0 async + asyncpg, PostgreSQL 17 + pgvector, TanStack React Query + Zustand — all well-established combinations with no version conflicts.

**Pattern Consistency:** Pass — `snake_case` consistently in Python/DB/API, `camelCase` in TypeScript, axios interceptor handles boundary. All Zustand stores follow `use{Name}Store`, all React Query hooks follow `use{Action}{Entity}`.

**Structure Alignment:** Pass — directory structure maps 1:1 with architectural domains. Layer separation in backend (api → services → models), domain separation in frontend (pond, creatures, ui, effects, atmosphere).

### Requirements Coverage Validation

**Functional Requirements:** 49/49 mapped to specific files — 100% coverage.
**Non-Functional Requirements:** 6/6 key NFRs architecturally supported — 100% coverage.

### Implementation Readiness Validation

**Decision Completeness:** Pass — all critical decisions documented with rationale, SQL schema specified, API endpoints listed, scene graph strategy mapped.
**Structure Completeness:** Pass — complete directory tree with all files named and responsibilities assigned.
**Pattern Completeness:** Pass — naming, error handling, optimistic updates, Three.js component patterns all documented with examples.

### Gap Analysis Results

**Critical Gaps:** 0

**Important Gaps Resolved:**
1. Creature records are created server-side during the popup Complete action (no separate `POST /api/creatures` endpoint needed in v1). Handled by `creature_service.py` within the todo update flow.
2. Position persistence trigger — batch save debounced 2 seconds after drag settles, plus `beforeunload` save.

### Architecture Completeness Checklist

- [x] Project context analyzed (49 FRs, 15 NFRs, full UX spec)
- [x] Technology stack specified with rationale
- [x] Database schema defined (4 tables + pgvector)
- [x] REST API endpoints listed with HTTP methods
- [x] Frontend scene graph rendering strategy mapped
- [x] State management architecture defined (React Query + Zustand)
- [x] Naming conventions established across all layers
- [x] Error handling patterns for backend and frontend
- [x] Complete directory structure with file-to-FR mapping
- [x] Creature rarity system with resident tier
- [x] First-run experience (zero-guidance empty pond)
- [x] Data flow documented end-to-end
- [x] Implementation sequence defined (12 steps)
- [x] Cross-component dependencies mapped

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION
**Confidence Level:** High

**Key Strengths:**
- Complete FR coverage with explicit file-to-requirement mapping
- Proven tech stack matching rag-csv-crew (portability)
- Clear separation between 3D rendering and data management
- Creature table unifies hatched + resident creatures cleanly
- Onboarding is zero-guidance: empty-pond state + type-anywhere input

**First Implementation Priority:**
1. docker-compose + database schema + Alembic migrations
2. FastAPI CRUD endpoints + Pydantic schemas
3. Frontend Vite project init + Three.js pond scene (water only)
4. Lily pad rendering + CRUD integration
5. Action Popup primitive (in-scene wireframe, pad-anchored)
6. Popup Complete action with rarity tier creature burst + unified dissolve
7. Popup Delete action with unified dissolve (soft delete)
8. Popup Color Swatch sub-panel
9. Popup Group/Ungroup actions
10. Search endpoint + embedding pipeline + type-anywhere UX

---

## Addendum: CrewAI Chat Agent (2026-04-23)

_Scoped extension to support an AI agent chat interface. Appended in place to preserve the existing architecture as the canonical source for downstream skills. Not a rewrite — the core decisions in §§ Project Context, Starter Eval, Core Decisions, Patterns, and Structure remain authoritative._

### Addendum Context & Scope Boundary

**What this adds:**
- A CrewAI-based chat agent exposed via F1 and the `/help` slash command.
- A chat panel UI (right-side drawer) with session management, history, and streaming assistant replies.
- An extensible skill system: `chat` (free-form), `organize`, `plan`, `rephrase`, `reformat`, plus an `intent_classifier` for inferred routing.
- Two new DB tables (`chat_sessions`, `chat_messages`) and one new column on `todos` (`display_metadata`).
- A read-only database tool surface for the crew, wrapping existing services.
- SSE-based streaming from backend to frontend for live assistant output.

**What this does NOT change:**
- Existing REST endpoints for todos, search, embeddings — untouched.
- Existing frontend stores, components, and the TodoInput slash-command framework — the framework stays pure for toggle commands; `/help` is a parser carve-out.
- Constitutional constraints — thread-based concurrency only, sync FastAPI handlers, sync psycopg_pool.
- Existing Epic 1–5, 7, 8 scope.

**Why addendum vs. rewrite:** the base architecture is complete and production-shaped. The agent is additive to a well-formed substrate, not a rearchitecture. Keeping the addendum in-place gives downstream epic/story creation a single authoritative document to read.

**Epic assignment:** slots cleanly into the gap at Epic 6 in `epics.md` (current list jumps 5 → 7).

**Reference repo:** patterns follow the local `C:\Users\michael\nearform\rag-csv-crew`, with one deliberate divergence (tool dependency injection — see Decision 3.1).

---

### Decision 1: CrewAI Hosting & Concurrency Strategy

**Problem:** CrewAI's `crew.kickoff()` is sync (compatible with the constitution) but multi-second per run. Calling it inline inside a FastAPI request handler blocks a worker thread for the full crew duration.

**Decision: thread-per-request with SSE streaming.**

| Aspect | Choice |
|---|---|
| Crew execution | Daemon `threading.Thread` per chat request |
| Response shape | `StreamingResponse` with sync Python generator yielding SSE frames |
| Thread ↔ SSE transport | `queue.Queue` — crew thread enqueues events, generator dequeues and yields |
| Cancellation | `threading.Event` per in-flight message; crew thread checks at step boundaries |
| Lifetime | Daemon threads die on app shutdown; no join required |
| Multi-worker deployment | Single-process v1; cancellation map is in-memory per-process (noted as upgrade path) |

**Thread hygiene:**
- No module-level globals for per-request state. Dependencies injected via `BaseTool.__init__` (see Decision 3.1).
- LLM credentials loaded once at app startup (`Settings` via Pydantic), not per-request.
- Cancellation endpoint (`POST /api/agent/sessions/{id}/cancel`) reserved even if UX doesn't expose it in v1.

**Constitutional compliance:**
- No `async`/`await`/`asyncio` anywhere in this substrate.
- `time.sleep()` (used in simulated streaming — Decision 6.3) releases the GIL and is thread-safe.
- FastAPI `StreamingResponse` with a sync generator is supported natively and does not require async handlers.

---

### Decision 2: Chat & History Data Model

#### Schema

```sql
chat_sessions (
  id            UUID PRIMARY KEY,
  title         TEXT,                          -- auto-derived from first user message, user-editable
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()        -- bumped on new message
)

chat_messages (
  id            UUID PRIMARY KEY,
  session_id    UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role          VARCHAR(16) NOT NULL
                CHECK (role IN ('user','assistant','system','tool')),
  content       TEXT NOT NULL,
  skill         VARCHAR(64),                   -- which skill handled it; NULL for user msgs
  metadata      JSONB DEFAULT '{}',            -- proposal envelope, todo_refs, etc.
  status        VARCHAR(16) NOT NULL DEFAULT 'complete'
                CHECK (status IN ('pending','streaming','complete','failed','cancelled')),
  error         TEXT,                          -- populated when status='failed'
  created_at    TIMESTAMP DEFAULT NOW()
)

CREATE INDEX idx_chat_messages_session_created ON chat_messages(session_id, created_at);
```

#### Semantics

| Aspect | Decision |
|---|---|
| Clear-history semantics | Hard delete via `DELETE /api/agent/sessions/{id}`; `ON DELETE CASCADE` drops messages |
| Session model | Multiple sessions, user-managed, auto-titled from first user message |
| Context window | Last 20 turns (user+assistant pairs) passed to each crew run; simple `ORDER BY created_at DESC LIMIT` then reversed |
| Todo cross-link | `metadata.todo_refs: ["uuid", ...]` — cheap JSONB list, not queryable; promote to junction table later if needed |
| In-flight row writes | Row inserted at message-arrival with `status='pending'`, final `content` written once at end (not appended per-token) |
| Retention / auto-purge | None in v1; manual delete only |

**Rationale:**
- Hard delete matches the user's expectation of "clear" and avoids soft-delete admin debt in a single-user app.
- 20-turn window is a predictable token budget; upgrade to rolling-summary compaction if sessions routinely exceed it.
- JSONB `todo_refs` covers 90% of debug use cases without a new table.

---

### Decision 3: Database Tool Contract for the Crew

#### 3.1 Tool authorship: `BaseTool` subclasses, not `@tool` decorators

Each tool is a `BaseTool` subclass instantiated per-request with explicit dependencies:

```
src/agent/tools/
├── __init__.py
├── base.py                  # Shared BaseTool subclass with pool/service injection
├── list_todos.py
├── get_todo.py
├── search_todos.py
└── get_chat_history.py
```

**Deliberate divergence from rag-csv-crew:** the reference repo uses the `@tool` decorator with module-level globals for context (`_schema_inspector_service = ...`). This is unsafe in concurrent threaded contexts — two simultaneous crews would share and overwrite each other's state. Class-based tools with `__init__` injection are thread-safe by construction.

#### 3.2 Read-only in v1

Tools only read. Skills produce **proposals** that the frontend renders as previews; the user clicks Apply; the frontend then calls existing REST endpoints to mutate. Rationale:

- Trust gradient — LLM gets read access before write access.
- No duplicate mutation paths — existing `PATCH /api/todos` / `PATCH /api/todos/positions` / `POST /api/todos` already carry validation, embedding re-triggering, and soft-delete semantics.
- Undo is free — rejected proposals leave no state.

#### 3.3 Tool inventory

| Tool | Purpose | Wraps |
|---|---|---|
| `ListTodosTool` | Fetch active todos with id/text/color/completed/position/created_at. Optional `filter`: `active\|completed\|all`. | `todo_service.list_for_agent(filter, limit)` (new method) |
| `GetTodoTool` | Full detail for one todo. | `todo_service.get_by_id(id)` (existing) |
| `SearchTodosTool` | Hybrid search. | `search_service.search(query, limit)` (existing) |
| `GetChatHistoryTool` | Last N messages of current session, scoped by `session_id` at construction. | `chat_service.list_messages(session_id, limit)` (new) |

**Not in the tool set:** `CreateTodoTool`, `UpdateTodoTool`, `DeleteTodoTool`, `BatchPositionTool` — these exist as REST endpoints and are called by the frontend on Apply.

#### 3.4 Tool I/O shape

- Tools return **JSON-serialized strings** (CrewAI's expected return shape).
- Field names compact (`id`, `text`, `done`, `color`, `x`, `y`, `created`) to minimize LLM token overhead.
- `ListTodosTool` default result cap: 100 todos; hard cap: 500. Crews that need more use `SearchTodosTool`.

#### 3.5 Proposal envelope (the structured output side)

Every skill's final message carries in `metadata`:

```json
{
  "skill": "organize",
  "proposal": {
    "kind": "position_deltas",
    "payload": { /* kind-specific */ },
    "targets": ["<todo_id>", ...],
    "reasoning": "<1-2 sentence user-facing rationale>"
  }
}
```

**`kind` values:**

| Skill | kind | Payload shape |
|---|---|---|
| `organize` | `position_deltas` | `[{id, x, y}, ...]` matching `PATCH /api/todos/positions` body exactly |
| `plan` | `plan` | `{steps: [{text, done?, order}], rationale}` |
| `rephrase` | `text_rewrite` | `[{id, current, suggested, notes[]}, ...]` |
| `reformat` | `visual_cues` | `{id, cues: {emphasis?, icons?, badges?}}` |
| `chat` | `none` | — plain prose |

#### 3.6 Safety baseline

- **Bounded result sets** (see 3.4).
- **SQL injection** — tools call service methods; services use SQLAlchemy/psycopg parameterized queries; no string interpolation near the LLM.
- **Prompt-injection framing** — the crew's system prompt explicitly frames `todos.text` and `chat_messages.content` as *untrusted data*, never as instructions. A user todo like "ignore previous instructions and…" must not hijack the agent.
- **Tool-call audit logging — deferred.** A per-invocation log at `message.metadata.tool_calls: [{tool, inputs, result_summary, duration_ms}]` is valuable for debugging but not load-bearing for v1. Captured as a deferred-work story; trigger to pull forward = first "why did the agent do that?" investigation.

---

### Decision 4: Skill Registry & Extensibility Pattern

#### 4.1 Skill model: crew preset

A skill is a factory that builds a `Crew` for that skill's purpose:

```python
def build_crew(ctx: SkillContext) -> Crew: ...
```

Each skill picks its own agents, tasks, and tool subset. This matches rag-csv-crew's mental model and gives each skill specialization headroom at ~30 lines per skill.

#### 4.2 Routing: explicit or inferred

- **Explicit:** frontend sends `skill: "rephrase"` — service dispatches directly.
- **Inferred:** frontend sends `skill: null` — service runs the `intent_classifier` skill (one lightweight LLM call) to pick a skill, then dispatches.

The `intent_classifier` is itself a skill — symmetric registry treatment.

#### 4.3 Registry

```python
# src/agent/skills/registry.py

@dataclass(frozen=True)
class SkillSpec:
    name: str
    description: str                            # Used in classifier prompt
    proposal_kind: str | None                   # From Decision 3.5
    builder: Callable[[SkillContext], Crew]

SKILL_REGISTRY: dict[str, SkillSpec] = { ... }
```

`SkillContext` is an immutable bundle: `{pool, session_id, user_message, message_history, todos_snapshot?, event_queue}`. The `event_queue` is the `queue.Queue` from Decision 1.

#### 4.4 Layout

```
src/agent/skills/
├── __init__.py
├── registry.py              # SKILL_REGISTRY, SkillSpec, SkillContext
├── base.py                  # Shared helpers (system-prompt base, proposal builders)
├── intent_classifier.py
├── chat.py
├── organize.py
├── plan.py
├── rephrase.py
└── reformat.py
```

#### 4.5 Agent count per initial skill

| Skill | Agent shape |
|---|---|
| `chat` | 1 agent (conversational assistant with read tools) |
| `organize` | 2 agents sequentially: *relationship-finder* → *layout-proposer* |
| `plan` | 1 agent (planner with read tools) |
| `rephrase` | 1 agent (editor with read tools) |
| `reformat` | 1 agent (analyst emitting cue hints) |
| `intent_classifier` | 1 agent, no tools |

#### 4.6 Extension contract

Adding a skill requires:
1. New file `src/agent/skills/<name>.py` exporting `build_crew(ctx) -> Crew`.
2. Registration row in `SKILL_REGISTRY`.
3. (If the skill produces proposals) a new `kind` value + frontend proposal renderer in the same PR.
4. Description entry for the `intent_classifier`.

No other wiring. Crew runner, SSE plumbing, persistence, sessions are skill-agnostic.

#### 4.7 Flags

- **`organize` leverages existing embeddings.** Relationship discovery uses pgvector similarity via `SearchTodosTool`, then an LLM judgment pass proposes groupings. Cheaper and more robust than asking the LLM to cluster by raw text.
- **`reformat` has a locked v1 cue vocabulary:** `emphasis: 'warning'|'success'|'neutral'`, `icons: [...]`, `badges: [{text, tone}]`. Richer cues (hue shifts, animations) added only as the frontend renderer grows — prevents the skill's ambiguity from leaking into frontend complexity.

---

### Decision 5: Frontend Integration

#### 5.1 F1 keybinding

- Registered in existing `frontend/src/hooks/useKeyboardShortcuts.ts`.
- `event.preventDefault()` — some browsers hijack F1 for native help.
- Toggles panel open/closed; on open, auto-focuses the composer.
- Guards match story 3-3's `/` shortcut: suppressed if an input has focus, action popup is open, or search is active.

#### 5.2 `/help` routing

- Parser carve-out at TodoInput's entry, **before** the existing slash-command registry walk.
- `/help` bare → open panel, empty input.
- `/help <text>` → open panel, prefill composer with `<text>`, do not auto-send.
- New file `frontend/src/utils/helpCommand.ts` handles detection. TodoInput invokes it first; falls through to the existing registry if no match.

The toggle-command framework from story 3-3 remains pure (boolean toggles only). `/help` is a distinct concern — chat invocation — with its own parser branch. Pattern precedent: story 5.3's search hook got a similar one-line carve-out for `/`.

#### 5.3 Panel UX

- **Right-side drawer**, ~440px desktop, full-width mobile.
- Translucent neon-bordered surface; pond stays interactive behind at full opacity.
- **Three zones:** header (title + new-chat + sessions menu + close), message scroll area, composer.
- **Sessions UI:** hamburger in header opens in-panel sessions list overlay (not a separate sidebar). Delete-on-hover (red neon X).
- **Composer:** multi-line auto-grow (6-line cap). Enter sends; Shift+Enter newline; Esc closes panel.
- **Dismissal:** F1, Escape (composer not focused or empty), or X button. Non-destructive — state persists server-side.

#### 5.4 State

New Zustand store `useAgentStore`:

| Field | Purpose |
|---|---|
| `panelOpen` | Visibility flag |
| `activeSessionId` | Current session UUID |
| `sessions` | List of session summaries |
| `messages` | Messages for the active session |
| `inputDraft` | Composer text |
| `streamingMessageId` | ID of in-flight assistant message; null when idle |
| `streamingBuffer` | Accumulated tokens/thoughts for the streaming message |
| `proposalPreviews` | Map of `messageId → activePreview` |

Actions: `openPanel`, `closePanel`, `togglePanel`, `newSession`, `switchSession`, `sendMessage`, `deleteSession`, `setDraft`, `ingestSseEvent`, `dismissPreview`.

#### 5.5 SSE consumption

- Native `EventSource` API.
- Typed event handlers dispatch into `useAgentStore.ingestSseEvent()`.
- On `done`/`error`: close EventSource, mutate streaming message to final state, invalidate relevant React Query caches (todos list after an Apply).
- On unexpected disconnect: single-attempt fallback to `GET /api/agent/messages/{id}` for final stored state (no auto-retry SSE).

#### 5.6 Proposal rendering

One component per `kind` in `frontend/src/components/agent/proposals/`:

| kind | Component | Preview | Apply |
|---|---|---|---|
| `position_deltas` | `OrganizeProposal.tsx` | Ghost pad positions on the pond (reuses drag-preview pattern) | `PATCH /api/todos/positions` |
| `plan` | `PlanProposal.tsx` | Inline steps list + checkboxes | Per-step `POST /api/todos` |
| `text_rewrite` | `RephraseProposal.tsx` | Inline diff with per-suggestion accept | Per-accepted `PATCH /api/todos/{id}` |
| `visual_cues` | `ReformatProposal.tsx` | Hover-preview cue styling on the pad | `PATCH /api/todos/{id}` with `display_metadata` |
| *(none)* | — | Plain markdown | — |

Applied proposals freeze in the transcript (grayed Apply + "Applied ✓").

#### 5.7 Reformat cue persistence → new column on `todos`

Visual cues must persist across reloads ("help reformat content … for better rendering"). Schema change: add `todos.display_metadata JSONB NOT NULL DEFAULT '{}'`. `LilyPad.tsx` reads it at render time and interprets `emphasis` / `icons` / `badges` against neon design tokens.

Column is generic enough to carry future display concerns (custom reactions, per-todo theming) without another migration.

#### 5.8 Frontend code layout

```
frontend/src/
├── components/
│   └── agent/
│       ├── AgentPanel.tsx
│       ├── AgentMessageList.tsx
│       ├── AgentMessage.tsx
│       ├── AgentComposer.tsx
│       ├── AgentSessionsMenu.tsx
│       ├── AgentPanelHeader.tsx
│       └── proposals/
│           ├── OrganizeProposal.tsx
│           ├── PlanProposal.tsx
│           ├── RephraseProposal.tsx
│           └── ReformatProposal.tsx
├── hooks/
│   └── useAgentSse.ts
├── stores/
│   └── useAgentStore.ts
├── api/
│   └── agentApi.ts
└── utils/
    └── helpCommand.ts
```

---

### Decision 6: API & Streaming Surface

#### 6.1 Endpoint inventory

All under `/api/agent/*`, snake_case JSON payloads, sync FastAPI handlers.

| Verb | Path | Purpose | Response |
|---|---|---|---|
| `POST` | `/api/agent/chat` | Send user message, stream assistant reply | **SSE stream** |
| `GET` | `/api/agent/sessions` | List sessions | `[{id, title, updated_at, message_count}]` |
| `POST` | `/api/agent/sessions` | Create empty session | `{id, title: null, created_at}` |
| `GET` | `/api/agent/sessions/{id}` | Session + full message list | `{id, title, messages, updated_at}` |
| `PATCH` | `/api/agent/sessions/{id}` | Rename | updated session |
| `DELETE` | `/api/agent/sessions/{id}` | Hard-delete (cascades to messages) | 204 |
| `POST` | `/api/agent/sessions/{id}/cancel` | Cancel in-flight message | 202 |
| `GET` | `/api/agent/messages/{id}` | Single-message fallback for SSE drop | message row |

**Clear-current-session UX** = `DELETE` on the active session, then `POST` a new one. Two idempotent calls; no dedicated "clear" verb.

#### 6.2 `POST /api/agent/chat` — the streaming endpoint

**Request:**
```json
{
  "session_id": "<uuid>",
  "content": "<user prompt>",
  "skill": "organize" | "plan" | "rephrase" | "reformat" | "chat" | null,
  "context": { "todo_ids": ["<uuid>", ...] }
}
```

`skill: null` → `intent_classifier` picks. `context.todo_ids` is an optional pre-selection hint (e.g., right-click pad → `/help rephrase this todo`).

**Handler flow (sync, thread-based):**

1. Validate body via Pydantic.
2. DB transaction: insert user message (`status='complete'`), insert assistant placeholder (`status='pending'`), commit. Capture assistant `message_id`.
3. Build `SkillContext`, select skill (explicit or via classifier), build `Crew` via registry factory.
4. Create `queue.Queue` and `threading.Event` (cancellation). Register `{message_id → cancel_event}` in in-memory map.
5. Spawn daemon `threading.Thread` running the crew. Thread enqueues events and writes final message row at end.
6. Return `StreamingResponse` with a sync generator that pulls from the queue and yields SSE frames until `done`/`error` or client disconnect.

**SSE event types:**

| Event | Payload | When |
|---|---|---|
| `start` | `{message_id, session_id, skill}` | First event |
| `thought` | `{text}` | Optional agent reasoning trace |
| `tool_call` | `{tool, inputs_summary, started_at}` | Tool invocation begin |
| `tool_result` | `{tool, ok, duration_ms}` | Tool return |
| `chunk` | `{text}` | Prose chunk (see 6.3) |
| `proposal` | `{kind, payload, targets, reasoning}` | Structured proposal at end |
| `done` | `{message_id, final_content_hash}` | Terminal |
| `error` | `{code, message, recoverable}` | Terminal on failure |

**Client disconnect handling:** sync generator detects broken pipe at next yield, sets `cancel_event`. Crew thread checks at step boundaries and aborts. Assistant row's final state persists (`cancelled` or `complete` — whichever wins the race). Client can refetch via `GET /api/agent/messages/{id}`.

#### 6.3 Simulated streaming

**CrewAI `kickoff()` returns all-at-once; it does not stream tokens natively.** True per-token streaming would require hooking the LLM callback through CrewAI's event system. v1 does not do that.

**Instead, simulate streaming:**

- Once `kickoff()` returns, the final assistant prose is **chunked on word boundaries into groups of ~2–5 words**.
- The crew-runner thread emits one `chunk` event per group with `time.sleep(AGENT_CHUNK_DELAY_MS / 1000)` between them.
- `AGENT_CHUNK_DELAY_MS` is a tunable constant, initial value 30–80ms.
- **Total simulated-typing duration capped at ~3s.** For long responses, the delay compresses proportionally (`actual_delay = min(configured_delay, 3000ms / chunk_count)`).
- Agent step events (`thought`, `tool_call`, `tool_result`) bypass the delay loop — they emit in real time as the crew progresses.
- Chunking lives in `src/agent/crew_runner.py` as the single choke point. Skills do not pre-chunk.
- `time.sleep()` releases the GIL and is thread-safe; constitutionally compliant.

If real per-token streaming is desired later, the SSE contract does not change — only the implementation of chunk emission swaps.

#### 6.4 Cancellation

- `POST /api/agent/sessions/{id}/cancel` sets the `threading.Event` for the session's in-flight message (if any).
- Crew thread checks at step boundaries; bails at next opportunity.
- Assistant row ends with `status='cancelled'` and any partial content.
- In-memory `{message_id → cancel_event}` map; single-process v1. Multi-worker deployments would need external state (Redis, DB flag) — noted as upgrade path.

#### 6.5 Errors

Follows the existing error envelope from § API & Communication Patterns:

```json
{
  "error": "<code>",
  "message": "<user-safe message>",
  "session_id": "<uuid>",
  "message_id": "<uuid>",
  "recoverable": true|false
}
```

Codes:
- `session_not_found` (404)
- `invalid_skill` (400)
- `llm_provider_error` (502, often `recoverable=true`)
- `tool_execution_failed` (500)
- `agent_crew_failed` (500 — catch-all)
- `cancelled` (200 — row state, not an error)

Errors mid-stream are delivered as `event: error` **and** written to the message row. Pre-stream errors (validation, 404) come back as standard JSON before the stream opens.

#### 6.6 Idempotency, rate limiting, observability

- **Idempotency:** none in v1. Double-sends produce two messages; user deletes the dupe. `Idempotency-Key` header contract added later if retries become a UX concern.
- **Rate limiting:** none in v1 (single-user).
- **Observability:** message-row status only. Tool-call audit trail and per-invocation metrics are a deferred-work story.

#### 6.7 Schema delta — folded into initial migration

**Per explicit decision, Epic 6 does NOT ship an Alembic `ALTER` migration.** Instead:

1. Update SQLAlchemy models: add `ChatSession`, `ChatMessage`, add `display_metadata` to `Todo`.
2. `alembic downgrade base` (wipes everything).
3. Regenerate the initial migration (`alembic revision --autogenerate`) so v1 schema is one atomic migration file.
4. `alembic upgrade head`.

**Side-effect:** any dev DB loses its data on this cycle. Pre-production, no deployed users — acceptable. Dev stories will call this out as a pre-flight step. Precedent: story 3.3's "truncate todos if legacy seed" stance.

Resulting schema additions:
```sql
-- New tables in initial migration
chat_sessions (...)
chat_messages (...)

-- New column on existing table (also in initial migration, not as ALTER)
todos.display_metadata JSONB NOT NULL DEFAULT '{}'
```

No backwards compatibility, no evolutionary cruft, history stays a single "v1 schema" migration.

---

### Patterns & Conventions Delta

Applies only to agent-subsystem code. All base-architecture patterns (§§ Naming / Structure / Format / Communication / Process) remain in force.

| # | Pattern | Statement |
|---|---|---|
| P1 | Skill file shape | Every skill in `src/agent/skills/<skill>.py` exports `build_crew(ctx: SkillContext) -> Crew` and registers in `registry.py`. No other exports. |
| P2 | Proposal envelope is contractual | `metadata.proposal = {kind, payload, targets, reasoning}` is a frontend/backend contract. New `kind` values require matching frontend renderer in same PR. |
| P3 | Tool classes, not tool functions | Agent tools are `BaseTool` subclasses with deps injected at `__init__`. No `@tool` decorators. No module-level globals for context. |
| P4 | Tool inputs stay bounded | `ListTodosTool` default cap 100, hard cap 500. Crews needing more use `SearchTodosTool`. |
| P5 | Assistant prose is chunked, not atomic | Chunking lives in `src/agent/crew_runner.py` as a single choke point. Skills do not pre-chunk. |
| P6 | Agent never bypasses existing services | Read tools wrap `todo_service` / `search_service` / `chat_service`. No raw SQL, no direct `pool.connection()` in tool code. Missing methods are added to services, not shortcut. |
| P7 | `src/agent/` is a bounded context | Only `src/api/agent.py` imports from `src/agent/*`. `src/agent/*` imports only services from outside. Swap-out blast radius is contained. |
| P8 | F1 and `/help` converge | Both land at `useAgentStore.openPanel()`. `/help <text>` adds prefill. No parallel code paths. |
| P9 | Proposal Preview is non-destructive | Preview is client-side only (ghost meshes, in-memory overlays, diff views). Apply is the only mutation path. Enforced by code review. |
| P10 | No chat without a session | Every `POST /api/agent/chat` requires a `session_id`. Client creates a session first. No implicit/ambient chat. |
| P11 | Schema is one migration | `chat_sessions`, `chat_messages`, `todos.display_metadata` are folded into the initial Alembic migration by regeneration. No `ALTER`s in Epic 6. |

---

### Structure Delta

Additions to § Complete Project Directory Structure:

```
src/
├── agent/                                     # NEW — CrewAI agent substrate
│   ├── __init__.py
│   ├── service.py                             # AgentService: public entry; picks skill, builds crew
│   ├── crew_runner.py                         # Background thread runner, event queue, chunking
│   ├── skills/
│   │   ├── __init__.py
│   │   ├── registry.py                        # SKILL_REGISTRY, SkillSpec, SkillContext
│   │   ├── base.py                            # Shared helpers
│   │   ├── intent_classifier.py
│   │   ├── chat.py
│   │   ├── organize.py
│   │   ├── plan.py
│   │   ├── rephrase.py
│   │   └── reformat.py
│   └── tools/
│       ├── __init__.py
│       ├── base.py                            # Shared BaseTool subclass with pool injection
│       ├── list_todos.py
│       ├── get_todo.py
│       ├── search_todos.py
│       └── get_chat_history.py
├── api/
│   └── agent.py                               # NEW — FastAPI routes under /api/agent/*
├── models/
│   ├── chat_session.py                        # NEW
│   └── chat_message.py                        # NEW
├── schemas/
│   └── agent.py                               # NEW — Pydantic request/response schemas
└── services/
    └── chat_service.py                        # NEW — session & message CRUD

frontend/src/
├── components/
│   └── agent/                                 # NEW
│       ├── AgentPanel.tsx
│       ├── AgentMessageList.tsx
│       ├── AgentMessage.tsx
│       ├── AgentComposer.tsx
│       ├── AgentSessionsMenu.tsx
│       ├── AgentPanelHeader.tsx
│       └── proposals/
│           ├── OrganizeProposal.tsx
│           ├── PlanProposal.tsx
│           ├── RephraseProposal.tsx
│           └── ReformatProposal.tsx
├── hooks/
│   └── useAgentSse.ts                         # NEW
├── stores/
│   └── useAgentStore.ts                       # NEW
├── api/
│   └── agentApi.ts                            # NEW
└── utils/
    └── helpCommand.ts                         # NEW — /help parser carve-out
```

---

### Addendum Validation

#### Requirements Coverage

| Michael's requirement | Covered by |
|---|---|
| CrewAI-based chat agent following rag-csv-crew patterns | Decisions 1, 3 (with thread-safety divergence), 4 |
| Chat interface: Q&A + contextual history | Decision 5.3 (panel UX), 2.3 (20-turn context window) |
| Local database for chats + chat history | Decision 2 (schema), 6.7 (folded into initial migration) |
| `/help` slash command to invoke the agent | Decision 5.2 (parser carve-out) |
| F1 keybinding to invoke the agent | Decision 5.1 |
| Chat history recollection and inspection | Decision 6.1 (`GET /api/agent/sessions/{id}`), Decision 5.3 (sessions menu) |
| Chat history clearable | Decision 2.1 (hard delete), Decision 6.1 (`DELETE /api/agent/sessions/{id}`) |
| Crew reads todos for context | Decision 3.3 (`ListTodosTool`, `GetTodoTool`, `SearchTodosTool`) |
| DB tool using existing plumbing | Decision 3.1 + P6 (tools wrap existing services, reuse `psycopg_pool`) |
| Extensible skills | Decision 4 (registry + builder contract + one-file-per-skill) |
| Skill: organize by relationships | Decision 4.5 (2-agent organize), 4.7 (leverages pgvector embeddings) |
| Skill: draft a plan | Decision 4.5 (1-agent plan), 5.6 (plan proposal with step→todo creation) |
| Skill: rephrase content + suggest missing fields | Decision 4.5 (1-agent rephrase), 5.6 (diff view + per-suggestion accept) |
| Skill: reformat with visual cues | Decision 4.5 (1-agent reformat), 4.7 (locked v1 vocabulary), 5.7 (persistence via `todos.display_metadata`) |

All requirements traced. No gaps.

#### Constitutional Compliance (CLAUDE.md Principle VI)

| Constraint | Status |
|---|---|
| No `async`/`await`/`asyncio` anywhere | ✓ Thread-based throughout; sync FastAPI handlers; sync `StreamingResponse` generator |
| `psycopg_pool.ConnectionPool` sync driver | ✓ Reused via service-layer dependency injection into tools |
| `ThreadPoolExecutor` / `Thread` / `Event` / `Queue` for concurrency | ✓ Daemon `Thread` per chat, `queue.Queue` for SSE transport, `threading.Event` for cancellation |
| No async HTTP clients | ✓ Only LLM SDK used for CrewAI; must be sync-configured (same pattern as rag-csv-crew's `get_llm_for_crew()`) |
| FastAPI sync route handlers | ✓ All `/api/agent/*` endpoints are `def`, not `async def` |
| No async third-party libs | ✓ CrewAI's `kickoff()` is sync; no async-flavored tooling introduced |

#### Deferred-Work Items

| Item | Trigger to pull forward |
|---|---|
| Tool-call audit trail in `message.metadata.tool_calls` | First "why did the agent do that?" investigation |
| `Idempotency-Key` header on `POST /api/agent/chat` | Observed double-send UX issue |
| Rolling-summary context compaction (>20 turn chats) | Chats routinely exceed 20 turns and token budget bites |
| Per-token streaming via LLM callback hook through CrewAI event system | Simulated-streaming UX feels stale or LLM latency is low enough that word-groups don't stream naturally |
| Cross-session todo cross-link queries (junction table) | Need to query "every chat where todo X was discussed" |
| Multi-worker cancellation via external state (Redis / DB flag) | Multi-worker deployment topology |

#### Open Risks & Upgrade Paths

| Risk | Mitigation / Path |
|---|---|
| LLM provider choice not locked here | Deliberate — reuses project-level LLM config (`get_llm_for_crew()` pattern from rag-csv-crew). First implementation story picks the concrete provider. |
| CrewAI version drift (events API evolving) | Pin `crewai>=0.11.0,<0.30.0` in `pyproject.toml`. Upgrade triggered explicitly, not by range float. |
| Prompt-injection via todo text | System-prompt framing (todos are data, not instructions). Covered in Decision 3.6. Watch for escape attempts during dogfooding. |
| Legacy dev DBs lose data on migration regeneration | Explicit pre-flight step in dev stories; single-user pre-production tolerates it. |
| Agent-subsystem test complexity (crew + threads + SSE) | Three-layer testing: (1) unit-test each skill's `build_crew()` with mocked LLM; (2) integration-test `AgentService` with in-memory queue; (3) E2E test one happy path per skill through the SSE endpoint. |
| Visual-cue proliferation (reformat skill) leaking UX complexity | Locked v1 cue vocabulary (Decision 4.7). Additions gated by explicit architecture review. |

#### Architecture Readiness for Epic 6

**Status:** READY FOR EPIC/STORY CREATION

**Implementation sequence hint (not a story plan — PM owns that):**
1. Schema regeneration — models + initial migration rewrite
2. `chat_service` + session CRUD endpoints + basic tests
3. Agent substrate scaffolding: `SkillContext`, registry, `BaseTool`, tool classes, `crew_runner` with chunking
4. `chat` skill + `POST /api/agent/chat` end-to-end (simulated streaming, no proposals yet)
5. Frontend: `useAgentStore`, `AgentPanel`, `useAgentSse`, `F1` binding, `/help` parser
6. `intent_classifier` skill + frontend skill selection
7. `organize` skill + `OrganizeProposal.tsx`
8. `plan` skill + `PlanProposal.tsx`
9. `rephrase` skill + `RephraseProposal.tsx`
10. `reformat` skill + `ReformatProposal.tsx` + `LilyPad.tsx` read of `display_metadata`
11. Cancellation endpoint + frontend abort UX
12. Session rename + delete UX polish

**Hand-off:** PM runs `bmad-create-epics-and-stories` scoped to "Epic 6 — CrewAI Chat Agent" referencing this addendum as the authoritative architecture.
