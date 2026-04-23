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
