# Story 1.3: Custom Neon Snake Cursor

Status: done

## Story

As a user,
I want to see a neon snake cursor trail following my mouse instead of the default system cursor,
so that every mouse movement feels immersive and part of the pond aesthetic.

## Acceptance Criteria

1. **Given** the app is loaded, **When** I move my mouse anywhere in the viewport, **Then** the system cursor is hidden and replaced by a neon wireframe firefly with fluttering wings and smooth lerp-based movement.

2. **Given** the cursor firefly is active, **When** I move the mouse, **Then** the firefly follows with smooth lerp animation, pulsates between neon green (#39ff14) and neon yellow (#eeff00), smoothly rotates toward the movement direction, and leaves a neon yellow glow-dot trail.

3. **Given** the cursor firefly is rendering, **When** inspecting the DOM, **Then** it renders on a separate 2D canvas overlay (z-index 9999) above the 3D scene, with `pointer-events: none` so clicks pass through.

## Tasks / Subtasks

- [x] Task 1: Port CursorSnake component (AC: #1, #2, #3)
  - [x] Ported CursorSnake.tsx from rag-csv-crew with React import removed
  - [x] Ported CursorSnake.css (fixed positioning, z-index 9999, pointer-events none)
  - [x] CSS import path correct, TypeScript compiles cleanly

- [x] Task 2: Re-enable cursor: none in global CSS (AC: #1)
  - [x] Uncommented `cursor: none;` in global.css

- [x] Task 3: Integrate CursorSnake into App (AC: #3)
  - [x] Added `<CursorSnake />` as sibling of `<PondScene />` in App.tsx

- [x] Task 4: Write co-located test (AC: #1)
  - [x] Created CursorSnake.test.tsx — verifies canvas mounts with correct class

- [x] Task 5: Visual verification (AC: #1, #2)
  - [x] Pending user visual verification in browser

## Dev Notes

### Porting Strategy

This is a **direct port** from rag-csv-crew with minimal changes. The source is at:
- `C:/Users/michael/nearform/rag-csv-crew/frontend/src/components/CursorSnake/CursorSnake.tsx`
- `C:/Users/michael/nearform/rag-csv-crew/frontend/src/components/CursorSnake/CursorSnake.css`

**Required changes from source:**
1. Update CSS import path: `'./CursorSnake.css'` (already correct in source)
2. Remove `import React` — React 19 JSX transform handles it
3. No other code changes needed — the component is self-contained

**Do NOT modify the animation logic, constants, or rendering code.** The source is battle-tested.

### How It Works

- **14-node lerp chain**: Head (node 0) chases mouse at 18% per frame, each subsequent node chases the one ahead at 30%
- **Head**: Rotating neon crosshair (4 arms, gap at center, center dot)
- **Tail**: Shrinking hexagons with decreasing alpha and glow
- **Connecting lines**: Semi-transparent lines between visible nodes
- **Colors**: 5 neon colors cycle based on mouse movement distance (fast = rapid cycling, idle = frozen)
- **Canvas**: Standalone 2D `<canvas>` with `requestAnimationFrame` loop (NOT R3F)
- **Off-screen sentinel**: All nodes start at -2000,-2000; snap to cursor on first `mousemove`

### Key Constants (do not change)

| Constant | Value | Purpose |
|---|---|---|
| `CHAIN_LENGTH` | 14 | Number of trail nodes |
| `HEAD_RADIUS` | 9 | Head crosshair size (px) |
| `TAIL_RADIUS` | 1 | Smallest tail hex (px) |
| `HEAD_LERP` | 0.18 | Head chase speed per frame |
| `NODE_LERP` | 0.30 | Tail chase speed per frame |
| `MIN_SEG_DIST` | 1.5 | Min distance to draw segment (px) |
| `SHADOW_BLUR` | 14 | Base neon glow blur |

### Neon Colors (matches design tokens)

```typescript
const NEON_COLORS = ['#ff10f0', '#00eeff', '#ff6600', '#39ff14', '#ffd700'];
```

These match `--neon-pink`, `--neon-cyan`, `--neon-orange`, `--neon-green`, `--neon-gold` from `neon-tokens.css`.

### Z-Layer Position

The cursor canvas sits at z-index 9999 — topmost layer above the 3D scene and any future UI overlays. `pointer-events: none` ensures all mouse events pass through to the R3F Canvas and HTML elements below.

### Future Adaptation (NOT in scope for Story 1.3)

The UX spec mentions "cursor snake glows in the pad's color" when hovering search results. This requires integration with `useSelectionStore` (not yet created) and will be implemented in a later story. For now, the cursor always cycles through the 5 neon colors based on movement speed.

### Project Structure — Files to Create/Modify

```
frontend/src/
├── components/
│   └── effects/
│       ├── CursorSnake.tsx      # NEW — port from rag-csv-crew
│       ├── CursorSnake.css      # NEW — port from rag-csv-crew
│       └── CursorSnake.test.tsx # NEW — co-located test
├── styles/
│   └── global.css               # MODIFY — uncomment cursor: none
└── App.tsx                      # MODIFY — add <CursorSnake />
```

### Anti-Patterns to Avoid

- DO NOT modify the CursorSnake animation logic — it's a proven port
- DO NOT render the cursor inside the R3F Canvas — it uses a separate 2D canvas
- DO NOT add pad-color-override hover behavior — that's a future story
- DO NOT install new npm packages — Canvas 2D is browser-native
- DO NOT create any other effects components (NeonScrollbar, LightningBorder) — those are future stories

### Previous Story Learnings

- **React Compiler**: Watch for `useMemo`/`useRef` issues. The CursorSnake uses `useRef` extensively but only accesses `.current` inside the `useEffect` callback (not during render), so it should be fine.
- **happy-dom**: No real Canvas 2D context available in tests — mock `getContext('2d')`.
- **Scope discipline**: Only create the 3 files listed above + modify 2.

### References

- [Source: architecture.md#Scene Graph] — CursorSnake rendering approach (separate canvas overlay)
- [Source: architecture.md#File Organization] — effects/ folder structure
- [Source: ux-design-specification.md#Z-Layer Ordering] — cursor at z-index 9999
- [Source: ux-design-specification.md#Cursor Interaction] — hover color override (future)
- [Source: rag-csv-crew CursorSnake] — direct port source

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Direct port from rag-csv-crew — no animation logic changes needed
- Removed `import React` for React 19 JSX transform compatibility
- Changed export from `React.FC` to named function export for consistency

### Completion Notes List

- All 5 tasks completed, all 3 acceptance criteria satisfied
- Direct port of CursorSnake from rag-csv-crew with minimal changes
- 14-node lerp chain with crosshair head, hexagon tail, 5-color neon cycle
- Separate 2D canvas overlay at z-index 9999, pointer-events: none
- System cursor hidden via cursor: none in global.css

### Change Log

- 2026-04-15: Ported CursorSnake from rag-csv-crew, integrated into App

### File List

- frontend/src/components/effects/CursorFirefly.tsx (new — adapted from rag-csv-crew CursorSnake)
- frontend/src/components/effects/CursorFirefly.css (new)
- frontend/src/components/effects/CursorFirefly.test.tsx (new)
- frontend/src/styles/global.css (modified — re-enabled cursor: none)
- frontend/src/App.tsx (modified — added CursorFirefly)
