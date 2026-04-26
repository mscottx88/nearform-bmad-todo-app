# Story 6.7: The Oracle Frog

Status: in-progress

> **Scope note:** Final story of Epic 6 ("The Intelligent Pond Companion").
> Frontend-only — no schema, API, or backend agent changes. Builds the
> 3D Oracle Frog mesh, his dedicated lily pad, the boundary-return
> teleport animation, the procedural-animation/expression state machine,
> and swaps Story 6.2's `AgentPanelOraclePlaceholder` for a real `<View>`
> secondary camera that frames the frog inside the chat panel. Adds
> `agentState` to `useAgentStore` (driven by the SSE event types Story
> 6.2 already plumbs through `ingestSseEvent`).
>
> **Aquarium-window metaphor:** the frog lives in the SAME Three.js
> scene as the rest of the pond. The chat-panel view is a drei `<View>`
> looking at the same world through a second camera — NOT a second
> `<Canvas>` and NOT a duplicated scene graph. One WebGL context, one
> set of meshes, two camera viewports.

---

## ⚠️ CRITICAL CONSTITUTIONAL CONSTRAINT

**Async/await is PROHIBITED in backend code** — see [CLAUDE.md](CLAUDE.md)
§ "CONCURRENCY MODEL — THREAD-BASED ONLY". This story is frontend-only;
no backend code changes. JavaScript/TypeScript in `frontend/` uses
async normally (the constitutional ban is Python-only).

---

## Story

As a user,
I want a neon frog living in the pond on his own lily pad, and to see him come alive with expressions in the chat panel that mirror the agent's state,
So that the AI agent has a physical, magical presence — not a faceless chatbox.

---

## Acceptance Criteria

### AC 1 — Oracle Frog mesh on his dedicated oracle lily pad

**Given** the app is loaded
**When** `<PondScene>` renders

**Then** the **Oracle Frog** appears on a **dedicated oracle lily pad**
that is rendered in the scene alongside the user's todo pads.

**Pad rendering:**
- The oracle pad is a `LilyPad`-shaped mesh, but with **`type: 'oracle'`**
  discriminant — it is NOT a `Todo` and is NOT returned by
  `GET /api/todos`.
- It is mounted by a new component
  [OracleFrogManager.tsx](frontend/src/components/agent/OracleFrogManager.tsx)
  which renders `<OracleLilyPad>` (the pad mesh) and `<OracleFrog>` (the
  frog mesh on top) — a small frontend-only component pair, NOT a fork
  of `LilyPad.tsx`. Reuse the lily-pad geometry/material via a small
  shared module (see Dev Notes § "Shared lily-pad geometry") if extraction
  is straightforward; otherwise duplicate the geometry — DO NOT widen
  `LilyPad`'s prop API to take an arbitrary `Todo | OraclePad` discriminator.
- The oracle pad does **not** render: the completion egg, aphid, chameleon,
  ActionPopup, InfoPopup, halo color-lerps, ripples-on-click, drag handlers,
  or any CRUD popup. It is a passive resident.
- The oracle pad ignores `usePondStore` selection / hover / drag state —
  it does NOT emit `setHoveredTodoId` / `setActivePopupTodoId` / etc.
- Search and the visibility-filter slash-commands (Story 3.3) ignore the
  oracle pad — it is always visible regardless of `showCompleted` /
  `showDeleted` / search results / "submerge non-matching" state.

**Frog body material (semi-transparent neon glass):**
- `MeshPhysicalMaterial` with:
  - `color = '#00eeff'` (`--neon-cyan`) — fall back to the same hex literal
    used elsewhere; CSS variables are not readable inside Three.js material
    constructors
  - `emissive = '#00eeff'` and `emissiveIntensity = 0.6` — the body glows
    from within (state machine in AC 4 modulates this)
  - `transmission = 0.3` (translucent glass-like body)
  - `opacity = 0.55`, `transparent = true`
  - `roughness = 0.15`, `metalness = 0.0`
  - `ior = 1.4` (matches water-glass refractive feel)
- Body geometry: a low-poly frog silhouette — ellipsoid body + back legs
  + front legs + head — assembled from primitive `<sphereGeometry>` /
  `<capsuleGeometry>` / `<boxGeometry>` instances grouped under a
  single `<group>` so the whole frog can sway/lean as one. NO external
  GLB/GLTF asset — generate procedurally.
- Two small eye spheres (`<sphereGeometry>` ~0.04 radius) with
  `MeshBasicMaterial` `color = '#39ff14'` (`--neon-green`) so they read as
  illuminated spots. Eye open/closed/wide is animated by scaling the eye
  group's Y axis in AC 4 — no eyelid mesh.

**Frog silhouette wireframe (Catmull-Rom + TubeGeometry):**
- The frog's neon outline must read as a **smooth flowing curve**, NOT as
  the triangulated mesh edges of the body geometry. Build it by:
  1. Defining ~12-20 control points around the frog silhouette (top
     of head → cheek → side → hip → tail → back leg curve → return).
  2. Feeding them into `THREE.CatmullRomCurve3(points, /*closed*/ true)`.
  3. Wrapping that curve in `THREE.TubeGeometry(curve, /* tubularSegments */ 64, /* radius */ 0.012, /* radialSegments */ 6, /* closed */ true)`.
  4. Rendering with `MeshBasicMaterial { color: '#00eeff', transparent: true, opacity: 0.95 }` so it picks up Bloom from `<EffectComposer>`.
- The outline mesh is a sibling of the body mesh inside the frog's
  `<group>`, so they sway together.
- Cheap perf — these are static geometries created once via `useMemo`,
  then transformed each frame by mutating the parent `<group>`'s
  `position` / `rotation` / `scale` (NOT by re-creating the buffer).

**Pad scale + frog fill ratio:**
- Oracle pad uses the same diameter as a regular lily pad (whatever
  `LilyPad.tsx`'s `PAD_RADIUS` resolves to today; do not hardcode a
  different number — read from the same constant or pass-through prop).
- The frog mesh's bounding box fills **~85% of the pad's diameter** (a
  little smaller than the pad so the pad's neon rim still reads around
  him). Achieve this by setting the frog group's uniform scale once at
  mount based on the actual pad radius (`scale = 0.85 * PAD_RADIUS / FROG_BASE_RADIUS`),
  not by trial-and-error magic numbers in JSX.

### AC 2 — Oracle pad position: fixed home, persisted, frontend-only

**Given** the app is loaded for the first time on a fresh client (no
persisted state)

**Then** the oracle pad is placed at a **fixed anchor position** in
world space — `(x = -3.5, y = 0, z = 3.5)` — chosen so it sits clearly
visible in the default camera frame but doesn't overlap the typical
todo-cluster center `(0, 0, 0)`.

**And** the position is **persisted in `useAgentStore`** under a new
field `oraclePadPosition: { x: number; z: number }` (NOT in
`useWorldStore` — that store is for backend-tracked todo positions, and
the oracle pad is frontend-only resident state, see § Dev Notes "Why
useAgentStore not useWorldStore"). Add `oraclePadPosition` to the
`persist` middleware's `partialize` so the position survives reload.

**And** the position is **immutable from the user's perspective** —
there is no UI affordance to drag / move / reset the oracle pad. The
home position is the home position.

**And** `OracleFrogManager.tsx` initialises the position on first mount
via:
```ts
useEffect(() => {
  const store = useAgentStore.getState();
  if (store.oraclePadPosition === null) {
    store.setOraclePadPosition({ x: -3.5, z: 3.5 });
  }
}, []);
```
First-mount-idempotent — never overwrites a persisted value.

**And** the oracle pad does NOT participate in:
- `PATCH /api/todos/positions` (it's not a todo; never sent to the backend)
- `useWorldStore.hydrateFromTodos` (no entry created)
- The cascade-displacement/spread-out logic in `LilyPad.tsx` (oracle pad
  is NOT in `usePondStore.displacedPads` map and is NOT a `LilyPad` instance,
  so the existing logic naturally ignores it)

### AC 3 — Boundary-return dissolve animation (drift-back-home)

**Given** the Oracle Frog exists on the pond

**When** the oracle pad's currently-rendered position drifts beyond a
**configurable boundary radius** from its home position

**Then** the pad runs a **"dissolve → teleport → rematerialize"** animation
back to its home position.

**Why this exists:** the user can drag and spread-out their todo pads in
front of the oracle pad, occasionally pushing it out of the way visually
even though there is no cascade-displacement targeting it. The boundary
return is a soft self-correcting affordance — if a stray ripple or
wave-motion ever shoves the oracle pad far from home, it recovers itself.
In v1 this is mostly defensive: the oracle pad has no explicit drift
applied to it, so the boundary should rarely trip. The animation must
exist so the safety net is visible the moment it's ever needed.

**Configurable constants** (module-scope in `OracleFrogManager.tsx`):
- `ORACLE_BOUNDARY_RADIUS = 1.0` (world units from home — pad must
  literally drift this far before the animation triggers; with no drift
  source today, this is purely defensive)
- `ORACLE_RETURN_DURATION_MS = 1500` (total animation duration — split
  500ms dissolve, 100ms teleport gap, 900ms rematerialize)

**Animation sequence (driven by `useFrame`, single state machine inside
the oracle pad/frog component, NOT a global Zustand state):**
1. **Dissolve** (`0 → 500ms`): pad + frog opacity fades from 1.0 to 0.0.
   Particle burst emitted from pad center — reuse the `triggerRipple`
   pattern conceptually but use small neon-cyan particles spawned via a
   one-shot `<Points>` instance with a 500ms lifetime (no need to plumb
   into the existing creature-emerge system).
2. **Teleport** (`500 → 600ms`): pad/frog hidden (`visible = false`).
   Position is set to the home `(x, z)`. No render output during this
   window; this is the teleport.
3. **Rematerialize** (`600 → 1500ms`): opacity fades from 0.0 to 1.0.
   On re-appearance, fire a single ripple via
   `usePondStore.getState().triggerRipple(home.x, home.z)` so the water
   reacts to the frog's return.

**Dev note:** the boundary-return state machine is a `useRef`-tracked
local phase (`'idle' | 'dissolving' | 'teleporting' | 'rematerializing'`)
plus a `useState` to force re-render when phase changes. Same pattern as
`LilyPad.tsx`'s existing `dropPhase` machine — see [LilyPad.tsx:79-90](frontend/src/components/pond/LilyPad.tsx#L79-L90)
for precedent.

**`prefers-reduced-motion` honoured** (per the project-wide a11y norm
that Story 4.4 will formalise — apply it now since this is a brand-new
animation): if `window.matchMedia('(prefers-reduced-motion: reduce)').matches`
is true, the boundary-return is **instant** (snap pad position back, no
dissolve/particle/ripple).

### AC 4 — Procedural animation + expression state machine

**Given** the agent transitions between states (driven by SSE events
from Story 6.2's plumbing)

**When** `useAgentStore.agentState` changes

**Then** the Oracle Frog's procedural animation and emissive intensity
update to match.

**Add `agentState` to `useAgentStore`:**
- New field `agentState: 'idle' | 'listening' | 'thinking' | 'speaking' | 'success' | 'error'`
- New action `setAgentState(state: AgentState['agentState']): void` — pure
  setter; persistence excluded (do NOT add to `partialize`).
- **State transitions are wired in `ingestSseEvent`** (the existing SSE
  reducer in `useAgentStore`). Modify the existing branches:
  - On `start` event → `setAgentState('thinking')`
  - On `chunk` event → if currently `'thinking'`, transition to `'speaking'`;
    `chunk` while already `'speaking'` → no transition (state stays
    `'speaking'`)
  - On `done` event → `setAgentState('success')`, then after 1200ms
    automatically transition back to `'idle'` via `window.setTimeout`.
    Track the timer in module-scope (like `activeStreamHandle`) so back-to-back
    sends cancel the pending `'success' → 'idle'` timer and the new turn's
    `'thinking'` wins.
  - On `error` event → `setAgentState('error')`, then after 2000ms
    transition back to `'idle'` (same timer-cancellation pattern as `done`)
- **`'listening'` is wired to composer focus + non-empty content** —
  in `AgentComposer.tsx`, add an effect that calls `setAgentState('listening')`
  when the textarea has focus AND `inputDraft.length > 0`, and reverts
  to `'idle'` on blur or when the draft becomes empty. **Do NOT
  transition to `'listening'` while a stream is in flight** —
  `streamingMessageId !== null` short-circuits the listening branch so
  the user typing while the agent is still speaking doesn't confuse the
  state machine.
- Default initial state: `'idle'`.

**Animation per state — driven inside `<OracleFrog>` via `useFrame`:**

| State | Body animation | Eye animation | Emissive intensity |
|---|---|---|---|
| `idle` | Gentle Y-axis sway, period ~3s, amplitude ±0.04 world units | Eyes half-closed (`scale.y = 0.4`); blink (full close `→ 0.05` for ~120ms) every ~4-6s on a per-mount random offset | 0.4 |
| `listening` | Body leans forward (rotation.x ≈ +0.15 rad), subtle head tilt toward user (rotation.z ≈ ±0.05 oscillating slowly) | Eyes wide (`scale.y = 1.2`) | 0.55 |
| `thinking` | Body upright; eyes track left → right, period ~1.5s | Eyes track horizontally — modulate eye **mesh position.x** within ±0.02 around its rest offset (eye sphere translation, NOT body rotation, to avoid the whole frog turning). Optional: occasional bubble particle rises above head (small upward-drifting `<Points>` every 2-4s, lifespan 1.2s, reusing the dissolve-burst particle util) | 0.7 |
| `speaking` | Throat sac (a small `<sphereGeometry>` under the chin) inflates/deflates per `chunk` event arrival — each `ingestSseEvent` chunk pushes a transient scale-pulse onto a small queue inside `<OracleFrog>` so the throat reads as "still puffing the last word" even between chunks | Eyes half-closed/normal | 0.85 |
| `success` | One brief upward hop (Y-translation ~0.15 then back), 500ms ease-out | Eyes crinkle upward (`scale.y` briefly inflated to 0.8 then back) | Briefly 1.2 (flash), 200ms decay back to 0.4 |
| `error` | Body contracts (uniform scale `→ 0.92` for 600ms then back to 1.0), slow downward droop on rotation.x for the same duration | Eyes half-closed | Briefly 0.85 with **emissive color shifted toward red-orange `'#ff6600'`** (still using the same material — mutate `material.emissive.set('#ff6600')`, then revert to cyan after 1500ms) |

**`prefers-reduced-motion` honoured**: when reduce-motion is set, the
state machine still runs (state changes still tint emissive intensity)
but **all body/eye motion is suppressed** — frog stays in his rest pose,
sub-state animations skip. The pulse on `chunk` and the hop on `success`
also skip; the only visible cue is the emissive intensity ramp.

**Cleanup:** all `setTimeout` handles registered in `useAgentStore` for
the `'success' → 'idle'` and `'error' → 'idle'` transitions must be
cleared in `cancelStreaming` and `switchSession` (mirror the
`abortActiveStream()` pattern at [useAgentStore.ts:107-115](frontend/src/stores/useAgentStore.ts#L107-L115)),
and on store unmount (impossible in practice — no Hot Reload teardown
hook needed). Otherwise a cancelled stream that already emitted `success`
would still fire the delayed `→ idle` transition and clobber a fresh
turn's `'thinking'`.

### AC 5 — `<View>` secondary camera in the AgentPanel (aquarium window)

**Given** the agent panel is open

**When** the panel mounts

**Then** the existing `AgentPanelOraclePlaceholder.tsx` is **replaced**
with a real **drei `<View>`** that renders a live picture of the Oracle
Frog and his lily pad through a secondary camera, **sharing the same
WebGL context** as the main `<Canvas>` in `PondScene.tsx`.

**Implementation via drei `<View>`:**
- Create a new component
  [AgentPanelOracleView.tsx](frontend/src/components/agent/AgentPanelOracleView.tsx)
  that **renames + replaces** `AgentPanelOraclePlaceholder.tsx`. The
  placeholder file is deleted at the end of this story; references to
  `AgentPanelOraclePlaceholder` in `AgentPanel.tsx` and tests are
  rewritten to `AgentPanelOracleView`.
- The new component renders a DOM container (`<div className="agent-panel__oracle">`)
  that holds drei's `<View track={ref}>`. The track ref is the DOM `<div>`
  itself; drei reads its `getBoundingClientRect()` each frame to render
  the secondary camera into that screen rectangle.
- Inside the `<View>`, render: an oracle-pad-targeting camera + a
  `<group>` containing the same oracle-frog/oracle-pad meshes that are
  in the main scene. **Do NOT clone the meshes** — drei's `<View>` shares
  the parent scene by default; just expose a top-level `<Canvas>` with
  drei's `<Preload>` / `<Views>` orchestrator (see drei docs `View` /
  pattern). Read [drei's View docs](https://drei.docs.pmnd.rs/portals/view)
  for the correct import path (`@react-three/drei` v10.x).
- The shared `<Canvas>` lives in [App.tsx](frontend/src/App.tsx) — top-level,
  parent of both `<PondScene>` and the `<AgentPanel>`. **DO NOT** move the
  pond canvas inside the panel; instead expose `<Views>` as a sibling
  rendering surface that drei multiplexes within the same WebGL context.
  See Dev Notes § "drei `<View>` setup" for the exact wiring.

**Camera framing:**
- The secondary camera's position + lookAt are computed from the oracle
  pad's home position so the frog occupies the centre of the panel
  view. With ~15% buffer around the frog, this works out to roughly
  `position = home + (0, 0.6, 1.2)`, `lookAt = home + (0, 0.1, 0)` —
  these are starting values, expect to nudge them by feel during dev.
- FOV: 35° — narrower than the main camera's 50° so the frog reads close.
- The view fills **~75% of the panel width** — vertically constrained by
  the existing `aspect-ratio: 16 / 10` in [AgentPanel.css:54-61](frontend/src/components/agent/AgentPanel.css#L54-L61),
  which already produces the correct viewport rectangle. Adjust the
  inner `agent-panel__oracle` width to `75%` + horizontally center it,
  OR keep 100% width and tighten the camera FOV until the frog sits at
  the 75% read. **Choose by visual outcome** — both options are visually
  acceptable; pick whichever produces less letterboxing on a 440px-wide
  panel.

**Pond visible behind the frog:**
- The view shares the same scene, so the WaterSurface, pond background
  color, and ambient lighting are visible behind the frog naturally — no
  separate scene composition needed.
- The view does NOT render the postprocessing Bloom from the main
  `<EffectComposer>`. drei `<View>` skips postprocessing by default;
  this is acceptable for v1 (the frog's emissive material already
  produces a glow appearance even without Bloom). If the result looks
  flat in dev, defer Bloom-on-secondary-view to a follow-up (logged in
  deferred-work; do NOT ship dual EffectComposer for v1 — the first attempt
  to share Bloom across views adds material complexity).

**Test approach:**
- Component tests for `AgentPanelOracleView` mock `@react-three/drei`'s
  `View` and `Views` exports (same pattern as
  [LilyPad.test.tsx:65](frontend/src/components/pond/LilyPad.test.tsx#L65)).
  Don't try to render Three.js inside vitest — the panel test asserts
  the DOM container + props passed to `<View>`, nothing more.

### AC 6 — Tests pass

**Given** the new test files

**When** I run `npx vitest --run` from `frontend/`

**Then** all existing tests still pass (no regressions), and new tests cover:

- `frontend/src/components/agent/AgentPanelOracleView.test.tsx` —
  - Renders the DOM container with the existing
    `agent-panel__section--oracle` aspect-ratio class
  - Forwards a track ref to the mocked `<View>`
  - When `agentState` changes (forced via store), the camera/View props
    DON'T change — agentState only affects the frog mesh, not the camera
- `frontend/src/components/agent/OracleFrogManager.test.tsx` —
  - First mount with no persisted oracle position calls
    `setOraclePadPosition({x: -3.5, z: 3.5})`
  - Subsequent mounts with persisted position do NOT overwrite it
  - When pad current position drifts beyond `ORACLE_BOUNDARY_RADIUS`
    (forced via store mock), the boundary-return phase enters
    `'dissolving'`
- `frontend/src/components/agent/OracleFrog.test.tsx` —
  - Renders the body mesh + outline `TubeGeometry`. Asserts the geometry
    type is `TubeGeometry` and the curve type is `CatmullRomCurve3`
    (instance check — drei is mocked but the geometry is constructed
    inline so the assertion is reachable)
  - Reads `agentState` from a mocked `useAgentStore` and asserts the
    expected emissive intensity per state
  - When reduce-motion is mocked true, `useFrame` callback is short-
    circuited (mock the matchMedia and assert no animation values are
    written to the mesh refs)
- `frontend/src/stores/useAgentStore.test.ts` (extend) —
  - `agentState` initial value is `'idle'`
  - `ingestSseEvent({type: 'start', ...})` sets `agentState = 'thinking'`
  - `ingestSseEvent({type: 'chunk', ...})` while `'thinking'` flips to
    `'speaking'`; while `'speaking'` stays `'speaking'`
  - `ingestSseEvent({type: 'done'})` sets `'success'` and after the
    1200ms timer (use `vi.useFakeTimers()`) reverts to `'idle'`
  - `ingestSseEvent({type: 'error'})` sets `'error'` and after the 2000ms
    timer reverts to `'idle'`
  - `cancelStreaming()` clears any pending `'success' → 'idle'` /
    `'error' → 'idle'` timer
  - `oraclePadPosition` round-trips through the persist middleware
    (assert `partialize` includes the field)
- `frontend/src/components/agent/AgentComposer.test.tsx` (extend) —
  - Composer focus + non-empty draft + `streamingMessageId === null`
    → `setAgentState('listening')` is called
  - Composer blur OR draft empty OR `streamingMessageId !== null`
    → reverts to `'idle'`

**And** TypeScript builds clean (`npm run build`) and ESLint passes
(`npm run lint`).

---

## Tasks / Subtasks

### Task 1 — Extend `useAgentStore` with `agentState` + `oraclePadPosition` (AC 2, AC 4)

- [x] In [`frontend/src/stores/useAgentStore.ts`](frontend/src/stores/useAgentStore.ts):
  - Add `agentState: 'idle' | 'listening' | 'thinking' | 'speaking' | 'success' | 'error'`
    field, default `'idle'`.
  - Add `oraclePadPosition: { x: number; z: number } | null`, default `null`.
  - Add actions: `setAgentState`, `setOraclePadPosition`.
  - In `ingestSseEvent`:
    - `'start'` branch (after the existing optimistic-id rebind logic):
      `set({ agentState: 'thinking' })`.
    - `'chunk'` branch (after the existing buffer append): if current
      `agentState === 'thinking'`, set to `'speaking'`; else leave alone.
    - `'done'` branch (after the existing complete-message logic):
      `set({ agentState: 'success' })`, then schedule a `window.setTimeout`
      after 1200ms to flip to `'idle'`. Store the handle in module-scope
      (like `activeStreamHandle`) so it can be cancelled.
    - `'error'` branch: `set({ agentState: 'error' })` + 2000ms revert
      timer (same pattern).
  - In `cancelStreaming` and `switchSession` (after `abortActiveStream`):
    clear any pending `agentState`-revert timer and force `agentState = 'idle'`.
  - Update `persist` middleware's `partialize` to include
    `oraclePadPosition` (do NOT persist `agentState` — that's per-session).
- [x] Extend
  [`frontend/src/stores/useAgentStore.test.ts`](frontend/src/stores/useAgentStore.test.ts)
  with the cases listed in AC 6.

### Task 2 — Wire `'listening'` to composer focus (AC 4)

- [x] In [`frontend/src/components/agent/AgentComposer.tsx`](frontend/src/components/agent/AgentComposer.tsx):
  add an effect that synchronises `useAgentStore.agentState` with composer
  focus + non-empty draft (AND no in-flight stream). On mount cleanup,
  revert to `'idle'`.
- [x] Extend
  [`AgentComposer.test.tsx`](frontend/src/components/agent/AgentComposer.test.tsx)
  with the listening-state cases in AC 6.

### Task 3 — Build the `<OracleFrog>` mesh component (AC 1, AC 4)

- [x] Create [`frontend/src/components/agent/OracleFrog.tsx`](frontend/src/components/agent/OracleFrog.tsx):
  - Body geometry: low-poly assembly of primitive geometries grouped under
    a single `<group ref={bodyRef}>` (head + body + 4 legs).
  - `MeshPhysicalMaterial` per AC 1 specs.
  - Outline: `useMemo` to build `CatmullRomCurve3` (closed=true) from
    ~12-20 silhouette control points + `TubeGeometry`. `MeshBasicMaterial`
    cyan, opacity 0.95.
  - Eye spheres + throat-sac sphere as separate child meshes (refs).
  - `useFrame` reads `useAgentStore.agentState` (via subscription, NOT
    selector — re-render on state change is fine; the actual animation
    work happens inside useFrame, which doesn't re-run on store changes).
  - State-machine logic: per-state body/eye/emissive math per AC 4.
  - Reduce-motion guard: read `window.matchMedia('(prefers-reduced-motion: reduce)').matches`
    once on mount (cache in `useRef`); when true, short-circuit useFrame
    body before any mesh mutation (still updates emissive intensity from
    state, just skips body/eye position math).
- [x] Create [`OracleFrog.test.tsx`](frontend/src/components/agent/OracleFrog.test.tsx)
  per AC 6.

### Task 4 — Build `<OracleLilyPad>` + `<OracleFrogManager>` (AC 1, AC 2, AC 3)

- [x] Create
  [`frontend/src/components/agent/OracleLilyPad.tsx`](frontend/src/components/agent/OracleLilyPad.tsx):
  the pad mesh — thin disc geometry matching the regular `LilyPad`'s
  visual rim, neon-cyan emissive border. NO completion egg, NO drag,
  NO hover, NO halo color-lerps. Reads its current world position from
  a prop (driven by the boundary-return state machine in `OracleFrogManager`).
- [x] Create [`frontend/src/components/agent/OracleFrogManager.tsx`](frontend/src/components/agent/OracleFrogManager.tsx):
  the orchestrator. Owns:
  - First-mount position initialiser (AC 2 idempotent setup).
  - The boundary-return state machine (`'idle' | 'dissolving' | 'teleporting' | 'rematerializing'`)
    via `useRef` + `useState`.
  - `useFrame` that detects boundary excursion and steps the dissolve →
    teleport → rematerialize phases.
  - Renders `<OracleLilyPad position={...}>` + `<OracleFrog />`
    nested inside as the pad's mesh-space child so the frog inherits
    pad transforms.
  - Particle bursts for dissolve + rematerialize (small one-shot `<Points>`
    instances; lifecycle-tracked via state).
- [x] Mount `<OracleFrogManager />` inside [`PondScene.tsx`](frontend/src/components/pond/PondScene.tsx)
  alongside `<WaterSurface />` and the `{renderTodos.map(... LilyPad)}`
  loop. Position-wise, mount AFTER the LilyPad map so it renders on top
  of any pad that overlaps it (last-rendered-wins for transparency).
- [x] Create [`OracleFrogManager.test.tsx`](frontend/src/components/agent/OracleFrogManager.test.tsx)
  per AC 6.

### Task 5 — Replace placeholder with real `<View>` (AC 5)

- [ ] **Restructure App.tsx for shared canvas context.** This is the
  most architecturally invasive piece — read § Dev Notes "drei `<View>`
  setup" thoroughly before starting:
  - Move the `<Canvas>` from `<PondScene>` up to `<App>`.
  - Inside `<Canvas>`, render drei's `<Views>` orchestrator (which
    switches the rendering target per child `<View>`'s tracked DOM
    rectangle).
  - The default `<View>` (id `pond-main`) takes the entire canvas
    viewport — its track ref is the canvas DOM element itself.
  - The secondary `<View>` (id `oracle-aquarium`) tracks a DOM ref
    passed from `AgentPanelOracleView.tsx`.
  - `<PondScene>` becomes a child of the default view; its existing
    contents (`<WaterSurface />`, `<LilyPad />` map, `<EffectComposer />`,
    etc.) move inside the default view body unchanged.
  - `<EffectComposer>` stays inside the main view ONLY (per AC 5
    "No bloom on secondary view"). The secondary view's frog reads
    its emissive material directly with no postprocessing.
- [ ] Create [`AgentPanelOracleView.tsx`](frontend/src/components/agent/AgentPanelOracleView.tsx):
  - Renders `<div className="agent-panel__oracle" ref={trackRef} />` —
    same DOM/CSS shape as the placeholder so the surrounding
    `agent-panel__section--oracle` styling continues to fit.
  - Communicates `trackRef` to the secondary `<View>` via a Zustand
    store OR via React context (use a small new Zustand store
    `useOracleViewStore` keyed on a single `trackRef: HTMLDivElement | null`
    field — context propagation across the App.tsx boundary is messier
    than a single shared store).
- [ ] In `<App>`, alongside the secondary `<View>`, render a
  `<group position={oraclePadPosition}>` containing only the camera +
  `<OracleFrog />` + a small ambient/point light dedicated to the
  aquarium framing. The oracle pad mesh itself stays in the main view
  — the secondary view just looks at the same world from a different
  camera. **However**, the frog component should be hoisted via drei's
  `<PortalIntoMaterial>` / `<View>`-shared-scene mechanism so the SAME
  frog instance renders in both views; if that turns out to require
  geometry duplication for v1 (drei View limitations on shared meshes),
  duplicate the frog in the secondary view body — visual parity with
  the main scene is what matters; one shared instance is a
  perf/aesthetic win, not a correctness requirement.
- [ ] Delete the old `AgentPanelOraclePlaceholder.tsx` (and its imports
  + tests). Update `AgentPanel.tsx` to import `AgentPanelOracleView`
  instead. Update any remaining placeholder references.
- [ ] Create [`AgentPanelOracleView.test.tsx`](frontend/src/components/agent/AgentPanelOracleView.test.tsx)
  per AC 6.

### Task 6 — Polish + run all gates

- [ ] Visual smoke test: open the panel via F1, verify the frog is
  visible in the aquarium window. Send a message, verify the state
  transitions render visibly (`thinking` → `speaking` chunk-pulses →
  `success` hop on `done`).
- [ ] `npm run build` — no TS errors, no Vite warnings.
- [ ] `npx vitest --run` — all tests pass, no skips.
- [ ] `npm run lint` — net-zero delta vs baseline.
- [ ] `prefers-reduced-motion: reduce` smoke check via DevTools
  rendering panel — frog stays still, emissive ramps still play.

---

## Dev Notes

### Existing patterns to follow (not reinvent)

| Concern | Where it's done | Pattern |
|---|---|---|
| Zustand store with persist | [stores/useAgentStore.ts](frontend/src/stores/useAgentStore.ts) — Story 6.2 | `persist` middleware with `partialize` to limit what's persisted |
| Per-pad `useFrame` animation state machine | [components/pond/LilyPad.tsx](frontend/src/components/pond/LilyPad.tsx) | `useRef`-tracked phase + `useState` to force re-render on phase change; `useFrame` mutates mesh refs in place, never re-creates geometry |
| Procedural creature mesh | [components/creatures/creatures/Firefly.tsx](frontend/src/components/creatures/creatures/Firefly.tsx) | Primitive geometry + animated material via `useFrame`; lazy `useState(() => Math.random())` for per-mount seed (keeps render body pure) |
| Particle burst (one-shot effect) | None today; closest reference is [components/creatures/EmergingCreature.tsx](frontend/src/components/creatures/EmergingCreature.tsx) | `<Points>` with a per-particle lifetime; mount on event, unmount on lifetime end. NO need to integrate with the existing `triggerRipple` system; oracle dissolve particles are visual-only |
| Reduce-motion gating | None formalised yet (Story 4.4 will sweep) | `window.matchMedia('(prefers-reduced-motion: reduce)').matches` — read once into a `useRef` on mount; gate animation work in `useFrame` against the cached value |
| drei `<Html>` precedent | [components/pond/LilyPad.tsx:4](frontend/src/components/pond/LilyPad.tsx#L4), [components/ui/InfoPopup.tsx:2](frontend/src/components/ui/InfoPopup.tsx#L2) | drei is already a project dependency at v10.7.7+ — `<View>` + `<Views>` are exported from the same package |

### Why useAgentStore not useWorldStore

`useWorldStore` ([stores/useWorldStore.ts](frontend/src/stores/useWorldStore.ts))
is the **canonical world-metadata store for backend-tracked todos** —
the periodic `PATCH /api/todos/positions` save loop is keyed on entries
in this store, and `hydrateFromTodos` populates it from the server's
`GET /api/todos` response. Putting the oracle pad in there would either
(a) trigger spurious `PATCH /api/todos/positions` calls for a non-todo
id (which the backend would reject), or (b) require a special-case
discriminant on every world-store consumer.

`useAgentStore` already exists for agent-related panel state, already
has `persist` middleware, and the oracle pad is conceptually "a piece of
the agent's UI presence" — same lifecycle as `panelOpen` and
`activeSessionId`. One extra persisted field; no cross-store
infrastructure changes.

### drei `<View>` setup

The aquarium-window metaphor depends on drei's `<View>` portal pattern.
**Read the official docs first:** https://drei.docs.pmnd.rs/portals/view

Critical points to verify before starting Task 5:
- `@react-three/drei` v10.7.7 is installed — `<View>` is exported.
- `<Views>` (the orchestrator) MUST sit inside the parent `<Canvas>` and
  is what walks the children and renders each one to its own viewport
  rectangle. Without `<Views>`, individual `<View>` components don't
  render.
- DOM tracking: each `<View track={ref}>` reads its track ref's
  `getBoundingClientRect()` per frame. The track ref must be a DOM
  element actually mounted at the time `<View>` runs its tracking; if
  the panel is closed (`AgentPanel` unmounts the entire panel chrome
  when `panelOpen` is false — see [AgentPanel.tsx:127](frontend/src/components/agent/AgentPanel.tsx#L127)),
  the secondary view's track ref is null and drei should skip it. Verify
  this is graceful — drei v10 should no-op cleanly, but log any errors
  during dev.
- Postprocessing (`<EffectComposer>`) interacts oddly with multiple
  `<View>`s. Story scope keeps Bloom on the main view only.

### Shared lily-pad geometry

If extracting the regular pad's lily-pad geometry from
[LilyPad.tsx](frontend/src/components/pond/LilyPad.tsx) into a shared
`frontend/src/components/pond/lilyPadGeometry.ts` is a 5-line refactor,
do it — both `LilyPad` and `OracleLilyPad` then import it. If the geometry
is tangled into LilyPad's drag/animation logic and extraction would
require touching unrelated code, **duplicate the geometry inline in
`OracleLilyPad`** — Story 6.7 is not the right place to refactor
LilyPad's internals. Bias toward duplication; the oracle pad has only
one consumer in the foreseeable future.

### Story 6.2 placeholder API contract — what 6.7 inherits

[AgentPanelOraclePlaceholder.tsx](frontend/src/components/agent/AgentPanelOraclePlaceholder.tsx)
already provides:
- A `<div className="agent-panel__oracle">` root at the right aspect
  ratio (16:10) with the surrounding section in
  [AgentPanel.css:54-80](frontend/src/components/agent/AgentPanel.css#L54-L80).
- An optional `children` slot — not used by 6.7's `<View>` approach
  (the secondary view tracks the parent div directly), but the prop API
  was designed for 6.7's flexibility.

The new `AgentPanelOracleView.tsx` should preserve the SAME outer
DOM/CSS shape (`agent-panel__oracle` className, 16:10 aspect ratio
inherited from the parent section) so the surrounding panel layout
doesn't shift. Only the inner content changes from "static caption" to
"tracked drei `<View>` viewport".

### `prefers-reduced-motion` is a per-story responsibility (until 4.4 sweeps)

Story 4.4 (frontend a11y sweep) will eventually retrofit `prefers-reduced-motion`
across older animations. Until then, every NEW animation honours it
explicitly. AC 3 (boundary return) and AC 4 (state-machine animations)
both gate on `window.matchMedia('(prefers-reduced-motion: reduce)').matches`.
Pattern: cache the boolean in a `useRef` on mount; gate animation work
in `useFrame` against the cached value. **Do not re-read matchMedia
every frame** — it's cheap but not free, and the user's reduce-motion
preference doesn't change during a session.

### File locations summary

| New file | Purpose |
|---|---|
| `frontend/src/components/agent/OracleFrog.tsx` | Procedural frog mesh (body + outline + eyes + throat sac) |
| `frontend/src/components/agent/OracleFrog.test.tsx` | Mesh + state-driven animation tests |
| `frontend/src/components/agent/OracleLilyPad.tsx` | Oracle's dedicated pad mesh (no CRUD chrome) |
| `frontend/src/components/agent/OracleFrogManager.tsx` | Mount + first-position-init + boundary-return state machine |
| `frontend/src/components/agent/OracleFrogManager.test.tsx` | Manager lifecycle + boundary-return tests |
| `frontend/src/components/agent/AgentPanelOracleView.tsx` | Replaces `AgentPanelOraclePlaceholder.tsx`; renders the tracked `<View>` viewport |
| `frontend/src/components/agent/AgentPanelOracleView.test.tsx` | View component tests |
| `frontend/src/stores/useOracleViewStore.ts` | Tiny Zustand store carrying the `<View>` track ref between panel and canvas |

| Modified file | Change |
|---|---|
| `frontend/src/stores/useAgentStore.ts` | Add `agentState` + `oraclePadPosition` fields, setters, SSE-event transitions, persistence partialize update |
| `frontend/src/stores/useAgentStore.test.ts` | Cover new fields + transitions + timer cancellation |
| `frontend/src/components/agent/AgentComposer.tsx` | Wire `'listening'` state to focus + non-empty draft (gated on `streamingMessageId`) |
| `frontend/src/components/agent/AgentComposer.test.tsx` | Listening-state coverage |
| `frontend/src/components/agent/AgentPanel.tsx` | Import + render `<AgentPanelOracleView>` instead of `<AgentPanelOraclePlaceholder>` |
| `frontend/src/components/agent/AgentPanel.test.tsx` | Update placeholder→view import + assertions |
| `frontend/src/components/pond/PondScene.tsx` | Mount `<OracleFrogManager>` inside the canvas (after the lily-pad map) |
| `frontend/src/App.tsx` | Hoist `<Canvas>` to App; wrap with drei `<Views>`; default `<View>` houses `<PondScene>`; secondary `<View>` houses the aquarium-window camera + frog |

| Deleted file | Reason |
|---|---|
| `frontend/src/components/agent/AgentPanelOraclePlaceholder.tsx` | Replaced by `AgentPanelOracleView.tsx` (per Story 6.2's placeholder design — the rename was anticipated) |

### Story 6.2 deferred items that affect this story

- The placeholder's `children` slot was designed for 6.7 to drop a
  `<View>` in. **6.7 will NOT use this exact mechanism** — drei's
  `<View>` needs to be inside the parent `<Canvas>`, not nested as a
  placeholder child. Instead, the placeholder's wrapper div becomes the
  *track ref* for the secondary `<View>` that's mounted inside App's
  canvas. Functionally equivalent end result; cleaner React tree.
- [Group D CR] Panel mount-effect re-runs on `panelOpen` flips (false→true).
  When the panel reopens after being closed, the secondary `<View>`'s
  track ref re-mounts as a fresh DOM node. Verify drei tolerates this —
  the `<Views>` orchestrator should pick up the new ref naturally; if
  not, a small `useLayoutEffect` in `AgentPanelOracleView` to publish
  the ref into `useOracleViewStore` on every mount handles the re-bind.

### CrewAI / agent backend — out of scope

This story does NOT touch:
- `backend/src/agent/*` — the agent's actual behaviour
- The chat skill, intent classifier, or any tool implementation
- Database schemas (`chat_sessions`, `chat_messages`, etc.)
- The SSE event contract (Story 6.2's `start` / `chunk` / `done` /
  `error` events are reused as-is — only the frontend reducer
  `ingestSseEvent` is extended to map them onto `agentState`)

If a backend gap surfaces during dev (e.g., the existing SSE events
don't carry enough information to derive `agentState` cleanly), STOP
and reconcile via a Group A code-review amendment to this story rather
than expanding scope mid-implementation.

---

## Story DoD (Definition of Done)

- [ ] `npm run build` succeeds (no type errors, no lint errors)
- [ ] `npx vitest --run` from `frontend/` passes (all existing + new tests, no skips)
- [ ] Backend tests still pass (`uv run pytest` from `backend/`) — should be untouched, but run anyway as a regression gate
- [ ] Oracle Frog is visible on his lily pad in the main pond view
- [ ] Oracle Frog is visible in the AgentPanel's aquarium-window section when the panel is open
- [ ] Both views show the SAME frog (visually identical posture/animation) at all times
- [ ] State transitions visibly play in BOTH views: typing in composer (with content) → frog leans forward; pressing send → frog enters thinking; chunks → throat sac pulses; done → brief hop; error → red contraction
- [ ] Boundary-return animation triggers correctly when the oracle pad is forced past `ORACLE_BOUNDARY_RADIUS` (use a temporary dev-only "shove" button or a test-only override to verify)
- [ ] `prefers-reduced-motion: reduce` set in DevTools → frog stays still; emissive intensity ramps still play
- [ ] Oracle pad position persists across page reload (Zustand `persist` middleware)
- [ ] Oracle pad does NOT appear in `GET /api/todos` debugging output (it's frontend-only)
- [ ] Oracle pad is not affected by visibility-filter slash-commands (`/all`, `/active`, etc. — Story 3.3) or by search (Story 5.3)
- [ ] Manual smoke test: open panel via F1, send a message, watch the frog cycle thinking → speaking → success → idle. Repeat with a deliberately-failing message (e.g., agent returns an `error` SSE event) — frog enters error state and recovers to idle.

---

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
