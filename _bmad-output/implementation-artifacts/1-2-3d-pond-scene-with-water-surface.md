# Story 1.2: 3D Pond Scene with Water Surface

Status: done

## Story

As a user,
I want to see a dark blue-green 3D water surface filling my entire browser viewport,
so that I experience an immersive neon pond environment from the moment the app loads.

## Acceptance Criteria

1. **Given** the app is loaded in Chrome, **When** the page finishes loading, **Then** a full-viewport Three.js canvas renders a dark blue-green water surface with subtle ripple physics and ambient neon reflections.

2. **Given** the 3D scene is rendered, **When** Bloom postprocessing is active, **Then** neon glow effects are visible on the water surface.

3. **Given** the scene is idle (no user interaction), **When** observing the water, **Then** continuous subtle wave movement is visible — the pond is never static.

4. **Given** the scene is rendered, **When** inspecting the viewport, **Then** no browser chrome, scrollbars, or native UI elements are visible — the canvas fills 100% of the viewport.

5. **Given** the scene is rendering on modern desktop hardware, **When** measuring frame rate, **Then** the scene renders at 60fps consistently.

## Tasks / Subtasks

- [x] Task 1: Create Zustand pond store (AC: #2, #3)
  - [x] Create `frontend/src/stores/usePondStore.ts` with state: `atmosphereMode` ('zen' | 'cyberpunk'), `glowIntensity` (number), `viewportSize` ({width, height})
  - [x] Implement actions: `toggleAtmosphere()`, `setViewportSize()`
  - [x] `glowIntensity` derives from `atmosphereMode`: zen=0.6, cyberpunk=1.4, default base=1.0

- [x] Task 2: Create WaterSurface component (AC: #1, #3)
  - [x] Create `frontend/src/components/pond/WaterSurface.tsx`
  - [x] Render a `PlaneGeometry` (100x100, 64x64 segments) rotated flat (rotation-x = -PI/2) — wireframe mode with additive blending
  - [x] Create a custom `ShaderMaterial` with uniforms: `uTime`, `uNeonColor`, `uGlowIntensity` — wireframe neon aesthetic (user-requested deviation from original solid surface spec)
  - [x] Vertex shader: 5-layer circular ripple displacement for organic pond ripple animation
  - [x] Fragment shader: neon cyan brightness modulated by ripple elevation + edge fade
  - [x] Use `useFrame` to update `uTime` each frame via material.uniforms
  - [x] Read `glowIntensity` from `usePondStore` to modulate shader emissive output

- [x] Task 3: Create PondCamera component (AC: #1, #4)
  - [x] Create `frontend/src/components/pond/PondCamera.tsx`
  - [x] Use `OrbitControls` from `@react-three/drei`
  - [x] Set default camera position: [0, 15, 20] looking at [0, 0, 0]
  - [x] Constrain: `maxPolarAngle=PI/2.2`, `minDistance=5`, `maxDistance=60`
  - [x] Enable `enableDamping` with `dampingFactor=0.05`
  - [x] Disable `enablePan` (full controls come in Story 3.1)
  - [x] Handle viewport resize via window event listener updating store

- [x] Task 4: Create PondScene root component (AC: #1, #2, #4, #5)
  - [x] Create `frontend/src/components/pond/PondScene.tsx`
  - [x] Render `<Canvas>` with antialias, fov=50, near=0.1, far=200
  - [x] Set canvas style: position fixed, inset 0, 100vw x 100vh
  - [x] Add black background via `<color attach="background">`
  - [x] Add `<ambientLight intensity={0.1} />` and cyan `<pointLight>`
  - [x] Render `<WaterSurface />` and `<PondCamera />`
  - [x] `<EffectComposer>` with `<Bloom>` (threshold=0.2, smoothing=0.9, intensity from store)

- [x] Task 5: Integrate PondScene into App (AC: #4)
  - [x] Update `frontend/src/App.tsx`: replaced placeholder with `<PondScene />`
  - [x] Kept `<QueryClientProvider>` wrapper
  - [x] Updated `frontend/src/App.test.tsx`: mocks PondScene, verifies it renders

- [x] Task 6: Performance validation (AC: #5)
  - [x] Verify 60fps in Chrome DevTools — confirmed by user visual check
  - [x] No allocations per frame — uniforms updated in-place via module-level object
  - [x] Canvas resizes via R3F built-in responsive sizing

## Dev Notes

### Water Surface Shader Approach

The architecture mandates "Three.js mesh + custom shader" for GPU ripple physics. Implementation approach:

1. **Geometry**: `PlaneGeometry` with sufficient segments (e.g. 128x128) for visible vertex displacement
2. **Vertex shader**: Combine multiple sine waves at different frequencies/amplitudes/directions for organic water movement. Use `uTime` uniform incremented via `useFrame`.
3. **Fragment shader**: Base color from `--water-surface` rgba(0,20,40,0.8). Add `--water-reflection` rgba(0,238,255,0.05) modulated by vertex height — higher vertices (wave peaks) get more reflection. Add emissive component driven by `uGlowIntensity` to feed the Bloom postprocessing.
4. **No external water libraries** — write the shader from scratch. Keep it simple for story 1.2 (just ambient waves, no event-driven ripples yet).

Future stories will add event-driven ripples (todo drops, searches) by passing additional uniforms (impact points, radii, ages).

### Bloom Postprocessing

Use `@react-three/postprocessing` v3.x (already installed). The `<EffectComposer>` wraps the scene and `<Bloom>` provides the neon glow:

```tsx
import { EffectComposer, Bloom } from '@react-three/postprocessing'

<EffectComposer>
  <Bloom
    luminanceThreshold={0.2}
    luminanceSmoothing={0.9}
    intensity={glowIntensity}
  />
</EffectComposer>
```

The water shader's emissive output drives what Bloom picks up. The `intensity` is read from `usePondStore.glowIntensity`.

### Atmosphere Modes (prepare but don't implement toggle UI)

Story 1.2 defaults to base atmosphere (glowIntensity=1.0). The toggle UI comes in Story 3.2. The store should support both modes now so the water shader responds to `glowIntensity` changes.

| Mode | glowIntensity | Water character |
|---|---|---|
| Base (default) | 1.0 | Normal ripple speed and glow |
| Zen | 0.6 | Slow ripples, muted glow |
| Cyberpunk | 1.4 | Active waves, bright glow |

### Color Values for Shader Uniforms

Read CSS custom properties and convert to Three.js-compatible values:

| Token | CSS Value | Three.js uniform |
|---|---|---|
| `--water-surface` | `rgba(0, 20, 40, 0.8)` | `vec3(0.0, 0.078, 0.157)` — normalized RGB |
| `--water-deep` | `rgba(0, 10, 25, 0.95)` | `vec3(0.0, 0.039, 0.098)` |
| `--water-reflection` | `rgba(0, 238, 255, 0.05)` | `vec3(0.0, 0.933, 1.0)` at 5% blend |
| `--neon-cyan` | `#00eeff` | `vec3(0.0, 0.933, 1.0)` — same as reflection |

### Component Pattern (mandatory)

From architecture: 3D components receive data via props or Zustand — never call API directly. API calls happen in hooks/api only.

```typescript
export function WaterSurface() {
  const meshRef = useRef<THREE.Mesh>(null)
  const glowIntensity = usePondStore(s => s.glowIntensity)

  useFrame((state) => {
    // Update uTime uniform each frame
    if (meshRef.current) {
      const material = meshRef.current.material as THREE.ShaderMaterial
      material.uniforms.uTime.value = state.clock.elapsedTime
      material.uniforms.uGlowIntensity.value = glowIntensity
    }
  })

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[100, 100, 128, 128]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
      />
    </mesh>
  )
}
```

### Naming Conventions

- Component files: `PascalCase.tsx` — `PondScene.tsx`, `WaterSurface.tsx`, `PondCamera.tsx`
- Store files: `camelCase.ts` — `usePondStore.ts`
- Components: PascalCase — `<PondScene />`, `<WaterSurface />`
- Zustand stores: `use{Name}Store` — `usePondStore`
- Shader strings: can be inline template literals or separate `.glsl` files — prefer inline for this story

### Testing Approach

From architecture: "3D scene testing: manual visual testing — no reliable automated testing for Three.js rendering."

- **Automated**: Test that `PondScene` mounts without errors. Mock `<Canvas>` if needed (R3F's Canvas requires WebGL context which happy-dom doesn't provide). A minimal test verifying the component renders is sufficient.
- **Manual**: Verify water appearance, ripple movement, bloom glow, and 60fps in Chrome DevTools.
- Co-locate test files: `PondScene.test.tsx` next to `PondScene.tsx`.

### Project Structure — Files to Create

```
frontend/src/
├── components/
│   └── pond/
│       ├── PondScene.tsx      # NEW — root canvas + effects
│       ├── WaterSurface.tsx   # NEW — water mesh + shader
│       └── PondCamera.tsx     # NEW — OrbitControls
├── stores/
│   └── usePondStore.ts        # NEW — pond state
└── App.tsx                    # MODIFY — replace placeholder
```

### Anti-Patterns to Avoid

- DO NOT create lily pad components — that's Story 2.2
- DO NOT create creature components — that's Epic 7
- DO NOT create the cursor snake component — that's Story 1.3
- DO NOT create the empty state text ("just start typing...") — that's Story 1.4
- DO NOT create todo input UI — that's Story 2.2
- DO NOT create any API endpoints or service layer code
- DO NOT use external water shader libraries (e.g. `three-water`, `drei Water`) — write a custom shader
- DO NOT use `useEffect` for data fetching (use React Query when needed)
- DO NOT use `any` type — use proper types or `unknown`
- DO NOT store server state in Zustand — use React Query for server state
- DO NOT install any new npm packages — everything needed is already installed

### Previous Story Learnings (from 1.1)

- **Vite 6 / Vitest 3**: Intentionally downgraded from v8/v4 for Node 22.6 compatibility. Do NOT upgrade.
- **happy-dom**: Used instead of jsdom for test environment (ESM compat). Do NOT switch back.
- **Pre-commit hooks active**: ruff, mypy, pytest, conventional commits all run on commit. Backend code must pass all.
- **Strict scope enforcement**: Code review deleted premature files (services/, schemas/). Only create files that this story explicitly requires.

### References

- [Source: architecture.md#Scene Graph] — PondScene, WaterSurface, PondCamera component specs
- [Source: architecture.md#Implementation Patterns] — 3D component pattern, Zustand store pattern
- [Source: architecture.md#File Organization] — frontend/src/components/pond/ structure
- [Source: ux-design-specification.md#Visual Design Foundation] — water surface colors, glow intensity
- [Source: ux-design-specification.md#3D Scene Architecture] — camera defaults, z-layer ordering
- [Source: ux-design-specification.md#Atmosphere Modes] — zen/cyberpunk water parameters
- [Source: prd.md#FR25] — 3D neon pond as primary interface
- [Source: prd.md#NFR1] — 60fps on modern desktop with 30+ pads

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- React Compiler flagged useMemo with empty deps — switched to module-level constant for shader uniforms
- User requested wireframe neon aesthetic instead of solid surface — rewrote shader for wireframe + additive blending
- User requested pond ripples instead of ocean waves — rewrote vertex shader with circular ripple functions
- Temporarily commented out `cursor: none` in global.css until Story 1.3 implements neon snake cursor

### Completion Notes List

- All 6 tasks completed, all 5 acceptance criteria satisfied
- Zustand store: usePondStore with atmosphere modes (base/zen/cyberpunk) and glow intensity
- WaterSurface: custom vertex/fragment shaders with circular ripple physics, wireframe rendering, additive blending
- PondCamera: OrbitControls with damping, zoom constraints, underwater prevention
- PondScene: R3F Canvas with EffectComposer + Bloom postprocessing
- App.tsx: replaced placeholder with PondScene, test updated with mock

### Change Log

- 2026-04-15: Implemented all story tasks with wireframe neon pond aesthetic

### File List

- frontend/src/stores/usePondStore.ts (new)
- frontend/src/components/pond/WaterSurface.tsx (new)
- frontend/src/components/pond/PondCamera.tsx (new)
- frontend/src/components/pond/PondScene.tsx (new)
- frontend/src/App.tsx (modified — replaced placeholder with PondScene)
- frontend/src/App.test.tsx (modified — mocks PondScene)
- frontend/src/styles/global.css (modified — cursor: none temporarily commented)
