---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain-skipped', 'step-06-innovation-skipped', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete', 'step-e-01-discovery', 'step-e-02-review', 'step-e-03-edit']
lastEdited: '2026-04-23'
editHistory:
  - date: '2026-04-14'
    changes: 'Added search user journey (Journey 4), updated requirements table, fixed subjective FR language, removed implementation leakage from FRs/NFRs, fixed NFR metrics'
  - date: '2026-04-14'
    changes: 'Major reconciliation with UX spec: desktop-only (removed mobile), 3D pond interface, creature-based controls (egg/aphid/chameleon/lizard), grouping/clustering, trash/archive, atmosphere modes, interactive camera, type-anywhere search, ecosystem, sound design. FRs expanded from 31 to 49.'
  - date: '2026-04-16'
    changes: 'Simplified interaction model: removed egg-hatch completion, aphid-eat deletion, chameleon color picker, and trash/archive lizard with recovery. Replaced with neon wireframe action popup rendered in-scene on pad focus. Unified dissolve-and-fade visual for both complete (green flash + creature spawn) and delete (red flash). Both are soft state transitions — records persist in DB with completed=true or deleted=true, but no longer render in the pond or appear in search. FRs 49 → 46.'
  - date: '2026-04-16'
    changes: 'Post-validation polish: specified popup anchor position in FR3 (upper-right in camera space, viewport-bounded), dropped "fast" descriptor from Reliability NFR.'
  - date: '2026-04-23'
    changes: 'Removed persistent groups/clusters entirely (FR10, FR11, FR12, FR20) per sprint-change-proposal-2026-04-23. Revised FR13 (drag works with selection as a temporary group). Added FR40 (shift/ctrl-click selection). FR39 updated to drop "group membership" from persisted state. Story 4.6 superseded, Story 5.6 retired, Story 4.7 added to backlog.'
inputDocuments: []
workflowType: 'prd'
documentCounts:
  briefs: 0
  research: 0
  brainstorming: 0
  projectDocs: 0
classification:
  projectType: 'Web Application (full-stack)'
  domain: 'General / Productivity'
  complexity: 'Low-Medium'
  projectContext: 'Greenfield'
---

# Product Requirements Document - nearform-bmad-todo-app

**Author:** Michael
**Date:** 2026-04-14

## Executive Summary

A full-stack Todo application built as a Nearform demo and BMad method learning project. The product delivers core task management — create, view, complete, and delete todos — through an immersive 3D neon pond interface where todos exist as luminescent lily pads floating on a dark water surface. Clicking a pad brings the camera into focus on it and materializes a neon wireframe action popup in-scene, offering Complete, Delete, Set Color, and Group actions. Both completion and deletion resolve through a unified visual — a green or red flash followed by the pad slowly dissolving into the water — with completed pads contributing a creature to the living ecosystem. The todo domain is deliberately minimal; the application's purpose is to showcase modern full-stack craft and serve as a reference implementation, not to solve a novel productivity problem. Target users are developers and stakeholders evaluating the tech stack, design quality, and development methodology.

The backend exposes a small CRUD API built on Python 3.13+ with a focus on clean separation, data consistency, and an architecture that does not preclude future authentication or multi-user capabilities. The frontend is a desktop-only (Chrome) Three.js 3D scene with interactive camera (orbit, zoom, pan), type-anywhere search that causes matching pads to surface while non-matches submerge, and a living ecosystem of neon creatures whose density scales with user activity. Success is measured by visual impact, interaction quality, session stability, and zero-guidance usability.

### What Makes This Special

The differentiator is experience quality over feature quantity. Inspired by the rag-csv-crew application's visual identity, this todo app treats a simple domain as a canvas for premium UX — neon glow, slick transitions, 3D elements — turning a commodity feature set into something users enjoy interacting with rather than merely use. The deliberately constrained scope (no auth, no collaboration, no prioritization in v1) frees all effort toward polish and craft. The result should feel like a finished product, not a prototype.

## Project Classification

- **Project Type:** Web Application (full-stack)
- **Domain:** General / Productivity
- **Complexity:** Low-Medium — simple domain, but production UX quality bar, extensible architecture, and multi-tier stack (frontend + API + database + CI/CD)
- **Project Context:** Greenfield

## Success Criteria

### User Success

- A viewer opening the app for the first time reacts with genuine amazement at the visual quality — neon glow, 3D graphics, and fluid animations create an immediate "wow" moment
- Any user can create, view, complete, and delete todos without instruction or hesitation
- The experience feels polished and complete — no rough edges, broken states, or visual glitches
- The 3D pond interface is visually stunning on desktop screens and projected displays

### Business Success

- The application is demo-ready for internal Nearform showcases, including presentations to upper management and company-wide audiences
- The BMad method workflow is completed end-to-end, serving as a validated reference for the methodology
- The project demonstrates modern full-stack craft — a tangible artifact that represents Nearform engineering quality

### Technical Success

- Zero functional defects in core CRUD operations — create, view, complete, and delete todos work flawlessly every session
- Data persists reliably across page refreshes and browser sessions
- All interactions feel instant under normal conditions — no perceptible lag on actions
- The application handles empty, loading, and error states gracefully without disrupting the visual experience
- The architecture cleanly separates frontend and backend, leaving a path open for future auth and multi-user extension

### Measurable Outcomes

- 100% of core actions (add, complete, delete) work without failure in Chrome
- Page load to interactive in under 2 seconds on standard connections
- Zero data loss across browser refresh, tab close, and session restart
- Internal demo audiences rate the visual experience as impressive or exceptional

## User Journeys

### Journey 1: The Amazed Nearformer — First Encounter

**Persona:** Liam, a mid-level Nearform engineer. He's seen dozens of internal demo apps — most look like Bootstrap templates with a database behind them. He clicks a link shared in Slack during an all-hands.

**Opening Scene:** Liam opens the link expecting another standard CRUD demo. The page loads and immediately he notices something different — a dark interface pulses with neon light, 3D elements float with subtle depth, and the whole thing feels alive. He pauses. This isn't what he expected.

**Rising Action:** He types "Review Q2 roadmap" and hits enter. A lily pad forms above the water and drops in with a neon ripple. He adds a few more — "Update team wiki," "Prep sprint demo." Each pad settles among the others, the ecosystem stirs — a firefly appears. He clicks a pad. The camera glides in to frame it and a neon wireframe popup materializes in the scene alongside, floating above the water with Complete, Delete, and Set Color actions. He clicks Complete — the pad pulses green, a dragonfly emerges in a burst of light and joins the ecosystem, and the pad slowly dissolves into the water. He moves his mouse and a neon snake cursor trail follows.

**Climax:** Liam clicks a todo he doesn't need, opens the popup, and clicks Delete. The pad pulses red and dissolves into the water. He refreshes the page — everything is still there, the pond exactly as he left it. He tries to break it: rapid adds, quick deletes, quick completes. It handles everything smoothly. He zooms out to see the whole pond, then zooms into a single pad. He thinks: "This is actually really well built."

**Resolution:** Liam shares the link in the engineering channel with "have you seen this?" He's not impressed by what it does — it's a todo app. He's impressed by *how* it does it. The craft is obvious.

**Reveals:** Instant visual impact, 3D pond immersion, in-scene wireframe popup interactions, unified dissolve visuals, creature spawning from completions, camera controls, data persistence, graceful handling of rapid interactions, shareability.

### Journey 2: The Demo Presenter — High-Stakes Showcase

**Persona:** Michael, the developer who built the app. He's presenting it to upper management and the wider Nearform team during a company-wide demo session. The screen is projected. Everyone is watching.

**Opening Scene:** Michael opens the app on the projected screen. The neon glow fills the room's display. He has a clean slate — no existing todos — and the empty state is designed for this moment: an inviting visual that says "add something" without looking broken or bare.

**Rising Action:** Michael narrates as he adds todos live: "Let me show you the core flow." He adds three tasks — each lily pad drops into the pond with a ripple. He clicks one — the camera focuses and a neon wireframe popup materializes beside it. He selects Set Color and picks electric cyan; the pad's glow shifts. He does the same on another pad in magenta. He clicks Complete on a third — green flash, a firefly bursts out of the pad, joins the ecosystem, the pad dissolves. He groups two todos into a cluster through the popup's Group action.

**Climax:** Michael types a search query. The pond reorganizes — matching pads surface while others submerge with neon ripple effects. The camera auto-frames the results. He toggles the atmosphere from zen to cyberpunk — the entire environment transforms. He zooms out to show the full pond overview, then zooms into a single pad. The room reacts.

**Resolution:** The demo lands. Management sees an immersive, living product — not a prototype. The conversation shifts from "nice demo" to "what else can we build with this approach?" Michael has demonstrated both the tech and the methodology.

**Reveals:** Empty state design, live demo reliability, in-scene wireframe popup, color assignment, completion creature burst, grouping, atmosphere toggle, camera controls, search spectacle, data consistency across sessions, presenter confidence through flawless UX.

### Journey 3: The Future Developer — Extending the Foundation

**Persona:** Ava, a Nearform engineer assigned to add user authentication to the app six months after launch. She's never seen the codebase before.

**Opening Scene:** Ava clones the repo and reads the README. She runs the setup commands — `uv sync`, activate venv — and the app starts locally without issues. She opens it in her browser and immediately sees what she's working with.

**Rising Action:** She explores the codebase. The backend API is cleanly separated — routes, models, and data access are distinct. She can see where auth middleware would slot in. The frontend calls a well-defined API — she won't need to untangle spaghetti to add auth headers. The CI pipeline runs linting, type checking, and tests on her first commit.

**Climax:** Ava adds a basic auth layer. Because the architecture was designed with separation in mind, she doesn't need to rewrite existing code — she adds middleware to the API and a login screen to the frontend. The existing todo functionality continues to work unchanged.

**Resolution:** Ava ships the auth feature in a clean PR. She tells her team: "Whoever built this made my job easy." The extensible architecture paid off.

**Reveals:** Clean developer onboarding, architectural separation of concerns, API contract clarity, CI/CD pipeline value, extensibility without rewrites.

### Journey 4: The Search Explorer — Finding What Matters

**Persona:** Priya, a senior Nearform engineer who's been using the todo app daily for three weeks. She has 30+ todos accumulated — project tasks, meeting notes, ideas she jotted down quickly.

**Opening Scene:** Priya needs to find a todo she added last week about reviewing a colleague's architecture proposal. She can't remember the exact wording — was it "review architecture" or "check Winston's design doc"? She looks at the dense pond of overlapping lily pads and just starts typing.

**Rising Action:** She types "architecture review" — the text appears on the water surface. The pond transforms: two lily pads rise and glow while the rest submerge and fade. "Review Winston's system design doc" and "Check architecture patterns for auth module." The camera auto-frames the results. The vector search understood her intent even though neither todo contains the exact phrase "architecture review." She didn't need to remember her exact words.

**Climax:** Priya clears the search and tries something more abstract: "stuff about meetings." Three todos appear — "Prep for Monday standup," "Book room for sprint retro," and "Send agenda for planning session." None contain the word "meetings," but the semantic search connected the concept. She thinks: "This is smarter than a basic filter."

**Resolution:** Priya starts treating the search as a thinking tool, not just a lookup. She adds todos quickly with rough phrasing, knowing she can always find them later by concept rather than keyword. The search changes how she uses the app — it's not just task management, it's a personal knowledge surface.

**Reveals:** Filter-as-you-type responsiveness, hybrid full-text + vector search, semantic matching beyond exact keywords, search as a differentiating demo feature, real-time result ranking.

### Journey Requirements Summary

| Capability | Revealed By |
|---|---|
| 3D neon pond as primary interface | Journey 1, 2 |
| Lily pad todos with in-scene wireframe action popup | Journey 1, 2 |
| Completion with green flash, creature spawn, and pad dissolve | Journey 1, 2 |
| Deletion with red flash and pad dissolve | Journey 1 |
| Color assignment via popup action | Journey 2 |
| Interactive camera (orbit, zoom, pan) with auto-focus on pad click | Journey 1, 2 |
| Custom neon snake cursor trail | Journey 1 |
| Pond ecosystem scaling with activity | Journey 1, 2 |
| Lily pad clustering/grouping | Journey 2 |
| Atmosphere modes (zen/cyberpunk) | Journey 2 |
| Data persistence across refreshes and sessions | Journey 1, 2 |
| Graceful handling of rapid user interactions | Journey 1 |
| Polished empty pond state | Journey 2 |
| Type-anywhere search (no visible search bar) | Journey 4 |
| Full-text search matching | Journey 4 |
| Vector similarity search (semantic matching) | Journey 4 |
| Hybrid search ranking by relevance | Journey 4 |
| LLM-generated embeddings for todo text | Journey 4 |
| Search causes pads to surface/submerge with camera auto-framing | Journey 4 |
| Clean API separation (routes, models, data access) | Journey 3 |
| Extensible architecture for future auth | Journey 3 |
| CI/CD pipeline with linting, type checking | Journey 3 |
| Quick local dev setup via uv | Journey 3 |

## Web Application Specific Requirements

### Project-Type Overview

Single Page Application built with React, Three.js, and Vite. The frontend delivers a neon-glow 3D visual experience with fluid animations and instant interactions. The backend is a Python 3.13+ API serving a PostgreSQL database with pgvector extension for hybrid full-text and vector search. The full stack runs locally via docker-compose.

### Technical Architecture Considerations

**Frontend Stack:**
- React SPA bundled with Vite
- Three.js for 3D graphics and visual effects
- SPA routing (no server-side rendering — SEO not required)
- Target browser: Chrome (primary and only required target)

**Backend Stack:**
- Python 3.13+ API server
- PostgreSQL 17 with pgvector extension
- docker-compose for local database orchestration
- LLM API integration for generating todo text embeddings

**Data Flow:**
- Standard request/response — no real-time, WebSocket, or SSE requirements
- Single-user, no authentication in v1
- Todos persisted in PostgreSQL with both text content and vector embeddings
- Embeddings generated via LLM API on todo creation

### Hybrid Search Architecture

**Full-Text + Vector Search:**
- PostgreSQL full-text search for exact and partial keyword matching
- pgvector for semantic similarity search using LLM-generated embeddings
- Hybrid ranking combining both signals for relevance ordering

**Type-Anywhere Search UX:**
- No visible search bar — typing anywhere outside a focused element initiates search
- Search text appears on the water surface in monospace retro font
- Matching lily pads surface and glow; non-matching pads submerge and fade
- Clusters surface as units with matching members highlighted, non-matching siblings faded
- Camera auto-frames to center on search results
- Escape clears search, restores all pads, resets camera
- Debounced API calls (300ms) to avoid excessive backend requests during typing

### Platform

- Desktop only — no mobile, no tablet, no touch
- Chrome only — single browser target
- Full-viewport 3D scene — no scrolling, no margins, no chrome

### Implementation Considerations

- No accessibility requirements for v1
- No SEO requirements (internal demo, SPA)
- No real-time sync requirements
- Embedding generation adds latency to todo creation — consider async generation or optimistic UI updates
- Vector search query requires embedding the search input text — factor into filter-as-you-type latency budget

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Experience MVP — the minimum feature set that delivers the "wow" demo moment. Every MVP feature must either contribute to visual impact or demonstrate technical sophistication. The two pillars are the neon-glow 3D interface and the intelligent hybrid search.

**Resource Requirements:** Single developer (Michael), Google API key for embeddings, docker-compose for local PostgreSQL/pgvector.

### MVP Feature Set (Phase 1)

**Core User Journeys Supported:**
- Journey 1 (The Amazed Nearformer) — full visual impact and interaction quality
- Journey 2 (The Demo Presenter) — flawless live demo reliability

**Must-Have Capabilities:**
- 3D neon pond interface with floating lily pad todos
- Click pad to focus camera and materialize neon wireframe action popup in-scene
- Popup actions: Complete, Delete, Set Color, Group/Ungroup
- Completion: green flash → creature emerges (rarity tier) → pad dissolves
- Deletion: red flash → pad dissolves
- Soft state persistence — completed and deleted records retained, excluded from pond and search
- Custom neon snake cursor trail (ported from rag-csv-crew)
- Interactive camera with orbit, zoom, pan
- Type-anywhere search with pad surface/submerge animations
- Pond ecosystem creatures scaling with todo count and completions
- Lily pad grouping/clustering with shared glow aura
- Persistent storage in PostgreSQL 17 with pgvector
- LLM-generated embeddings (Google API) on todo creation
- Hybrid full-text + vector search
- Polished empty pond, loading, and error states (biological decay metaphor)
- Configurable atmosphere modes (zen/cyberpunk)
- docker-compose setup for local development
- CI/CD pipeline via GitHub Actions
- Desktop only, Chrome only

### Post-MVP Features

**Phase 2 (Growth):**
- User authentication and personal accounts
- Dark/light theme variants within the neon aesthetic
- Task filtering and sorting (by date, status)
- Keyboard shortcuts for power users
- Animation and micro-interaction polish pass
- Extended browser support (Firefox, Safari, Edge)

**Phase 3 (Expansion):**
- Multi-user support and collaboration
- Task prioritization, deadlines, and notifications
- Real-time sync across devices
- Reference architecture template for Nearform projects
- Accessibility compliance pass

### Risk Mitigation Strategy

**Technical Risks:**
- *Embedding latency on todo creation:* Mitigate with optimistic UI updates — show the todo immediately, generate embeddings async. Search results degrade gracefully for todos not yet embedded.
- *Filter-as-you-type latency:* Debounce input (300ms), combine full-text results (fast) with vector results (slower) progressively. Full-text provides instant feedback while vector results refine ranking.
- *Three.js performance at density:* 30+ lily pads with ecosystem creatures, Bloom postprocessing, and ripple physics must maintain 60fps. Mitigate with instanced rendering, LOD scaling, frustum culling, and Bloom resolution reduction if frame rate drops below 50fps.

**Resource Risks:**
- *Single developer:* Scope is deliberately minimal. The BMad method provides structured workflow to avoid scope drift. If time is tight, search polish (ranking tuning) can ship iteratively after core search works.
- *Google API dependency:* Low-volume usage makes rate limits and cost irrelevant. If API is unavailable, fall back to full-text search only — vector search enhances but isn't the sole search mechanism.

## Functional Requirements

### Task Management

- FR1: User can create a new todo by entering a text description, which materializes as a lily pad dropping into the 3D pond with ripple effects
- FR2: User can view all active todos as lily pads floating on the pond surface — todos with completed=true or deleted=true do not render
- FR3: User can click a lily pad to bring the camera into focus on it and materialize a neon wireframe action popup in-scene, anchored to the pad's upper-right in camera space and auto-repositioned to stay within the viewport
- FR4: Popup presents action buttons as neon wireframe elements: Complete, Delete, Set Color, Group/Ungroup
- FR5: User can dismiss the popup by clicking outside the pad or pressing Escape, returning the camera to its prior position
- FR6: User can mark a todo as complete via the popup Complete action, which flashes the pad green, spawns a creature that emerges from the pad into the ecosystem, then dissolves the pad into the water over 600-900ms
- FR7: User can delete a todo via the popup Delete action, which flashes the pad red then dissolves the pad into the water over 600-900ms
- FR8: System persists completed and deleted todos with state flags (completed=true or deleted=true) — records are retained for ecosystem creature counts and are excluded from the default pond view and search results

### Task Organization

- FR9: User can assign a neon color to a todo via the popup Set Color action, which presents a neon color swatch selector inline in the wireframe popup
- FR13: User can drag any lily pad to reposition it. If one or more pads are currently selected (see FR40), dragging any selected pad translates every selected pad together and non-selected pads nearby slide out of the way.
- FR40: User can Shift-click or Ctrl/Cmd-click a lily pad to toggle its inclusion in a session-only selection set; selected pads display a white pulsing outer rim. Pressing Escape (with no popup or search active) clears the selection. Selection is never persisted.

### Task Discovery

- FR14: User can search active todos by typing anywhere outside a focused element — no visible search bar; completed and deleted todos are excluded from results
- FR15: System matches search input against todos using full-text search
- FR16: System matches search input against todos using vector similarity search
- FR17: System ranks filtered results by combined full-text and vector relevance
- FR18: System updates filtered results in real-time as the user types with 300ms debounce
- FR19: Matching lily pads surface and glow while non-matching pads submerge and fade during search
- FR21: Camera auto-frames to center on search results
- FR22: User can clear search by pressing Escape, restoring all pads and resetting camera

### Embedding Generation

- FR23: System generates a vector embedding for each todo's text content upon creation
- FR24: System generates embeddings asynchronously without blocking the user from interacting with the todo
- FR25: System generates a vector embedding for search input to enable similarity matching

### Pond Environment

- FR26: User sees a 3D neon pond as the primary interface — dark blue-green water surface with ripple physics and ambient neon reflections
- FR27: User sees pond ecosystem creatures (fireflies, frogs, fish, dragonflies, water striders) whose density and variety scale with cumulative todo count and completion count
- FR28: Completed todos contribute a creature to the ecosystem on completion, selected by rarity tier (common ~50%, uncommon ~35%, rare ~12%, legendary ~3%) — the creature emerges from the pad during the green-flash beat before the pad dissolves
- FR29: User sees a custom neon snake cursor trail replacing the system cursor
- FR30: User can orbit, zoom, and pan the camera to explore the pond spatially
- FR31: User can double-click empty water to reset camera to default position
- FR32: User can toggle between zen atmosphere (calm, muted, slow) and cyberpunk atmosphere (electric, bright, fast)
- FR33: User sees animations completing within 300-500ms with easing transitions when todos are added, completed, or deleted

### Application States

- FR34: User sees an inviting empty pond with subtle water movement, ambient glow, and a hint ("just start typing...") when no active todos exist
- FR35: User sees a loading state with staggered lily pad materialization on initial pond load
- FR36: User sees error states through biological decay on affected pads (bite marks, wilt, texture degradation)
- FR37: System returns to a functional state without page refresh after an error occurs — decay marks heal on recovery

### Data Persistence

- FR38: System persists all todos in a relational database across browser sessions, including records marked completed=true or deleted=true
- FR39: System preserves todo state (text, completion flag, deletion flag, color, position, timestamps) across page refreshes
- FR40: System stores vector embeddings alongside todo records in a vector-capable database

### Sound Design

- FR41: System provides ambient audio (water, crickets, frog croaks) scaling with ecosystem density — implemented as the last feature
- FR42: System provides interaction audio (splash on add, chime on complete, soft pad-dissolve on delete) — implemented as the last feature
- FR43: User can toggle sound on/off via an in-theme control — sound starts muted by default

### Development Infrastructure

- FR44: Developer can start the full application stack locally using a single command
- FR45: Developer can run linting, type checking, and formatting via CLI commands
- FR46: System runs automated CI checks on every push and pull request

## Non-Functional Requirements

### Performance

- 3D pond scene renders at 60fps on modern desktop hardware with 30+ lily pads and active ecosystem
- Page loads to interactive state in under 2 seconds on standard connections
- Todo CRUD operations provide visual feedback in under 200ms
- Filter-as-you-type returns updated results within 300ms of typing pause
- Animations maintain 60fps with no dropped frames during user interactions as measured by browser performance profiling
- Concurrent embedding generation does not increase UI interaction latency beyond 50ms above baseline

### Reliability

- Application maintains full functionality across browser refresh, tab close, and session restart
- No data loss under any normal usage scenario
- Application handles rapid sequential user actions (adds, deletes, completions) without errors or race conditions
- Application remains functional when Google API is temporarily unavailable — CRUD operations are unaffected, search degrades to full-text only
- Error states are recoverable without page refresh

### Integration

- Embedding API failures are handled with timeout and retry without blocking operations
- Embedding failures do not block todo creation — todos are saved immediately, embeddings generated when possible
- API key is stored server-side only — never exposed to the frontend client

### Security

- Embedding API key is stored server-side only, never exposed to frontend assets
- Backend API validates and sanitizes all input from the frontend
- No sensitive user data is collected or stored
