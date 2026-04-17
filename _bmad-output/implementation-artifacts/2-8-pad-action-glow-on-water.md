# Story 2.8: Pad-Action Glow on Water

Status: ready-for-dev

> **Scope note:** 2.8 is a spillover polish story — not part of the original Epic 2 plan in `epics.md`. Emerged from the story 2.7 code review (2026-04-17) as a follow-up to the HDR rim/body-tint work in complete/delete/focus sequences. Michael asked "when the color intensifies during create and delete or other flashing, can the bloom effect also occur, highlighting the water nearby?" Current answer: the Bloom post-process already screen-space-blurs HDR-bright pad pixels onto the water (indiscriminate blur), but the water doesn't *respond* — no deliberate halo tied to the pad's action color. This story adds that deliberate per-pad glow source.

## Story

As a user,
I want the pond water near a flashing lily pad to glow in the pad's action color — green during Complete, red during Delete, white on click-to-focus, gold during creation —
so that bright pad moments read as the pad *illuminating* the pond, not just a screen-space blur bleeding onto water pixels.

## Acceptance Criteria

1. **Given** a pad enters the `completing` phase, **When** the pulse + body-tint sequence plays (0.0–2.0s), **Then** a circular glow source is rendered in the scene at the pad's X/Z position just above the water surface (`y ≈ 0.01`, below the pad's `y = 0.1`), facing up (`rotation.x = -Math.PI / 2`), additively blended, radius `GLOW_RADIUS = 1.8` (≈1.8× `PAD_RADIUS`) with a radial falloff that dies off to zero at the edge. Its emissive color is `COMPLETE_PAD_TINT` (HDR green) and its strength drives the `uFlashStrength` curve — cubic ease-in 0→`PAD_TINT_MAX = 0.6` across the full 2.0s — so Bloom picks it up as a soft green halo on the water that builds with the pulse and peaks as the pad disappears.

2. **Given** a pad enters the `deleting` phase, **When** the sequence plays, **Then** the glow source mirrors AC #1 with `DELETE_PAD_TINT` (HDR red) as the emissive color. Same radius, same curve, same duration, only the color differs.

3. **Given** a pad is in the `pulsing` creation phase (right after drop), **When** the 1.2s creation pulse plays, **Then** the glow source renders `CREATION_RIM_COLOR` (HDR gold) with strength driven by the same `max(0, wave) · decay` curve that drives the rim highlight — so the water glows in sync with each of the three pulse crests rather than a cubic ramp. Strength peaks at `PAD_TINT_MAX` and returns to 0 when the pulsing phase ends.

4. **Given** the user clicks a resting pad to focus it, **When** the 0.4s focus-flash fires on the rim, **Then** the glow source renders `FOCUS_RIM_COLOR` (HDR white) at a lower strength cap (`FOCUS_GLOW_MAX = 0.35`) driven by the same `(1 - flashT)` decay curve as the rim. White glow fades out with the flash — no trailing halo after `flashT >= 1`.

5. **Given** no flash/pulse is active on a pad (phase = `resting`/`waiting`/`materializing`/`forming`/`dropping`/`settling`/`completed`/`deleted`), **When** each frame runs, **Then** the glow source's strength is exactly 0 and it contributes nothing to the framebuffer. The underlying mesh may remain mounted (for ref stability) but must be visually absent.

6. **Given** the `EffectComposer` Bloom pass at `luminanceThreshold = 0.2`, **When** the glow mesh emits an HDR color with strength > ~0.1, **Then** the glow mesh pixels breach the luminance threshold and get the full bloom blur treatment — producing a soft feathered halo that extends beyond the `GLOW_RADIUS = 1.8` disc onto surrounding water. No additional postprocess pass is added.

7. **Given** the external-cancel recovery paths for completing/deleting (from story 2.7's patches), **When** a sequence is cancelled mid-pulse, **Then** the glow strength is snapped to 0 on the same frame the rim color / `uFlashStrength` uniforms are reset. No stuck/frozen glow halo.

8. **Given** the full test suite runs after this change, **When** all tests finish, **Then** every existing test remains green. The `<EffectComposer>` / `<Bloom>` stubs in `PondScene.test.tsx` already render children as passthrough — the new `<GlowSource>` mesh will pass through untouched. No new timing-sensitive tests required; the glow strength is a deterministic function of the pad's existing phase/time state.

## Tasks / Subtasks

- [ ] Task 1: Define constants + glow-color resolver in `LilyPad.tsx` (AC: #1, #2, #3, #4)
  - [ ] Add `GLOW_RADIUS = 1.8`, `GLOW_Y_OFFSET = 0.01` (just above water), `FOCUS_GLOW_MAX = 0.35` near the existing `PAD_TINT_MAX` block.
  - [ ] Derive glow state (strength + color Vector3) each frame from the active phase. Single source of truth: the same `t` values already computed inside the completing/deleting/pulsing/focus branches.

- [ ] Task 2: Create `frontend/src/components/pond/GlowSource.tsx` (AC: #1-#6)
  - [ ] Accept props: `strength: number` (0..1), `color: THREE.Vector3` (HDR), `radius: number`.
  - [ ] Render a single `<mesh>` at `[0, GLOW_Y_OFFSET, 0]` with `rotation-x={-Math.PI / 2}` (normals face up — so the additive blend layers on top of water from the camera's view).
  - [ ] Geometry: `<circleGeometry args={[radius, 48]}>` (48 segments = smooth disc).
  - [ ] Material: custom `<shaderMaterial>` with:
    - `uniforms`: `{ uColor: { value: Vector3 }, uStrength: { value: number } }`
    - `vertexShader`: pass-through `vUv` (`vUv = uv;` → standard projection).
    - `fragmentShader`: compute `float d = distance(vUv, vec2(0.5)); float falloff = 1.0 - smoothstep(0.0, 0.5, d);` then `gl_FragColor = vec4(uColor * uStrength * falloff, uStrength * falloff);`.
    - `transparent: true`, `blending: THREE.AdditiveBlending`, `depthWrite: false`, `side: THREE.DoubleSide` (pad may be flipped relative to camera).
  - [ ] Early-out: if `strength <= 0.001`, material opacity is naturally zero via the shader math — no CPU-side visibility toggle needed. Mesh stays mounted, renders a null contribution.

- [ ] Task 3: Mount `<GlowSource>` inside the LilyPad group + wire per-frame strength (AC: #1-#5, #7)
  - [ ] Add a `glowSourceRef` alongside `padMeshRef` / `rimRef`.
  - [ ] Render `<GlowSource ref={glowSourceRef} strength={0} color={new Vector3(0,0,0)} radius={GLOW_RADIUS} />` inside the `<group ref={groupRef}>` JSX, just after the pad + rim meshes.
  - [ ] In `useFrame`, alongside the existing `uFlashColor`/`uFlashStrength` uniform writes:
    - **Completing branch:** `glowUniforms.uColor.value.copy(COMPLETE_PAD_TINT)`; `glowUniforms.uStrength.value = totalT * totalT * totalT * PAD_TINT_MAX` (same cubic as `uFlashStrength`).
    - **Deleting branch:** same, with `DELETE_PAD_TINT`.
    - **Pulsing branch:** `glowUniforms.uColor.value.copy(CREATION_RIM_COLOR as Vector3)`; `glowUniforms.uStrength.value = max(0, wave) * decay * PAD_TINT_MAX`. _Note: `CREATION_RIM_COLOR` is a `THREE.Color`; convert to `Vector3(r,g,b)` or duplicate as a `CREATION_PAD_GLOW` Vector3 for shader-uniform compatibility._
    - **Focus flash branch (resting, inside `focusFlashStartRef !== null`):** `glowUniforms.uColor.value.copy(FOCUS_RIM_COLOR as Vector3)`; `glowUniforms.uStrength.value = flashDecay * FOCUS_GLOW_MAX` where `flashDecay = 1 - flashT`.
    - **All other phases / branches:** `glowUniforms.uStrength.value = 0`.

- [ ] Task 4: Snap glow to 0 in external-cancel recovery (AC: #7)
  - [ ] In both `!deleting && phase === 'deleting'` and `!completing && phase === 'completing'` recovery blocks, add `glowUniforms.uStrength.value = 0` alongside the existing `uFlashStrength`/`uFlashColor` resets.
  - [ ] Also zero on happy-path terminal transitions (`phase → 'completed'` / `'deleted'`) mirroring the 2.7 cleanup pattern.

- [ ] Task 5: Verify no regressions (AC: #6, #8)
  - [ ] `npx vitest run` — 69/69 existing tests remain green. The `EffectComposer` + `Bloom` mocks in `PondScene.test.tsx` render children as passthrough, so a new `<mesh>` inside `<LilyPad>` is invisible to happy-dom.
  - [ ] `npx tsc -b` — clean.
  - [ ] Manual browser verification:
    - [ ] Complete a todo — green halo on water builds across 2.0s, peaks at dissolve-end.
    - [ ] Delete a todo — red halo, same shape.
    - [ ] Drop a new todo — gold halo pulses in sync with three scale-pulse crests.
    - [ ] Click a resting pad — brief white halo flashes and fades with the rim.
    - [ ] Cancel mid-sequence (e.g., mutation rollback) — halo snaps out immediately, no stuck glow.

- [ ] Task 6: Tests (AC: all)
  - [ ] No new vitest unit tests added. Rationale: matches 2.7's deferred approach — `useFrame` is mocked as a no-op in `LilyPad.test.tsx`, so glow strength is never driven from JSDOM's perspective. A rendered-DOM assertion would require the same clock-advancing scaffolding deferred across 2.4/2.5/2.6/2.7. Glow strength is a pure function of existing `t` values in already-tested branches.
  - [ ] Manual browser verification is the shipping gate (same as 2.7 rim/body-tint work).

## Dev Notes

### Implementation approach — Option A (post-process radial mask)

This story is **Option A** from the 2.7 review bloom-on-water discussion. The approach: a per-pad additive-blended circle mesh above the water, driven by the same strength curves that already drive the pad's rim + body tint. The existing Bloom pass (`luminanceThreshold = 0.2` at [PondScene.tsx:170-176](frontend/src/components/pond/PondScene.tsx#L170-L176)) picks up the HDR-bright glow and blurs it into a feathered halo onto adjacent water pixels. No new post-process pass, no water-shader uniform changes.

**Option B (water-shader uniform array with per-pad point-light sampling)** is explicitly **out of scope** for this story. It may become a follow-up story if the radial-mask approach reads as flat or camera-angle-independent. Notes preserved in `_bmad-output/implementation-artifacts/deferred-work.md` under the 2.7 review.

### Why in the LilyPad group, not scene-level

The glow follows the pad's X/Z position and is visible only while the pad is mid-sequence. Keeping it as a child of the `LilyPad` group means:
- Position tracks the pad automatically via the group's transform.
- Mount/unmount lifecycle matches the pad (mounted while pad exists, unmounted on dissolve completion).
- Phase / cancel-recovery / cleanup logic lives in the same `useFrame` branches that already handle rim/body-tint — single source of truth, no cross-component plumbing via `usePondStore`.
- `<EffectComposer>` is scene-level; any mesh anywhere in the scene tree contributes to the bloom pass regardless of group depth.

### Why `y = 0.01` and not `y = 0.0`

The water plane in `WaterSurface.tsx` sits at `y = 0`. Rendering the glow at the exact same Y would trigger z-fighting flicker at grazing camera angles. `y = 0.01` puts the glow one cm above the water (scene-scale), which is below the pad's body at `y = 0.1` — so the pad visually occludes the glow's center but the disc extends beyond `PAD_RADIUS = 1.0` to the `GLOW_RADIUS = 1.8` edge, visible as a halo ringing the pad. `depthWrite: false` on the material keeps water ripple effects from being occluded when a glow is active.

### Additive blending + HDR math

With `AdditiveBlending`, `gl_FragColor` is added to the framebuffer (not alpha-composited). An HDR emissive color `(0.2, 2.0, 0.1) · strength = 0.6 · falloff = 1.0` → framebuffer gets `+(0.12, 1.2, 0.06)` at the glow center, fading to `+(0, 0, 0)` at the radius. The bloom pass samples the framebuffer at `luminanceThreshold = 0.2`; pixels with luminance > 0.2 get blurred. The green HDR contribution's luminance (≈ 0.7 per ITU-R BT.709 weights: `0.2126·0.12 + 0.7152·1.2 + 0.0722·0.06 ≈ 0.89`) easily breaches the threshold at peak strength.

### Relationship to `uFlashColor` / `uFlashStrength` on the pad shader

The glow source and the pad's body-tint shader are **parallel** effects driven by the same strength curve — they don't need to share a uniform. The pad's body tint modulates the pad's own pixels via shader mix (pad mesh's material sees `uFlashStrength` + `uFlashColor`). The glow source is a separate mesh with its own shader material (`GlowSource.tsx`). Each branch in `useFrame` writes to both in the same block to keep them visually locked together.

### Color-type normalization note

`COMPLETE_PAD_TINT` / `DELETE_PAD_TINT` are already `THREE.Vector3` (HDR-friendly). `COMPLETE_RIM_COLOR` / `DELETE_RIM_COLOR` / `CREATION_RIM_COLOR` / `FOCUS_RIM_COLOR` are `THREE.Color` instances. For the glow uniform (Vector3), use the `*_PAD_TINT` vectors for complete/delete directly; for pulsing (creation) and focus-flash, add two new Vector3 constants (`CREATION_PAD_GLOW`, `FOCUS_PAD_GLOW`) near the existing block so the useFrame hot path doesn't allocate per-frame. Initial values:
- `CREATION_PAD_GLOW = new Vector3(2.5, 1.8, 0.2)` (matches `CREATION_RIM_COLOR.setRGB` args)
- `FOCUS_PAD_GLOW = new Vector3(3.0, 3.0, 3.0)` (matches `FOCUS_RIM_COLOR`)

### Project structure — Files to Create / Modify / Delete

**New:**
- `frontend/src/components/pond/GlowSource.tsx` — additive-blended circle disc with shader material and two uniforms (`uColor`, `uStrength`). Exported as a `forwardRef<THREE.ShaderMaterial>` so `LilyPad.useFrame` can write uniforms directly (mirrors the `padMeshRef` / `rimRef` pattern).

**Modified:**
- `frontend/src/components/pond/LilyPad.tsx` —
  - Add constants `GLOW_RADIUS = 1.8`, `GLOW_Y_OFFSET = 0.01`, `FOCUS_GLOW_MAX = 0.35`, `CREATION_PAD_GLOW`, `FOCUS_PAD_GLOW`.
  - Add `glowSourceRef = useRef<THREE.ShaderMaterial>(null)` alongside existing refs.
  - Mount `<GlowSource ref={glowSourceRef} radius={GLOW_RADIUS} />` inside the `<group ref={groupRef}>` JSX.
  - In `useFrame` completing/deleting/pulsing/resting(focus-flash) branches, write `glowSourceRef.current.uniforms.uColor.value` and `glowSourceRef.current.uniforms.uStrength.value` alongside existing rim/body-tint updates.
  - In external-cancel recovery blocks and happy-path terminal transitions, set `glowSourceRef.current.uniforms.uStrength.value = 0`.

**Deleted:** none.

**Untouched (keep):**
- `backend/**` — no backend changes.
- `usePondStore.ts` — no store-shape changes; glow state is local to each `LilyPad`, derived from its existing phase/time refs.
- `WaterSurface.tsx` — no shader changes (Option A avoids this; Option B would touch it).
- `PondScene.tsx` — no `EffectComposer` / Bloom config changes; existing `luminanceThreshold = 0.2` picks up the glow automatically.
- All ripple + popup + completion timing logic from 2.4/2.5/2.6/2.7.

## Previous Story Intelligence (from Story 2.7)

Patterns that apply directly to this story:

- **Uniform-write pattern in useFrame.** 2.7's `uFlashColor` / `uFlashStrength` writes live inside the completing/deleting/pulsing branches as a single block (see [LilyPad.tsx:640-644](frontend/src/components/pond/LilyPad.tsx#L640-L644), [:721-725](frontend/src/components/pond/LilyPad.tsx#L721-L725)). Place the new `glowSourceRef` uniform writes in the same spots — keeps all per-phase visual state updates co-located.
- **External-cancel cleanup.** 2.7's code review added rim-color restore + `focusFlashPendingRef` clear + `uFlashColor` reset to both `!deleting && phase === 'deleting'` and `!completing && phase === 'completing'` blocks. This story adds `glowSourceRef.current.uniforms.uStrength.value = 0` to both blocks AND to the happy-path terminal transitions (`t >= *_TOTAL → phase = 'completed' / 'deleted'`) for symmetry.
- **HDR values through Vector3 uniforms.** 2.7 established that Vector3-typed shader uniforms carry HDR-range (>1.0) values cleanly through the bloom pass. Keep the same approach — no `setRGB` clamping, no sRGB encoding adjustments.
- **`forwardRef` on shader-material components.** The pad's inner shader material is reachable via `padMeshRef.current.material as THREE.ShaderMaterial`. For `GlowSource`, prefer exposing the material ref directly via `forwardRef` so the caller can write uniforms without the extra `.material` indirection.
- **`useFrame` / `useThree` are mocked in vitest.** `LilyPad.test.tsx` stubs `useFrame` as a no-op (see PondScene.test.tsx glob mocks for the established pattern). Any new `useFrame` writes will be invisible to JSDOM tests — matches 2.7's decision to defer useFrame-driven scale/glow assertions to a future clock-advancing test scaffolding.
- **Don't touch ripple timing.** 2.7 preserved the single `triggerRipple(posX, posZ)` call at `*_DISSOLVE_START`. This story adds no new ripples — the glow is a pure color effect, orthogonal to the water wavefront.

## Anti-Patterns to Avoid

- **DO NOT add a new postprocess pass.** The existing Bloom at `luminanceThreshold = 0.2` is sufficient. A second pass would double-bloom HDR pad pixels and read as washed-out.
- **DO NOT put the glow in `usePondStore`.** State is per-pad and already derivable from the pad's phase/time refs. A store entry would add reactive-subscription overhead and risk desyncing from the pad's local `startedAt` anchor on remount.
- **DO NOT attach the glow as a child of `WaterSurface`.** The glow follows the pad's position, not the water mesh. Attaching it to water would require scene-position math that the `LilyPad` group already handles natively.
- **DO NOT allocate per-frame Vector3 / Color objects.** Construct the four HDR Vector3 constants (`COMPLETE_PAD_TINT`, `DELETE_PAD_TINT`, `CREATION_PAD_GLOW`, `FOCUS_PAD_GLOW`) once at module scope and `.copy()` into the uniform each frame. Matches the pattern already established for `uFlashColor`.
- **DO NOT use `emissive` on a `MeshStandardMaterial`.** That requires a light source in the scene and PBR lighting math the pond doesn't use. Use a raw `ShaderMaterial` with explicit `gl_FragColor = vec4(uColor * uStrength * falloff, ...)` so HDR values pass through untouched.
- **DO NOT gate the glow mesh's mount on phase.** Conditional mount/unmount would create one extra React commit per pad per sequence; keep the mesh mounted and let `uStrength = 0` visually hide it (shader math naturally produces a transparent black output at zero strength).
- **DO NOT change `luminanceThreshold` or `intensity` on the Bloom pass.** The current config is tuned across stories 1-2; a glow-specific bloom tweak would change pad/ripple/rim bloom too. If the halo reads as too weak, raise the per-glow `PAD_TINT_MAX` cap, not the global bloom.

## Git Intelligence (last commits, most → least recent)

- `4580fde` — story 2.7 code-review follow-ups. Amended AC #4/#5, added AC #7/#8/#9 for focus-flash + popup color + CREATION_RIM_COLOR HDR. Applied 6 patches including ref-during-render fix, dead-code removal, and external-cancel hygiene. Sprint moved 2.7 → `done`. **Directly relevant** — 2.8 extends the uniform-write pattern established there.
- `68f70d4` — story 2.7 polish: added `uFlashColor` / `uFlashStrength` shader uniforms on the pad material; introduced HDR `COMPLETE_PAD_TINT` / `DELETE_PAD_TINT` Vector3 constants; focus-flash system; rainbow popup letters. **Directly relevant** — establishes the HDR-tint-via-shader-uniform pattern 2.8 reuses.
- `705def5` — story 2.7 initial implementation: creation-identical scale pulse on complete/delete, rebudgeted timings to 2.0s, HDR rim colors.
- `77f450a` — story 2.6 code-review follow-ups: `hasSeenInitialLoadRef`, `clearTodoError` unmount, per-pad decay-flicker offset. Orthogonal.
- `204c6ce` — realistic ripples + overlapping ambients in WaterSurface.tsx. **Adjacent** — the water mesh the glow sits above. No changes needed to ripple code for 2.8, but confirms the water plane's y=0 and the ripple uniforms it carries.

Net: the HDR-color + shader-uniform plumbing is fresh from 2.7. 2.8 adds one new component (`GlowSource`) and one new `useFrame` uniform-write block per phase — tight scope.

## Testing Standards

- Vitest + `@testing-library/react`, `happy-dom` environment (configured in `vite.config.ts`).
- Mock R3F `useFrame` / `useThree`; mock drei `<Html>` / `<Billboard>` as simple wrappers.
- `<EffectComposer>` and `<Bloom>` are already mocked as passthroughs in `PondScene.test.tsx` — no new mocks needed for this story.
- Test `QueryClient` with `retry: false, mutations.retry: false` via `makeTestClient()` in `PondScene.test.tsx`.
- No new useFrame clock-advancing tests required. Matches 2.7's deferred approach. If a rendered-DOM assertion for glow mount-point is feasible (e.g., `screen.getByTestId('lilypad-glow')` via a `data-testid` on the glow mesh wrapper), add it; otherwise defer.
- `npx vitest run` — all 69 existing tests remain green.
- `npx tsc -b` — clean.

## References

- [Source: `frontend/src/components/pond/LilyPad.tsx:88-98`] — existing HDR Vector3 body-tint constants (`COMPLETE_PAD_TINT`, `DELETE_PAD_TINT`, `PAD_TINT_MAX`). Extend with `CREATION_PAD_GLOW`, `FOCUS_PAD_GLOW`, `GLOW_RADIUS`, `GLOW_Y_OFFSET`, `FOCUS_GLOW_MAX`.
- [Source: `frontend/src/components/pond/LilyPad.tsx:640-644,721-725`] — existing per-phase `uFlashColor`/`uFlashStrength` uniform-write block. Mirror for `glowSourceRef`.
- [Source: `frontend/src/components/pond/LilyPad.tsx:528-575`] — external-cancel recovery blocks where the 2.7 review added rim-color restore + `focusFlashPendingRef` clear + `uFlashColor` reset. Add `glowSourceRef.current.uniforms.uStrength.value = 0` here too.
- [Source: `frontend/src/components/pond/LilyPad.tsx:592-598,686-692`] — happy-path terminal-transition blocks where the 2.7 review added `uFlashStrength` / `uFlashColor` hygiene. Same treatment for the glow uniform.
- [Source: `frontend/src/components/pond/LilyPad.tsx:820-830`] — focus-flash `flashT` / `flashDecay` computation in the resting branch. Reuse `flashDecay` directly as the glow strength multiplier (capped at `FOCUS_GLOW_MAX`).
- [Source: `frontend/src/components/pond/LilyPad.tsx:908-932`] — creation `pulsing` phase with the `wave` / `decay` / `glow` math. Reuse `Math.max(0, wave) * decay` as the creation-glow strength curve.
- [Source: `frontend/src/components/pond/PondScene.tsx:170-176`] — existing `EffectComposer` + `Bloom` config at `luminanceThreshold = 0.2`. No changes needed; confirms the threshold the glow must breach.
- [Source: `frontend/src/components/pond/PondScene.test.tsx:23-24`] — `EffectComposer` / `Bloom` mocks as passthroughs. Confirms new `<GlowSource>` meshes pass through to vitest without additional mocks.
- [Source: `_bmad-output/implementation-artifacts/2-7-pulse-on-flash-polish.md` AC #4, AC #7, AC #9] — HDR-color + uniform-write precedent set by 2.7.
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md` § "Deferred from: code review of story 2-7-pulse-on-flash-polish (2026-04-17)"] — documents Option B water-shader uniform array as an out-of-scope follow-up.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md` § "Emotional Design Principles"] — "tactile feedback on action" rationale that seeded 2.7 and now 2.8.

## Dev Agent Record

### Agent Model Used

_(to be filled on dev-story run)_

### Debug Log References

_(to be filled on dev-story run)_

### Completion Notes List

_(to be filled on dev-story run)_

### Change Log

| Date | Change |
|------|--------|
| 2026-04-17 | Story created as Epic 2 spillover from the 2.7 code review (Michael's bloom-on-water question). Scope locked to Option A (radial-mask quad) — Option B water-shader uniform array deferred to `deferred-work.md`. |

### File List

_(to be filled on dev-story run)_
