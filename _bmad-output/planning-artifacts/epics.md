---
stepsCompleted: [1, 2, 3, 4]
status: 'complete'
completedAt: '2026-04-14'
inputDocuments: ['_bmad-output/planning-artifacts/prd.md', '_bmad-output/planning-artifacts/architecture.md', '_bmad-output/planning-artifacts/ux-design-specification.md']
---

# nearform-bmad-todo-app - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for nearform-bmad-todo-app, decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

- FR1: User can create a new todo by entering a text description, which materializes as a lily pad dropping into the 3D pond with ripple effects
- FR2: User can view all existing todos as lily pads floating on the pond surface
- FR3: User can mark a todo as complete by clicking its egg, which hatches into a random ecosystem creature
- FR4: User can mark a completed todo as active again by clicking the hatched egg shell, which reforms and despawns the associated creature
- FR5: User can delete a todo by clicking its sleeping aphid, which wakes and eats the lily pad over ~3 seconds with an interruptible progress bar
- FR6: User can abort a deletion by clicking the lily pad before the aphid finishes eating
- FR7: User can distinguish completed todos from active todos by egg state (whole vs. hatched shell), pad color desaturation, and water-level position
- FR8: User can assign a neon color to a todo by clicking its chameleon and selecting from a color picker
- FR12: User can drag any lily pad to reposition it. Selected pads (see FR40-new) drag together as a temporary unit; non-selected pads nearby slide out of the way.
- FR40 (new 2026-04-23): User can Shift-click or Ctrl/Cmd-click a lily pad to toggle a session-only selection. Escape clears. Persistent groups/clusters were removed per sprint-change-proposal-2026-04-23.md.
- FR13: User can search todos by typing anywhere outside a focused element — no visible search bar
- FR14: System matches search input against todos using full-text search
- FR15: System matches search input against todos using vector similarity search
- FR16: System ranks filtered results by combined full-text and vector relevance
- FR17: System updates filtered results in real-time as the user types with 300ms debounce
- FR18: Matching lily pads surface and glow while non-matching pads submerge and fade during search
- FR20: Camera auto-frames to center on search results
- FR21: User can clear search by pressing Escape, restoring all pads and resetting camera
- FR22: System generates a vector embedding for each todo's text content upon creation
- FR23: System generates embeddings asynchronously without blocking the user from interacting with the todo
- FR24: System generates a vector embedding for search input to enable similarity matching
- FR25: User sees a 3D neon pond as the primary interface — dark blue-green water surface with ripple physics and ambient neon reflections
- FR26: User sees pond ecosystem creatures (fireflies, frogs, fish, dragonflies, water striders) whose density and variety scale with todo count and completion count
- FR27: Completed todos contribute creatures to the ecosystem via egg hatching with rarity tiers (common ~50%, uncommon ~35%, rare ~12%, legendary ~3%)
- FR28: User sees a custom neon snake cursor trail replacing the system cursor
- FR29: User can orbit, zoom, and pan the camera to explore the pond spatially
- FR30: User can double-click empty water to reset camera to default position
- FR31: User can toggle between zen atmosphere (calm, muted, slow) and cyberpunk atmosphere (electric, bright, fast)
- FR32: User sees animations completing within 300-500ms with easing transitions when todos are added, completed, or deleted
- FR33: A trash/archive lizard wanders the pond edge, consuming deleted and auto-archived todos
- FR34: User can click the lizard to open a neon-styled list of consumed todos (deleted and archived)
- FR35: User can recover a consumed todo from the lizard's belly, which spits out a new lily pad into the pond
- FR36: System auto-archives todos older than a configurable threshold by drifting them toward the lizard with visual aging (browning edges, wilt)
- FR37: User sees an inviting empty pond with subtle water movement, ambient glow, and a hint when no todos exist
- FR38: User sees a loading state with staggered lily pad materialization on initial pond load
- FR39: User sees error states through biological decay on affected pads (bite marks, wilt, texture degradation) and ecosystem creature reactions (scatter, flee)
- FR40: System returns to a functional state without page refresh after an error occurs — decay marks heal on recovery
- FR41: System persists all todos in a relational database across browser sessions
- FR42: System preserves todo state (text, completion status, color, position, timestamps) across page refreshes
- FR43: System stores vector embeddings alongside todo records in a vector-capable database
- FR44: System provides ambient audio (water, crickets, frog croaks) scaling with ecosystem density — implemented as the last feature
- FR45: System provides interaction audio (splash on add, chime on complete, crunch on delete) — implemented as the last feature
- FR46: User can toggle sound on/off via an in-theme control — sound starts muted by default
- FR47: Developer can start the full application stack locally using a single command
- FR48: Developer can run linting, type checking, and formatting via CLI commands
- FR49: System runs automated CI checks on every push and pull request

### NonFunctional Requirements

- NFR1: 3D pond scene renders at 60fps on modern desktop hardware with 30+ lily pads and active ecosystem
- NFR2: Page loads to interactive state in under 2 seconds on standard connections
- NFR3: Todo CRUD operations provide visual feedback in under 200ms
- NFR4: Filter-as-you-type returns updated results within 300ms of typing pause
- NFR5: Animations maintain 60fps with no dropped frames during user interactions as measured by browser performance profiling
- NFR6: Concurrent embedding generation does not increase UI interaction latency beyond 50ms above baseline
- NFR7: Application maintains full functionality across browser refresh, tab close, and session restart
- NFR8: No data loss under any normal usage scenario
- NFR9: Application handles rapid sequential user actions (fast adds, deletes, toggles) without errors or race conditions
- NFR10: Application remains functional when Google API is temporarily unavailable — CRUD operations are unaffected, search degrades to full-text only
- NFR11: Error states are recoverable without page refresh
- NFR12: Embedding API failures are handled with timeout and retry without blocking operations
- NFR13: Embedding failures do not block todo creation — todos are saved immediately, embeddings generated when possible
- NFR14: Embedding API key is stored server-side only, never exposed to frontend assets
- NFR15: Backend API validates and sanitizes all input from the frontend

### Additional Requirements

**From Architecture — Starter/Infrastructure:**
- AR1: Backend uses existing Nearform Python template + FastAPI with uv, ruff, mypy, pytest, pre-commit hooks
- AR2: Frontend initialized with Vite + React + TypeScript template
- AR3: Three.js + React Three Fiber + @react-three/postprocessing + @react-three/drei
- AR4: TanStack React Query for server state, Zustand for client state
- AR5: docker-compose with pgvector/pgvector:pg17 image for local PostgreSQL
- AR6: Normalized database schema: todos, creatures tables (groups/group_memberships removed 2026-04-23)
- AR7: Alembic for database migrations with auto-generation from SQLAlchemy models
- AR8: Axios client with snake_case ↔ camelCase interceptor for API boundary
- AR9: Makefile with `make dev` command starting docker-compose + uvicorn + vite dev
- AR10: Creature rarity system with resident tier for trash lizard (todo_id NULL)
- AR11: Batch position update endpoint (PATCH /api/todos/positions) debounced 2s after drag + beforeunload save
- AR12: Creature API endpoint (POST /api/creatures) for resident creature creation during tutorial
- AR13: Future-proofed auth: route handlers accept dependency-injectable current_user defaulting to None

### UX Design Requirements

- UX-DR1: Custom neon snake cursor ported from rag-csv-crew CursorSnake component — canvas-based hexagon chain with spring animation, replacing system cursor entirely
- UX-DR2: 3D pond water surface with ripple physics shader, dark blue-green tint (rgba 0,20,40,0.8), ambient neon reflections
- UX-DR3: Lily pad 3D instanced meshes with CSS2DRenderer HTML text overlay, hover-to-focus expansion, progressive density scaling to minimap-line rendering
- UX-DR4: Completion egg on each lily pad — whole/pulsing (active), crack/hatch animation with random creature spawn per rarity tier, hatched shell (completed), click shell to reform and despawn creature
- UX-DR5: Delete aphid — sleeping with floating Z's, click to wake, eating animation with progress bar (~3s), click pad to abort, burp on completion, fragments drift to lizard
- UX-DR6: Color chameleon — click to open neon color picker ring, chameleon previews hovered color in real-time, click to select, Escape to cancel
- UX-DR7: Trash lizard — wandering resident creature at pond edge, belly size scales with consumed todo count, click to open neon-styled recovery list with NeonScrollbar, comedic regurgitate animation on restore
- UX-DR8: Ecosystem manager — spawns ambient creatures (scaling with todo count) + tracks hatched creatures (1:1 with completed todos), randomized autonomous movement, emergent micro-events (frog catches firefly, fish leap), LOD scaling with zoom
- UX-DR9 — RETIRED (2026-04-23). Persistent cluster visuals (halo, label, drag handle) removed per sprint-change-proposal-2026-04-23.md. Selection-based temporary grouping in Story 4.7 uses only the white selection rim.
- UX-DR10: Interactive camera — OrbitControls with zoom/pan/orbit, angle constraints (no underwater), auto-frame on search results, double-click to reset, smooth damping, zen mode idle drift
- UX-DR11: Type-anywhere search — global keyboard capture outside focused elements, search text on water surface in monospace retro, debounced 300ms, Escape clears and resets camera
- UX-DR12: Atmosphere controller — zen mode (glow 0.6, slow, muted, gentle) vs cyberpunk mode (glow 1.4, fast, saturated, active), keyboard shortcut or in-pond toggle
- UX-DR13: First-run tutorial — hatch starter egg to spawn resident trash lizard, guided steps (first todo, first complete, search hint), Escape to skip, lizard existence in creatures table = tutorial complete flag
- UX-DR14: Progressive density — lily pads shrink as count grows: full text → small text → very small → rendered colored lines (Monaco minimap style)
- UX-DR15: Neon design tokens — CSS custom properties ported from rag-csv-crew: --neon-pink #ff10f0, --neon-cyan #00eeff, --neon-orange #ff6600, --neon-green #39ff14, --neon-gold #ffd700, environment colors for water/depth/reflection
- UX-DR16: Dual typography — retro-futuristic monospace for UI labels/titles/search, clean sans-serif for todo text on lily pads
- UX-DR17: Biological decay error states — bite marks and wilt on affected pads, ecosystem creatures scatter/flee, auto-retry in background, decay heals on recovery
- UX-DR18: Casino-inspired randomized celebrations — ~20% of todo completions trigger bonus animations (extra fireflies, particle bursts, fish jump, frog croak), variable intensity per action
- UX-DR19: Sound design (last feature) — ambient audio (water, crickets, frogs) scaling with ecosystem, interaction sounds (splash, chime, crunch), spatial audio, start muted, firefly icon toggle
- UX-DR20: Small viewport fallback — if window < 800x500, display neon-styled message "designed for desktop"

### FR Coverage Map

> Refreshed 2026-04-16 to match the current PRD (FR1-FR46 after simplification). The prior map referenced FR1-FR49 from the pre-simplification PRD.

| FR | Epic | Description |
|---|---|---|
| FR1-FR8 | Epic 2 | Todo CRUD via in-scene Action Popup (create, view, popup primitive, actions, dismiss, complete, delete, soft-state persistence) |
| FR9-FR13 | Epic 4 | Color assignment, grouping/clustering, drag reposition (all via popup or drag) |
| FR14-FR22 | Epic 5 | Type-anywhere hybrid search (full-text + vector, surface/submerge, camera auto-frame) |
| FR23-FR25 | Epic 5 | Embedding generation pipeline (async via Google API) |
| FR26 | Epic 1 | 3D neon pond surface |
| FR27, FR28 | Epic 7 | Ecosystem creatures + rarity tiers on popup Complete |
| FR29 | Epic 1 | Custom neon snake cursor |
| FR30-FR32 | Epic 3 | Camera controls + atmosphere toggle |
| FR33 | Epic 2 | Animation timings (300-500ms) |
| FR34 | Epic 1 | Empty pond state |
| FR35-FR37 | Epic 2 | Loading + error states + error recovery |
| FR38, FR39 | Epic 2 | Data persistence (incl. soft-state flags) |
| FR40 | Epic 5 | Vector embedding storage |
| FR41-FR43 | Epic 8 | Sound design (ambient + interaction audio, toggle) |
| FR44-FR46 | Epic 1 | Dev infrastructure (local startup, lint/typecheck CLI, CI) |

## Epic List

### Epic 1: The Living Pond
User can open the app and see an immersive 3D neon pond with a custom cursor trail — the foundation is alive and inviting even with no todos.
**FRs:** FR26, FR29, FR34, FR44, FR45, FR46
**ARs:** AR1-AR9
**UX-DRs:** UX-DR1, UX-DR2, UX-DR15, UX-DR16, UX-DR20

### Epic 2: Todo Life on the Pond
User can create, view, complete, and delete todos as lily pads floating on the pond — completion and deletion resolve through an in-scene neon wireframe action popup and a unified dissolve visual (green flash for complete, red for delete). Stories renumbered 2026-04-16 so the Action Popup primitive (2.3) precedes the Complete (2.4) and Delete (2.5) stories that depend on it.
**FRs:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR33, FR35, FR36, FR37, FR38, FR39
**UX-DRs:** UX-DR3, UX-DR14, UX-DR17 (UX-DR4, UX-DR5 removed; new "Action Popup" pattern added to UX spec)

### Epic 3: Exploring the Pond
User can orbit, zoom, and pan the camera to explore the pond spatially, and toggle between zen and cyberpunk atmospheres.
**FRs:** FR30, FR31, FR32
**UX-DRs:** UX-DR10, UX-DR12

### Epic 4: Organizing the Pond
User can assign neon colors to todos and group lily pads into labeled clusters, creating a personal visual organization system. Color assignment and group/ungroup are actions on the Epic 2 popup; the chameleon creature is removed.
**FRs:** FR9, FR10, FR11, FR12, FR13
**ARs:** AR11
**UX-DRs:** UX-DR9 (UX-DR6 removed; color flow folded into popup pattern in UX spec)

### Epic 5: Intelligent Search
User can find any todo by typing anywhere — the pond reorganizes itself, surfacing matches and submerging the rest with semantic understanding.
**FRs:** FR14-FR25, FR40
**UX-DRs:** UX-DR11

### Epic 7: The Living Ecosystem
The pond teems with life — creatures scale with user activity, popup Complete actions spawn random creatures with rarity tiers, and casino-inspired surprises keep the experience delightful.
**FRs:** FR27, FR28
**UX-DRs:** UX-DR8, UX-DR18

### Epic 8: The Soundscape
The pond has an ambient soundscape that breathes with the ecosystem, and every interaction has audio feedback — the final layer of immersion. Last feature implemented.
**FRs:** FR41, FR42, FR43
**UX-DRs:** UX-DR19

## Epic 1: The Living Pond

User can open the app and see an immersive 3D neon pond with a custom cursor trail — the foundation is alive and inviting even with no todos.

### Story 1.1: Project Scaffolding & Infrastructure

As a developer,
I want to initialize the full-stack project with backend, frontend, database, and CI/CD,
So that all subsequent stories have a working development environment.

**Acceptance Criteria:**

**Given** a fresh clone of the repository
**When** I run `make dev`
**Then** docker-compose starts PostgreSQL 17 with pgvector, FastAPI starts with hot reload on port 8000, and Vite dev server starts on port 5173
**And** the database has all tables created via Alembic migration (todos, groups, group_memberships, creatures)
**And** `.env.example` exists with all required variables documented
**And** GitHub Actions CI runs ruff, mypy, pytest on backend and tsc, vitest, build on frontend

### Story 1.2: 3D Pond Scene with Water Surface

As a user,
I want to see a dark blue-green 3D water surface filling my entire browser viewport,
So that I experience an immersive neon pond environment from the moment the app loads.

**Acceptance Criteria:**

**Given** the app is loaded in Chrome
**When** the page finishes loading
**Then** a full-viewport Three.js canvas renders a dark blue-green water surface with subtle ripple physics and ambient neon reflections
**And** Bloom postprocessing creates neon glow effects on the water
**And** the water has continuous subtle movement even when idle
**And** no browser chrome, scrollbars, or native UI elements are visible
**And** the scene renders at 60fps on modern desktop hardware

### Story 1.3: Custom Neon Snake Cursor

As a user,
I want to see a neon snake cursor trail following my mouse instead of the default system cursor,
So that every mouse movement feels immersive and part of the pond aesthetic.

**Acceptance Criteria:**

**Given** the app is loaded
**When** I move my mouse anywhere in the viewport
**Then** the system cursor is hidden and replaced by a neon hexagon chain cursor with spring animation (ported from rag-csv-crew CursorSnake)
**And** the cursor trail follows the mouse with smooth lerp animation and multi-color neon glow
**And** the cursor renders on a separate canvas overlay above the 3D scene

### Story 1.4: Empty Pond State & Design System

As a user,
I want the empty pond to feel inviting with subtle ambient movement and a visual hint to start typing,
So that I know the pond is alive and discover how to add my first thought.

**Acceptance Criteria:**

**Given** no todos exist in the database
**When** the pond loads
**Then** the water surface has subtle ambient movement and glow
**And** faint rippling text appears on the water surface: "just start typing..."
**And** neon CSS custom properties are applied (--neon-pink, --neon-cyan, --neon-orange, --neon-green, --neon-gold)
**And** retro-futuristic monospace font is used for UI text and clean sans-serif for content text
**And** if the window is smaller than 800x500, a neon-styled message "This experience is designed for desktop" is displayed

## Epic 2: Todo Life on the Pond

User can create, view, complete, and delete todos as lily pads floating on the pond — every action has a creature-based interaction and visual response.

### Story 2.1: Backend Todo CRUD API

As a developer,
I want a complete REST API for todo CRUD operations with proper validation and persistence,
So that the frontend can create, read, update, and delete todos reliably.

**Acceptance Criteria:**

**Given** the FastAPI backend is running
**When** I call `POST /api/todos` with `{"text": "Review Q2 roadmap"}`
**Then** a new todo is created with UUID, default color #00eeff, null position, embedding_status 'pending', and timestamps
**And** `GET /api/todos` returns all active todos (not deleted, not archived) with positions, colors, completion status, and creature info
**And** `PATCH /api/todos/{id}` updates completion status, color, or position
**And** `DELETE /api/todos/{id}` soft-deletes the todo (sets deleted=true, deleted_at=now)
**And** all responses use snake_case JSON fields
**And** all inputs are validated via Pydantic schemas
**And** invalid requests return consistent error format `{"error": "...", "message": "...", "detail": null}`

### Story 2.2: Lily Pad Creation — The Drop

As a user,
I want to type a todo and watch it materialize as a lily pad that drops into the pond with a ripple,
So that adding a thought feels like depositing something alive into the water.

**Acceptance Criteria:**

**Given** the pond is loaded (empty or with existing pads)
**When** I press a keyboard shortcut (N or /) and type a todo description and press Enter
**Then** a neon-styled input field appears, and after submission it dissolves
**And** a lily pad forms above the water surface, glowing with default neon cyan
**And** the pad drops into the water with physics-based animation (300-500ms)
**And** neon ripples radiate outward from the impact point
**And** nearby existing pads bob gently in response
**And** the pad drifts to a resting position among other pads
**And** pressing Escape during input cancels without creating a todo
**And** the todo is persisted to the backend via optimistic update (pad appears before server confirms)

### Story 2.3: In-Scene Neon Wireframe Action Popup

> **Renumbered on 2026-04-16** to satisfy build-order sequencing: this primitive must land before the popup-dependent Complete (2.4) and Delete (2.5) stories. The prior Story 2.3 (Completion Egg — Hatch to Complete) is superseded; see `2-3-completion-egg-hatch-to-complete.superseded.md` for history.

As a user,
I want to click a lily pad and see the camera focus on it with a neon wireframe action popup rendered in the 3D scene beside it,
So that every pad interaction (complete, delete, set color, group) flows through one consistent primitive.

**Acceptance Criteria:**

**Given** an active lily pad on the pond
**When** I click the pad
**Then** the camera smoothly glides to frame the pad (300-500ms eased)
**And** a neon wireframe popup materializes in the 3D scene anchored to the pad's upper-right in camera space, auto-repositioned to stay within the viewport
**And** the popup renders action buttons as neon wireframe elements: Complete, Delete, Set Color
**And** the popup is rendered with the neon aesthetic (wireframe geometry, glow via Bloom, monospace retro labels)

**Given** the popup is open
**When** I click outside the pad's hit area OR press Escape
**Then** the popup dismisses with a brief materialize-out animation
**And** the camera returns to its prior position (300-500ms eased)

**Given** the todo count is high and pads are at progressive density (>10 pads, shrunken/minimap state)
**When** I click a pad
**Then** the camera focuses enlarges the pad to readable size before the popup appears
**And** the popup is sized for legibility regardless of pad density state

**Technical notes:**
- New component: `ActionPopup.tsx` (+ `PopupActionButton.tsx`, `PopupColorSwatch.tsx` — the latter used by 4.1)
- Camera focus state managed by existing `PondCamera.tsx` / camera store
- Only one popup open at a time; clicking a different pad closes the prior popup before opening the new one
- Progressive density logic (formerly scoped under the old "Todo State Visualization" story) folded here: pads still shrink as count grows, hover/focus still expands to full readable size

### Story 2.4: Completion via Popup — Green Flash + Dissolve

> **Supersedes** the prior "Completion Egg — Hatch to Complete" story (marked done on 2026-04-15, code now obsolete). This story replaces the egg-hatch mechanic entirely; its implementation work includes removing `CompletionEgg.tsx`, the hatched-shell state, and the uncomplete path. Depends on Story 2.3 (Action Popup primitive).

As a user,
I want to click Complete on a focused pad's popup and watch the pad flash green and dissolve as a creature emerges into the ecosystem,
So that completing a task feels rewarding without relying on a fragile egg-hatch animation.

**Acceptance Criteria:**

**Given** an active todo's popup is open (see Story 2.3)
**When** I click the Complete action
**Then** the pad pulses green for ~200ms
**And** a creature emerges from the pad during the flash — creature type selected by rarity tier (common ~50%, uncommon ~35%, rare ~12%, legendary ~3%) and joins the ecosystem
**And** the pad dissolves into the water surface over 600-900ms with a fade and subtle ripple
**And** the popup closes and the camera returns to its prior position
**And** the backend is updated via `PATCH /api/todos/{id}` with `completed=true, completed_at=NOW()` and a creature record is created (todo_id, creature_type, rarity)
**And** the completed todo no longer renders in the pond and is excluded from search results

**Technical notes:**
- Remove `CompletionEgg.tsx`, hatched shell state, and uncomplete code paths as part of this story
- Rarity selection logic moves from `useCreatureHatch.ts` into a `usePopupComplete.ts` handler (or equivalent)
- No "completed pad" visual state is needed — the record is hidden post-dissolve

### Story 2.5: Deletion via Popup — Red Flash + Dissolve

> **Replaces** the prior backlog story "Delete Aphid — Interruptible Eating." The aphid creature, interruptible eating mechanic, and abort-click are all removed; deletion is now immediate on click. Depends on Story 2.3 (Action Popup primitive).

As a user,
I want to click Delete on a focused pad's popup and watch the pad flash red and dissolve,
So that deletion uses the same unified visual language as completion without an additional creature control.

**Acceptance Criteria:**

**Given** an active todo's popup is open (see Story 2.3)
**When** I click the Delete action
**Then** the pad pulses red for ~200ms
**And** the pad dissolves into the water surface over 600-900ms with a fade and subtle ripple (no creature emerges)
**And** the popup closes and the camera returns to its prior position
**And** the backend is updated via `DELETE /api/todos/{id}` which soft-deletes the record (`deleted=true, deleted_at=NOW()`)
**And** the deleted todo no longer renders in the pond and is excluded from search results

**Technical notes:**
- Remove `DeleteAphid.tsx` (and any aphid-related code paths) as part of this story — the component never shipped in a done story but exists as a scaffold
- No confirmation dialog; the popup-as-gate provides sufficient intent
- Pad fragments no longer drift toward a trash lizard — the lizard was removed with Epic 6 deletion

### Story 2.6: Loading & Error States

As a user,
I want the pond to load gracefully and show errors through the pond's own visual language,
So that I never see generic spinners or error dialogs.

**Acceptance Criteria:**

**Given** the app is loading with existing todos
**When** the initial data fetch is in progress
**Then** lily pads materialize one by one in a staggered sequence (not all at once)

**Given** a backend operation fails (e.g., todo creation, update)
**When** the error occurs
**Then** the affected lily pad shows biological decay (bite marks, texture degradation, wilt)
**And** the system auto-retries in the background
**And** when the error resolves, decay marks heal and the pad restores to normal
**And** I can continue interacting with other pads during the error — the pond is never blocked

## Epic 3: Exploring the Pond

User can orbit, zoom, and pan the camera to explore the pond spatially, and toggle between zen and cyberpunk atmospheres.

### Story 3.1: Interactive Camera Controls

As a user,
I want to orbit, zoom, and pan the camera to explore the pond from different angles,
So that I can navigate my pond spatially and see it from any perspective.

**Acceptance Criteria:**

**Given** the pond is loaded
**When** I scroll the mouse wheel
**Then** the camera zooms in/out smoothly with eased damping
**And** zoom has min/max limits (can't zoom infinitely in or out)

**When** I click-drag on empty water
**Then** the camera pans across the pond surface

**When** I right-click drag or modifier+drag
**Then** the camera orbits the pond angle
**And** orbit is constrained (can't go underwater — angle limited)

**When** I double-click empty water
**Then** the camera smoothly resets to default position and angle (300-500ms eased transition)

**And** all camera transitions have smooth damping
**And** the camera auto-adjusts on window resize to maintain framing

### Story 3.2: Atmosphere Mode Toggle

As a user,
I want to toggle between zen and cyberpunk atmospheres,
So that I can control the mood of my entire pond environment.

**Acceptance Criteria:**

**Given** the pond is in default (cyberpunk) mode
**When** I activate the atmosphere toggle (keyboard shortcut or in-pond control)
**Then** the entire environment transitions to zen mode: glow intensity reduces to 0.6, ripples slow, colors mute, animations gentle, camera damping increases
**And** the transition is smooth (not instant — 500ms crossfade)

**Given** the pond is in zen mode
**When** I toggle atmosphere again
**Then** the environment transitions to cyberpunk mode: glow intensity increases to 1.4, ripples quicken, colors saturate, animations energize, camera response snappens

**And** atmosphere mode persists in Zustand store and affects all visual components globally

## Epic 4: Organizing the Pond

User can assign neon colors to todos and group lily pads into labeled clusters, creating a personal visual organization system.

### Story 4.1: Popup Color Swatch — Neon Selector

> **Replaces** the prior "Color Chameleon & Neon Picker" story. The chameleon creature is removed; color assignment is now a sub-panel within the Action Popup (see Story 2.5).

As a user,
I want to click Set Color on a pad's popup and pick a neon color from an inline swatch ring,
So that I can visually organize my todos without a separate creature interaction.

**Acceptance Criteria:**

**Given** a lily pad's Action Popup is open (Story 2.5)
**When** I click the Set Color action
**Then** the popup expands a sub-panel showing a ring of neon swatches (pink #ff10f0, cyan #00eeff, orange #ff6600, green #39ff14, gold #ffd700)
**And** hovering a swatch previews the color on the pad's glow in real-time
**And** clicking a swatch commits the color — pad glow updates, sub-panel collapses, subtle ripple emanates from the pad
**And** pressing Escape OR clicking Set Color again collapses the sub-panel without changing the color
**And** the selected color is persisted via `PATCH /api/todos/{id}` with the new color value

**Technical notes:**
- Remove `ColorChameleon.tsx` and the ring-of-sprites `ColorPicker.tsx` as part of this story
- New component: `PopupColorSwatch.tsx` — sub-component of `ActionPopup.tsx`
- Swatches render as neon wireframe elements consistent with the popup aesthetic

### Story 4.2 — SUPERSEDED (2026-04-23)

The original "Lily Pad Clustering & Groups" story (persistent groups,
halos, labels, drag handles, pop-in/pop-out) was removed per
`sprint-change-proposal-2026-04-23.md`. The replacement is Story 4.7
(Selection-Drag & Repel) — shift/ctrl-click produces a session-only
temporary group that drags together; non-selected pads slide out of
the way. See the superseded story file at
`implementation-artifacts/4-6-lily-pad-clustering-and-groups.superseded.md`
for the archived original scope.

### Story 4.3: Position Persistence

As a user,
I want my lily pad positions to persist across sessions,
So that my pond looks the same when I return.

**Acceptance Criteria:**

**Given** I have repositioned pads by dragging them
**When** I stop dragging and 2 seconds pass
**Then** all changed positions are batch-saved via `PATCH /api/todos/positions`
**And** the positions are debounced (not saved per frame during drag)

**Given** I close the browser tab
**When** the beforeunload event fires
**Then** any unsaved position changes are flushed to the backend

**Given** I reopen the app later
**When** the pond loads
**Then** all pads appear at their previously saved positions

## Epic 5: Intelligent Search

User can find any todo by typing anywhere — the pond reorganizes itself, surfacing matches and submerging the rest with semantic understanding.

### Story 5.1: Backend Embedding Pipeline

As a system,
I want to generate vector embeddings for each todo asynchronously via Google API,
So that semantic search can find todos by concept, not just keywords.

**Acceptance Criteria:**

**Given** a new todo is created via `POST /api/todos`
**When** the todo is saved to the database with embedding_status='pending'
**Then** a background task is triggered to generate an embedding via Google API
**And** on success: the embedding vector is stored in the todos table, embedding_status set to 'complete'
**And** on failure: embedding_status set to 'failed', auto-retry with exponential backoff (3 attempts max)
**And** embedding generation never blocks the API response — the todo is returned immediately
**And** the Google API key is read from server-side environment variable only

### Story 5.2: Hybrid Search API

As a developer,
I want a search endpoint that combines full-text and vector similarity results,
So that the frontend can show semantically relevant results for any query.

**Acceptance Criteria:**

**Given** the backend has todos with completed embeddings
**When** I call `GET /api/search?q=architecture review`
**Then** the backend generates an embedding for the query text via Google API
**And** runs PostgreSQL full-text search (fast)
**And** runs pgvector cosine similarity search
**And** combines scores with weighted ranking
**And** returns `{"results": [{"todo": {...}, "score": 0.87}], "query": "..."}`
**And** todos without embeddings are still included via full-text match only (graceful degradation)

**Given** the Google API is temporarily unavailable
**When** a search is performed
**Then** the endpoint falls back to full-text search only (no vector component)
**And** returns results with a note that vector search is unavailable

### Story 5.3: Type-Anywhere Search with Surface/Submerge

As a user,
I want to start typing anywhere to search — the pond reorganizes itself, surfacing matches and submerging the rest,
So that finding todos feels like speaking to the pond and watching it respond.

**Acceptance Criteria:**

**Given** I am not focused on any input or element
**When** I start typing
**Then** search text appears on the water surface in monospace retro font
**And** after 300ms debounce, the search API is called

**When** results return
**Then** matching lily pads rise and glow at full intensity
**And** non-matching pads sink below the surface and fade to translucent
**And** the camera smoothly auto-frames to center on the matching pads

**When** I press Escape
**Then** search text dissolves from the water surface
**And** all pads restore to their resting positions with smooth animation
**And** water surface smooths out
**And** camera returns to default position

**And** Backspace edits the search text
**And** full-text results appear first (fast), vector results refine ranking progressively

## Epic 7: The Living Ecosystem

The pond teems with life — creatures scale with user activity, completions hatch random creatures with rarity tiers, and casino-inspired surprises keep the experience delightful.

### Story 7.1: Ecosystem Manager & Ambient Creatures

As a user,
I want my pond to teem with ambient wildlife that scales with how many todos I have,
So that the pond feels alive and my activity visibly enriches the environment.

**Acceptance Criteria:**

**Given** the pond has todos
**When** the ecosystem manager evaluates density
**Then** ambient creatures spawn based on todo count: 0-3 sparse (single firefly), 5-10 awakening (few fireflies, frog appears), 15-25 thriving (multiple types), 30+ lush (swarms, schooling fish)

**And** creatures have randomized autonomous movement patterns
**And** creatures react to user actions (scatter on pad drop, flee from error decay)
**And** creatures simplify at far zoom (LOD) and detail at close zoom
**And** ecosystem state persists across page loads (based on todo + creature counts from DB)

### Story 7.2: Creature Rarity & Casino Celebrations

> Rarity logic retained from the prior version but triggered by the popup Complete action (Story 2.3) rather than an egg hatch. The "resident" tier (trash lizard) is removed along with Epic 6.

As a user,
I want popup completions to produce creatures of varying rarity with occasional spectacular events,
So that every completion has an element of surprise and discovery.

**Acceptance Criteria:**

**Given** a user clicks Complete on a pad's popup (Story 2.3)
**When** the creature type is randomly selected
**Then** the rarity distribution is: common ~50% (firefly, water strider), uncommon ~35% (frog, dragonfly, butterfly), rare ~12% (fish, turtle), legendary ~3% (golden koi, neon phoenix, glowing jellyfish)

**And** common emergences have a standard creature-emerges-from-pad animation during the pad's green flash
**And** uncommon emergences have a slightly more elaborate animation
**And** rare emergences trigger a brief celebration (particle burst, secondary ripple on adjacent pads)
**And** legendary emergences trigger a major visual event (cascade of neon particles, water surge, ecosystem creatures react)

**And** ~20% of all completions (regardless of rarity) trigger a bonus ambient animation (extra fireflies, fish jump, frog croak)
**And** the randomness creates "did you see that?" moments — no two sessions feel identical

**Technical notes:**
- Rarity roll logic moves from `useCreatureHatch.ts` (to be removed with Story 2.3) into `usePopupComplete.ts` or an equivalent handler invoked by the popup Complete action
- Remove "resident" rarity tier code paths and creature-type filters; rarity enum in the creatures table becomes common/uncommon/rare/legendary only

## Epic 8: The Soundscape

The pond has an ambient soundscape that breathes with the ecosystem, and every interaction has audio feedback — the final layer of immersion. Last feature implemented.

### Story 8.1: Ambient Audio & Interaction Sounds

As a user,
I want the pond to have an ambient soundscape with interaction feedback,
So that the immersion is complete with audio that breathes with the ecosystem.

**Acceptance Criteria:**

**Given** the app is loaded
**When** I first visit
**Then** sound starts muted by default
**And** a subtle in-theme control (firefly icon) is available to toggle sound on

**Given** sound is enabled
**When** the pond is idle
**Then** ambient water sounds loop continuously (volume scales with water activity)
**And** cricket chirps play (density scales with todo count)
**And** frog croaks play at random intervals (frequency scales with ecosystem state)

**When** I create a todo (pad drops)
**Then** a water splash sound plays with slight synthetic reverb

**When** I complete a todo (egg hatches)
**Then** a tonal chime plays (occasionally enhanced for rare/legendary hatches)

**When** I delete a todo (aphid eats)
**Then** crunching sounds play during eating, satisfied burp on completion

**When** search results shift
**Then** soft water movement sounds pan with the results

**And** all sounds are slightly synthetic/processed to match the neon aesthetic
**And** sounds are positionally spaced where possible (spatial audio relative to action location)
**And** the mute toggle persists across sessions
