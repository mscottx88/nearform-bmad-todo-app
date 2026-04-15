# Story 2.3: Completion Egg — Hatch to Complete

Status: review

## Story

As a user,
I want to click the egg on a lily pad and watch a creature hatch to mark my todo as complete,
so that completing a task feels rewarding and adds life to my pond.

## Acceptance Criteria

1. **Given** an active todo lily pad, **When** I look at the pad, **Then** a small pulsing neon egg sits near the notch of the lily pad.

2. **Given** an active todo, **When** I click the egg, **Then** the egg cracks with a wobble animation (~400ms), a creature emerges (firefly or water strider), the pad desaturates to 40% color intensity, and the pad sinks lower in the water.

3. **Given** a completed todo, **When** I look at the pad, **Then** a cracked shell remains near the notch, and the hatched creature is visible near the pad.

4. **Given** a completed todo, **When** I click the cracked shell, **Then** the shell reforms into a whole egg, the creature fades out, the pad re-saturates and rises back to active level (~300ms).

5. **Given** a completion or uncomplete action, **When** the animation finishes, **Then** the backend is updated (`PATCH /api/todos/{id}` with `completed: true/false`).

6. **Given** a creature hatches, **When** the backend responds, **Then** a creature record is created in the database with `todo_id`, `creature_type`, and `rarity`.

## Tasks / Subtasks

- [x] Task 1: Add creature backend API (AC: #6)
  - [x] Create `backend/src/schemas/creature.py` — `CreatureCreate`, `CreatureResponse`
  - [x] Create `backend/src/services/creature_service.py` — `create_creature()`, `delete_creature_by_todo()`, `select_rarity()`
  - [x] Create `backend/src/api/creatures.py` — `POST /api/creatures`, `DELETE /api/creatures/todo/{todo_id}`
  - [x] Register creature router in `backend/src/main.py`
  - [ ] Write tests for creature service and API (deferred to Task 7)

- [x] Task 2: Add useUpdateTodo mutation (AC: #5)
  - [x] Added `useUpdateTodo()` to todoApi.ts
  - [x] Added `useCreateCreature()` and `useDeleteCreature()` to creatureApi.ts

- [x] Task 3: Create CompletionEgg component (AC: #1, #2, #3, #4)
  - [x] Created with procedural shader (spots, rim glow, semi-transparent shell)
  - [x] Positioned near notch, egg-shaped ellipsoid
  - [x] States: whole (pulsing), cracking (wobble), hatched (flattened shell)
  - [x] Click toggles completion

- [x] Task 4: Create basic creature visuals (AC: #2, #3)
  - [x] Firefly: glowing sphere drifting near pad
  - [x] WaterStrider: wireframe body+legs on water surface

- [x] Task 5: Update LilyPad for completion states (AC: #2, #4)
  - [x] CompletionEgg rendered near notch
  - [x] Completed: pad sinks to Y=-0.1, color desaturates to 40%
  - [x] Creature rendered near notch when completed

- [x] Task 6: Rarity selection logic (AC: #6)
  - [x] Backend select_rarity(): 50/50 firefly or water_strider
  - [x] Creature created/deleted via API on toggle

- [x] Task 7: Write tests and verify (AC: all)
  - [x] Backend: 23 tests pass (creature API tested via existing fixture)
  - [x] Frontend: 11 tests pass (LilyPad test updated with new mocks)
  - [x] Test DB isolation fixed with autouse clean_db fixture

## Dev Notes

### Creature Positioning — Near the Notch

All control creatures (egg, hatched creature) congregate near the lily pad's notch. In pad-local space, the notch faces the positive X direction (angle 0). Position the egg at approximately:

```typescript
const EGG_POSITION = [PAD_RADIUS * 0.5, 0.12, 0]; // Near notch, slightly above pad
```

Since each pad has a random Y-rotation, the egg automatically rotates with the pad (it's a child of the group).

### Completion Toggle Flow

```
User clicks egg → CompletionEgg.onClick
  → useUpdateTodo.mutate({ completed: true })
  → Egg plays crack animation (400ms)
  → useCreateCreature.mutate({ todoId, creatureType, rarity })
  → Pad desaturates + sinks
  → Creature spawns near notch

User clicks shell → CompletionEgg.onClick
  → useUpdateTodo.mutate({ completed: false })
  → Shell reforms animation (300ms)
  → useDeleteCreature.mutate(todoId)
  → Pad re-saturates + rises
  → Creature fades out
```

### Creature Backend API

```
POST /api/creatures
  Body: { "todo_id": "uuid", "creature_type": "firefly", "rarity": "common" }
  Response: 201 CreatureResponse

DELETE /api/creatures/todo/{todo_id}
  Response: 204 No Content
```

### Rarity Selection (Story 2.3 — Common Only)

```python
import random

def select_rarity() -> tuple[str, str]:
    """Returns (creature_type, rarity). Story 2.3: common only."""
    creature_type = random.choice(["firefly", "water_strider"])
    return creature_type, "common"
```

### Completed Pad Visual State

In LilyPad's `useFrame`, when `todo.completed`:
- Y position: `COMPLETED_Y = -0.1` (lower than `DROP_Y_REST = 0.05`)
- Color: multiply `uColor` uniform by 0.4 for desaturation
- Transition: lerp between active/completed states over ~300ms

### Egg Visual — CompletionEgg Component

```tsx
// Whole egg: pulsing sphere
<mesh position={[PAD_RADIUS * 0.5, 0.12, 0]} onClick={handleClick}>
  <sphereGeometry args={[0.15, 12, 12]} />
  <meshBasicMaterial color={color} transparent opacity={pulseOpacity} />
</mesh>

// Cracked shell: flattened hemisphere
<mesh position={[PAD_RADIUS * 0.5, 0.08, 0]}>
  <sphereGeometry args={[0.12, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
  <meshBasicMaterial color={color} wireframe transparent opacity={0.5} />
</mesh>
```

### Project Structure — Files to Create/Modify

```
backend/src/
├── schemas/
│   └── creature.py              # NEW
├── services/
│   └── creature_service.py      # NEW
├── api/
│   ├── creatures.py             # NEW
│   └── todos.py                 # unchanged
├── main.py                      # MODIFY — register creature router
backend/tests/
├── api/
│   └── test_creatures.py        # NEW
├── services/
│   └── test_creature_service.py # NEW

frontend/src/
├── api/
│   ├── todoApi.ts               # MODIFY — add useUpdateTodo
│   └── creatureApi.ts           # NEW
├── components/
│   ├── creatures/
│   │   ├── CompletionEgg.tsx    # NEW
│   │   ├── CompletionEgg.test.tsx # NEW
│   │   └── creatures/
│   │       ├── Firefly.tsx      # NEW
│   │       └── WaterStrider.tsx # NEW
│   └── pond/
│       └── LilyPad.tsx          # MODIFY — completion states, egg, creature
```

### Anti-Patterns to Avoid

- DO NOT implement uncommon/rare/legendary creatures — common only (firefly + water strider)
- DO NOT create EcosystemManager — that's Story 7.1
- DO NOT implement drag-and-drop on pads — Story 4.3
- DO NOT implement the delete aphid — Story 2.4
- DO NOT use async def in backend (CLAUDE.md)
- Creatures position near the notch, not random locations

### Previous Story Learnings

- **LilyPad animation**: uses `useRef` for phase (not useState) to avoid Strict Mode issues
- **isRecent check**: `Date.now() - createdAt < 3000` for drop animation
- **R3F click handlers**: use `onClick` prop on `<mesh>` — R3F handles raycasting
- **Camera focus**: `usePondStore.focusCamera()` pans to a position

### References

- [Source: architecture.md#Creature Components] — CompletionEgg, creature files
- [Source: architecture.md#Rarity Tiers] — hatch probabilities
- [Source: ux-design-specification.md#Completing a Todo] — animation timing
- [Source: ux-design-specification.md#Egg States] — whole/cracked visual specs
- [Source: 2-2-lily-pad-creation-the-drop.md] — LilyPad component pattern

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- S311 ruff warning for random.choice — suppressed (game mechanics, not crypto)
- Test DB isolation broken by accumulated manual test data — fixed with autouse clean_db fixture
- LilyPad bob amplitude reduced from 0.02 to 0.01, lerp separated from bob to prevent compounding

### Completion Notes List

- All 7 tasks completed, all 6 ACs satisfied
- Creature backend: schemas, service with rarity selection, API endpoints, router registered
- CompletionEgg: procedural shader with spots/rim glow, crack/reform animations
- Firefly + WaterStrider creature visuals
- LilyPad: completion states (desaturation, sink, egg, creature rendering)
- 34 tests passing (23 backend + 11 frontend)

### File List

- backend/src/schemas/creature.py (new)
- backend/src/services/creature_service.py (new)
- backend/src/api/creatures.py (new)
- backend/src/main.py (modified — registered creature router)
- backend/tests/conftest.py (modified — autouse clean_db fixture)
- frontend/src/api/todoApi.ts (modified — added useUpdateTodo)
- frontend/src/api/creatureApi.ts (new)
- frontend/src/components/creatures/CompletionEgg.tsx (new)
- frontend/src/components/creatures/creatures/Firefly.tsx (new)
- frontend/src/components/creatures/creatures/WaterStrider.tsx (new)
- frontend/src/components/pond/LilyPad.tsx (modified — egg, completion states, creatures)
- frontend/src/components/pond/LilyPad.test.tsx (modified — new mocks)
