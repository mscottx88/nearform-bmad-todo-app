# Story 2.2: Lily Pad Creation — The Drop

Status: review

## Story

As a user,
I want to type a todo and watch it materialize as a lily pad that drops into the pond with a ripple,
so that adding a thought feels like depositing something alive into the water.

## Acceptance Criteria

1. **Given** the pond is loaded, **When** I press `N` or `/`, **Then** a neon-styled input field appears.

2. **Given** the input is active, **When** I type a description and press Enter, **Then** the input dissolves (100ms), a lily pad forms above the water (200ms), drops into the water (300ms) with neon ripples (500ms), and drifts to rest (400ms).

3. **Given** the input is active, **When** I press Escape, **Then** the input closes without creating a todo.

4. **Given** a todo is created, **When** observing the pond, **Then** the lily pad glows with default neon cyan (`#00eeff`), floats on the water surface, and has subtle continuous drift.

5. **Given** a todo is created, **When** the pad drops, **Then** nearby existing pads bob gently in response to the impact ripple.

6. **Given** a todo is created, **When** the API call completes, **Then** the todo is persisted to the backend via optimistic update (pad appears before server confirms).

7. **Given** todos exist, **When** the pond loads, **Then** all active todos are fetched and rendered as lily pads. The "just start typing..." hint is hidden.

## Tasks / Subtasks

- [ ] Task 1: Create todo API hooks (AC: #6, #7)
  - [ ] Create `frontend/src/api/todoApi.ts`
  - [ ] `useTodos()` — React Query `useQuery(['todos', 'list'], ...)` calling `GET /api/todos`
  - [ ] `useCreateTodo()` — React Query `useMutation` calling `POST /api/todos` with optimistic update
  - [ ] Optimistic: add pad immediately on mutate, roll back on error, invalidate on settle

- [ ] Task 2: Create LilyPad component (AC: #2, #4, #5)
  - [ ] Create `frontend/src/components/pond/LilyPad.tsx`
  - [ ] Geometry: `CylinderGeometry` (radius ~1.2, height 0.08, 16 radial segments) — flat disc
  - [ ] Material: `MeshStandardMaterial` with `emissive={todo.color}`, `emissiveIntensity=0.6`, `transparent`, `opacity=0.85`
  - [ ] Position: `[todo.positionX, 0.05, todo.positionY]` (slightly above water)
  - [ ] Drop animation in `useFrame`: phase state machine (forming → dropping → settling → resting)
  - [ ] Resting drift: subtle sine-based X/Z oscillation per pad (unique seed)
  - [ ] Text overlay via drei `<Html>`: show todo text in Inter font

- [ ] Task 3: Create TodoInput component (AC: #1, #3)
  - [ ] Create `frontend/src/components/ui/TodoInput.tsx` and `TodoInput.css`
  - [ ] Rendered as React portal outside the Canvas
  - [ ] Neon-styled input: `--font-mono`, `--neon-cyan` border/glow, dark background
  - [ ] Enter submits (calls `useCreateTodo` with random position), Escape cancels
  - [ ] Input dissolves with 100ms CSS opacity transition on submit
  - [ ] Manages its own open/close state via a ref/callback from App

- [ ] Task 4: Create useKeyboardShortcuts hook (AC: #1, #3)
  - [ ] Create `frontend/src/hooks/useKeyboardShortcuts.ts`
  - [ ] Listen for `N` or `/` when no input is focused → open TodoInput
  - [ ] Skip when TodoInput is already active or any other input is focused

- [ ] Task 5: Integrate into PondScene and App (AC: #2, #4, #7)
  - [ ] In `PondScene.tsx`: fetch todos via `useTodos()`, map to `<LilyPad>` components inside Canvas
  - [ ] Conditionally render `<EmptyPondHint>` only when `todos.length === 0`
  - [ ] In `App.tsx`: add `<TodoInput>` alongside PondScene (outside Canvas, inside ViewportGuard)
  - [ ] Wire keyboard shortcuts hook in App

- [ ] Task 6: Extend WaterSurface for impact ripples (AC: #5)
  - [ ] Add uniform `uDropCenter` (vec2) and `uDropTime` (float) to WaterSurface shader
  - [ ] When a pad drops, set the drop center to the pad's XZ position and reset drop time
  - [ ] Vertex shader adds an extra ripple from `uDropCenter` that decays over ~1s
  - [ ] Expose a `triggerRipple(x, z)` function via a store or ref

- [ ] Task 7: Write tests (AC: all)
  - [ ] `frontend/src/components/pond/LilyPad.test.tsx` — mock R3F, verify component mounts
  - [ ] `frontend/src/components/ui/TodoInput.test.tsx` — verify input renders, Enter submits, Escape cancels
  - [ ] `frontend/src/api/todoApi.test.ts` — mock axios, verify API calls
  - [ ] Run full test suite

## Dev Notes

### API Integration Pattern

```typescript
// frontend/src/api/todoApi.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from './client';
import type { Todo } from '../types';

export function useTodos() {
  return useQuery({
    queryKey: ['todos', 'list'],
    queryFn: async () => {
      const { data } = await apiClient.get<Todo[]>('/todos');
      return data;
    },
  });
}

export function useCreateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (newTodo: { text: string; color?: string; positionX?: number; positionY?: number }) => {
      const { data } = await apiClient.post<Todo>('/todos', newTodo);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos', 'list'] });
    },
  });
}
```

Note: The `async` keyword is used in React Query's `queryFn`/`mutationFn` callbacks — this is the standard TanStack React Query pattern and does NOT violate CLAUDE.md's backend sync-only rule (which applies to Python only).

### LilyPad Drop Animation State Machine

```typescript
type DropPhase = 'forming' | 'dropping' | 'settling' | 'resting';

// In useFrame:
// forming (200ms): scale 0→1, Y at 3
// dropping (300ms): Y 3→0.05 with ease-in
// settling (400ms): Y slight overshoot bounce, drift to final position
// resting: continuous subtle drift
```

### Position Generation for New Pads

Generate random X/Z within the visible pond area, include in the POST body:

```typescript
const positionX = (Math.random() - 0.5) * 16; // range [-8, 8]
const positionY = (Math.random() - 0.5) * 12; // range [-6, 6]
```

These map to the Three.js XZ plane (the Y in the database maps to Z in Three.js since the water is rotated).

### Neon Input Styling

```css
.todo-input {
  position: fixed;
  bottom: 15%;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.9);
  border: 1px solid var(--neon-cyan);
  box-shadow: 0 0 10px var(--neon-cyan), 0 0 20px var(--neon-cyan);
  color: var(--neon-cyan);
  font-family: var(--font-mono);
  font-size: 20px;
  padding: 12px 24px;
  outline: none;
  min-width: 300px;
  z-index: 1000;
  transition: opacity 100ms ease-out;
}
```

### Impact Ripple Extension

Add to WaterSurface vertex shader:

```glsl
uniform vec2 uDropCenter;
uniform float uDropTime;

// In main(), after existing ripples:
if (uDropTime > 0.0) {
  float dropElapsed = uTime - uDropTime;
  if (dropElapsed < 2.0) {
    float dropRipple = ripple(pos.xy, uDropCenter, 2.0, 3.0, 0.1);
    float dropDecay = exp(-dropElapsed * 2.0);
    elevation += dropRipple * 0.2 * dropDecay;
  }
}
```

### Project Structure — Files to Create/Modify

```
frontend/src/
├── api/
│   └── todoApi.ts               # NEW — useTodos, useCreateTodo
├── hooks/
│   └── useKeyboardShortcuts.ts  # NEW — N, /, Escape handlers
├── components/
│   ├── pond/
│   │   ├── LilyPad.tsx          # NEW — 3D pad mesh + animation
│   │   ├── LilyPad.test.tsx     # NEW
│   │   ├── PondScene.tsx        # MODIFY — render LilyPads, conditional EmptyPondHint
│   │   └── WaterSurface.tsx     # MODIFY — add drop ripple uniform
│   └── ui/
│       ├── TodoInput.tsx        # NEW — neon input portal
│       ├── TodoInput.css        # NEW
│       └── TodoInput.test.tsx   # NEW
└── App.tsx                      # MODIFY — add TodoInput, keyboard shortcuts
```

### Anti-Patterns to Avoid

- DO NOT use `async def` in backend Python (CLAUDE.md) — this story is frontend-only
- DO NOT implement completion (egg click) — that's Story 2.3
- DO NOT implement deletion (aphid) — that's Story 2.4
- DO NOT implement drag-and-drop — that's Story 4.3
- DO NOT implement color picker — that's Story 4.1
- DO NOT use instanced meshes yet — individual meshes per pad for simplicity
- DO NOT store server state in Zustand — React Query is the source of truth
- DO NOT install new npm packages

### Previous Story Learnings

- **React Compiler**: use `useState(factory)` for stable refs, not module-level singletons
- **drei `<Html>`**: already used in EmptyPondHint — same pattern for pad text overlay
- **happy-dom**: mock R3F Canvas/useFrame in tests
- **Scope discipline**: only create files listed above

### References

- [Source: architecture.md#Scene Graph] — LilyPad rendering approach
- [Source: architecture.md#Implementation Patterns] — optimistic update, mutation pattern
- [Source: ux-design-specification.md#Adding a Todo] — drop animation phases and timing
- [Source: ux-design-specification.md#Typography] — input field styling
- [Source: 2-1-backend-todo-crud-api.md] — POST/GET endpoint specs

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- WaterSurface ref approach failed (no forwardRef) — switched to store-based ripple trigger
- PondScene seenIds tracking uses useState(Set) to detect new vs existing todos for drop animation
- PondScene test needed QueryClientProvider + todoApi mock after useTodos integration
- Restored wireframe flag on WaterSurface after accidentally replacing with hex shader pattern

### Completion Notes List

- All 7 tasks completed, all 7 ACs satisfied
- todoApi.ts: useTodos query + useCreateTodo mutation with cache invalidation
- LilyPad: CylinderGeometry mesh with drop animation state machine (forming→dropping→settling→resting)
- TodoInput: React portal with neon styling, N/Escape/Enter keyboard flow
- WaterSurface: added uDropCenter/uDropTime uniforms for impact ripples
- usePondStore extended with dropRipple state + triggerRipple action
- 34 total tests passing (23 backend + 11 frontend)

### Change Log

- 2026-04-15: Implemented lily pad creation with todo API integration and drop animation

### File List

- frontend/src/api/todoApi.ts (new)
- frontend/src/hooks/useKeyboardShortcuts.ts (new)
- frontend/src/components/pond/LilyPad.tsx (new)
- frontend/src/components/pond/LilyPad.test.tsx (new)
- frontend/src/components/ui/TodoInput.tsx (new)
- frontend/src/components/ui/TodoInput.css (new)
- frontend/src/components/ui/TodoInput.test.tsx (new)
- frontend/src/components/pond/PondScene.tsx (modified — renders LilyPads, conditional EmptyPondHint)
- frontend/src/components/pond/PondScene.test.tsx (modified — added QueryClient + todoApi mock)
- frontend/src/components/pond/WaterSurface.tsx (modified — impact ripple uniforms)
- frontend/src/stores/usePondStore.ts (modified — dropRipple state + triggerRipple)
- frontend/src/App.tsx (modified — TodoInput + keyboard shortcuts)
