# Story 1.4: Empty Pond State & Design System

Status: done

## Story

As a user,
I want the empty pond to feel inviting with subtle ambient movement and a visual hint to start typing,
so that I know the pond is alive and discover how to add my first thought.

## Acceptance Criteria

1. **Given** no todos exist in the database, **When** the pond loads, **Then** the water surface has subtle ambient movement and glow (already implemented in Story 1.2).

2. **Given** no todos exist, **When** the pond loads, **Then** faint rippling text appears on the water surface reading "just start typing..."

3. **Given** the app is loaded, **When** inspecting CSS, **Then** neon CSS custom properties are applied (`--neon-pink`, `--neon-cyan`, `--neon-orange`, `--neon-green`, `--neon-gold`) — already implemented in Story 1.1.

4. **Given** the app is loaded, **When** inspecting fonts, **Then** Share Tech Mono is used for UI text and Inter for content text — already imported in Story 1.1.

5. **Given** the window is smaller than 800x500, **When** the app loads or the window is resized, **Then** a neon-styled message "This experience is designed for desktop" is displayed instead of the 3D scene.

## Tasks / Subtasks

- [x] Task 1: Extend design system tokens (AC: #3, #4)
  - [x] Added `--font-mono`, `--font-sans`, `--z-cursor` tokens to neon-tokens.css
  - [x] Updated global.css to use `var(--font-sans)`
  - [x] Updated CursorFirefly.css to use `var(--z-cursor)`

- [x] Task 2: Create EmptyPondHint component (AC: #2)
  - [x] Created EmptyPondHint.tsx using drei's `<Html>` at position [0, 0.1, 0]
  - [x] Brighter cyan (#80ffff) with per-character undulating ripple animation
  - [x] pointer-events: none, user-select: none

- [x] Task 3: Integrate EmptyPondHint into PondScene (AC: #2)
  - [x] Added `<EmptyPondHint />` inside the Canvas

- [x] Task 4: Create ViewportGuard component (AC: #5)
  - [x] Created ViewportGuard.tsx — reads viewportSize from usePondStore
  - [x] Shows neon fallback at <800x500 with "designed for desktop" message
  - [x] Owns the resize listener (removed from PondCamera)

- [x] Task 5: Integrate ViewportGuard into App (AC: #5)
  - [x] Wrapped PondScene + CursorFirefly inside `<ViewportGuard>` in App.tsx

- [x] Task 6: Write tests and verify (AC: #2, #5)
  - [x] EmptyPondHint.test.tsx — verifies hint text via aria-label
  - [x] ViewportGuard.test.tsx — 3 tests: large viewport, narrow, short
  - [x] Updated PondScene.test.tsx — added Html to drei mock
  - [x] All 7 tests pass across 5 files

## Dev Notes

### EmptyPondHint — drei's Html Component

Use `@react-three/drei`'s `<Html>` component (already installed). It uses CSS2DRenderer internally to project HTML into 3D world space:

```tsx
import { Html } from '@react-three/drei';

export function EmptyPondHint() {
  return (
    <Html
      position={[0, 0.1, 0]}
      center
      style={{ pointerEvents: 'none' }}
    >
      <div className="empty-hint">just start typing...</div>
    </Html>
  );
}
```

The text should feel like it's floating on the water surface. Use CSS animation for a gentle opacity pulse to create the "rippling" illusion:

```css
.empty-hint {
  font-family: var(--font-mono);
  color: var(--neon-cyan);
  font-size: 24px;
  opacity: 0.5;
  text-shadow: 0 0 10px var(--neon-cyan), 0 0 20px var(--neon-cyan);
  animation: ripple-fade 3s ease-in-out infinite;
  white-space: nowrap;
  user-select: none;
}

@keyframes ripple-fade {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.6; }
}
```

### ViewportGuard — Follows PondScene's glError Pattern

PondScene already has a neon-styled fallback div for WebGL errors. ViewportGuard uses the same visual pattern but wraps the app at a higher level:

```tsx
export function ViewportGuard({ children }: { children: React.ReactNode }) {
  const viewportSize = usePondStore((s) => s.viewportSize);
  // Wire up resize listener here (moved from PondCamera)
  
  if (viewportSize.width < 800 || viewportSize.height < 500) {
    return <div className="viewport-fallback">...</div>;
  }
  return <>{children}</>;
}
```

### Resize Listener Ownership

Currently `PondCamera.tsx` owns the resize listener that calls `usePondStore.setViewportSize`. Since `ViewportGuard` needs the viewport size BEFORE the Canvas renders (to decide whether to show the guard or the scene), the resize listener should move from `PondCamera` to `ViewportGuard`. Remove it from `PondCamera` to avoid duplicate listeners.

### Design Token Extensions

Add to `neon-tokens.css`:
```css
:root {
  /* ...existing tokens... */
  --font-mono: 'Share Tech Mono', monospace;
  --font-sans: 'Inter', sans-serif;
  --z-cursor: 9999;
}
```

Then update:
- `global.css`: `font-family: var(--font-sans);`
- `CursorFirefly.css`: `z-index: var(--z-cursor);`

### Project Structure — Files to Create/Modify

```
frontend/src/
├── components/
│   ├── ui/
│   │   ├── EmptyPondHint.tsx      # NEW
│   │   ├── EmptyPondHint.css      # NEW
│   │   ├── EmptyPondHint.test.tsx  # NEW
│   │   ├── ViewportGuard.tsx      # NEW
│   │   ├── ViewportGuard.css      # NEW
│   │   └── ViewportGuard.test.tsx # NEW
│   └── pond/
│       ├── PondScene.tsx          # MODIFY — add EmptyPondHint
│       └── PondCamera.tsx         # MODIFY — remove resize listener
├── styles/
│   ├── neon-tokens.css            # MODIFY — add font/z-index tokens
│   └── global.css                 # MODIFY — use var(--font-sans)
├── App.tsx                        # MODIFY — wrap with ViewportGuard
└── components/effects/
    └── CursorFirefly.css          # MODIFY — use var(--z-cursor)
```

### Anti-Patterns to Avoid

- DO NOT create the todo input component — that's Story 2.2
- DO NOT create the lone firefly creature — that's Epic 7 (EcosystemManager)
- DO NOT create the tutorial flow — that's a future story
- DO NOT gate EmptyPondHint on todo count — the API doesn't exist yet; always show for now
- DO NOT install new npm packages — drei's Html is already available
- DO NOT create SearchOverlay.tsx — that's Story 5.3; EmptyPondHint is a simpler standalone component for now

### Previous Story Learnings

- **React Compiler**: avoid `useMemo` with empty deps; use `useState(factory)` or module-level constants
- **happy-dom**: mock drei's `Html` component in tests (no real 3D context)
- **Named function exports**: `export function ViewportGuard()` not `React.FC`
- **DPI handling**: done in CursorFirefly; not needed here (drei's Html handles its own rendering)
- **Scope discipline**: only create files listed above

### References

- [Source: ux-design-specification.md#Empty Pond State] — "just start typing..." hint, ambient movement
- [Source: ux-design-specification.md#Responsive] — 800x500 threshold, neon fallback message
- [Source: ux-design-specification.md#Typography] — font families, sizes
- [Source: architecture.md#Rendering Strategy] — CSS2DRenderer for text on water
- [Source: architecture.md#Component Structure] — ui/ folder for overlays

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- User requested brighter hint text — changed from neon-cyan to #80ffff with higher opacity
- User requested letter undulation — split text into per-char spans with staggered animation
- User requested typewriter effect — added dual CSS animation with bright flash on appear
- PondScene test needed Html added to drei mock after EmptyPondHint integration
- ViewportGuard tests needed window.innerWidth/Height mocking via vi.stubGlobal

### Completion Notes List

- All 6 tasks completed, all 5 acceptance criteria satisfied
- Design tokens extended: --font-mono, --font-sans, --z-cursor
- EmptyPondHint: drei Html component with per-character ripple + typewriter animation
- ViewportGuard: 800x500 threshold, neon fallback, owns resize listener
- Resize listener moved from PondCamera to ViewportGuard
- 7 tests across 5 files, all passing

### Change Log

- 2026-04-15: Implemented all tasks with typewriter + ripple hint text effects

### File List

- frontend/src/styles/neon-tokens.css (modified — added font/z-index tokens)
- frontend/src/styles/global.css (modified — use var(--font-sans))
- frontend/src/components/effects/CursorFirefly.css (modified — use var(--z-cursor))
- frontend/src/components/ui/EmptyPondHint.tsx (new)
- frontend/src/components/ui/EmptyPondHint.css (new)
- frontend/src/components/ui/EmptyPondHint.test.tsx (new)
- frontend/src/components/ui/ViewportGuard.tsx (new)
- frontend/src/components/ui/ViewportGuard.css (new)
- frontend/src/components/ui/ViewportGuard.test.tsx (new)
- frontend/src/components/pond/PondScene.tsx (modified — added EmptyPondHint)
- frontend/src/components/pond/PondScene.test.tsx (modified — added Html to drei mock)
- frontend/src/components/pond/PondCamera.tsx (modified — removed resize listener)
- frontend/src/App.tsx (modified — wrapped with ViewportGuard)
