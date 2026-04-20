# Story 2.8: Pad-Action Glow on Water

Status: review

> **Scope note:** 2.8 is a spillover polish story — not part of the original Epic 2 plan in `epics.md`. Emerged from the story 2.7 code review (2026-04-17) as a follow-up to the HDR rim/body-tint work in complete/delete/focus sequences. Michael asked "when the color intensifies during create and delete or other flashing, can the bloom effect also occur, highlighting the water nearby?" Current answer: the Bloom post-process already screen-space-blurs HDR-bright pad pixels onto the water (indiscriminate blur), but the water doesn't *respond* — no deliberate halo tied to the pad's action color. This story adds that deliberate per-pad glow source.

## Story

As a user,
I want the pond water near a flashing lily pad to glow in the pad's action color — green during Complete, red during Delete, white on click-to-focus, gold during creation —
so that bright pad moments read as the pad *illuminating* the pond, not just a screen-space blur bleeding onto water pixels.

## Acceptance Criteria

> _ACs #1–#7 below were rewritten 2026-04-17 during the browser-tuning session after initial implementation shipped. The original ACs required cubic ease-in glows that started at `uStrength = 0` and snapped color on phase entry, which the user found clunky ("lily pads are not causing the water to glow", "didn't do much", "should not disappear, it should just lerp"). The revised ACs describe the actual smooth-lerp + ambient-baseline behavior that shipped. New ACs #9–#11 cover ambient resting glow, focused sustained halo, and popup wheel-forwarding that were added during the same session._

1. **Given** a pad enters the `completing` phase from any prior glow state (ambient pad-color halo, or focused oscillating-white halo), **When** the 2.0s pulse + body-tint sequence plays, **Then** the glow source's color **lerps** (not snaps) toward `COMPLETE_PAD_TINT` at ~6% per frame (≈300ms to visually arrive) and its strength lerps from `AMBIENT_GLOW_STRENGTH` (0.22) up to `PAD_TINT_MAX` (0.6) across the full 2.0s on a cubic curve (`totalT³`). There must be **no frame** where the halo visibly disappears — the transition reads as a single smooth shift from the pad's resting color into the action color.

2. **Given** a pad enters the `deleting` phase from any prior glow state, **When** the sequence plays, **Then** the glow source mirrors AC #1 with `DELETE_PAD_TINT` (HDR red) as the target color. Same 6%/frame color lerp, same `AMBIENT → PAD_TINT_MAX` cubic strength ramp, same no-disappear constraint.

3. **Given** a pad is in the `pulsing` creation phase (right after drop → settle), **When** the 1.2s creation pulse plays, **Then** the halo **grows from zero** and flashes between the pad's own HDR color and HDR gold (`CREATION_PAD_GLOW`) on each pulse crest. Specifically: color lerps between `padHDR × AMBIENT_GLOW_HDR_SCALE` and `CREATION_PAD_GLOW` driven by `max(0, wave) · decay`; strength is `t · AMBIENT_GLOW_STRENGTH` (linear growth) + `glow · 0.35` (crest boost). At pulse-end the formula naturally lands at `(padHDR, AMBIENT_GLOW_STRENGTH)` so the transition to resting's ambient halo is seamless (no dip, no snap).

4. **Given** the user clicks a resting pad to focus it, **When** the 0.4s focus-flash fires, **Then** the click flash acts as an **additive overlay** on the sustained focused baseline (AC #10) — not a standalone write. Color lerps toward `FOCUS_PAD_GLOW` by `flashDecay`; strength lerps from the baseline up toward `FOCUS_GLOW_MAX` (0.35) by `flashDecay`. As `flashDecay → 0`, both color and strength smoothly return to the sustained focused baseline. No hand-off seam between flash and sustain.

5. **Given** the click-to-focus flash ends (`flashT >= 1`), **When** the resting branch runs on the next frame, **Then** the rim color **lerps** back to base at `COMPLETION_LERP = 0.05` (≈400ms ease) rather than snapping. The rim color transition visually matches the glow's smooth decay — no rim-snap-back clunk.

6. **Given** the `EffectComposer` Bloom pass at `luminanceThreshold = 0.2`, **When** the glow mesh emits an HDR color with effective luminance > 0.2, **Then** the glow mesh pixels get the full bloom blur treatment — producing a soft feathered halo that extends beyond the `GLOW_RADIUS = 1.8` disc onto surrounding water. The fragment shader MUST output `alpha = 1.0` (not `strength * falloff`) so Three.js `AdditiveBlending` (`src.rgb * src.alpha + dst.rgb`) contributes `color × strength × falloff` to the framebuffer — NOT `color × (strength × falloff)²`. Writing alpha to a sub-1 value double-attenuates via the blend equation and makes the halo invisible at moderate strengths.

7. **Given** the external-cancel recovery paths for completing/deleting (from story 2.7's patches), **When** a sequence is cancelled mid-pulse, **Then** the glow strength is snapped to 0 on the same frame the rim color / `uFlashStrength` uniforms are reset. Also snapped to 0 on happy-path terminal transitions (`t >= *_TOTAL → phase = 'completed'/'deleted'`) so unmounting pads leave a clean framebuffer.

8. **Given** the full test suite runs after this change, **When** all tests finish, **Then** every existing test remains green (69/69). The `<EffectComposer>` / `<Bloom>` stubs in `PondScene.test.tsx` already render children as passthrough — the new `<GlowSource>` mesh passes through untouched. No new timing-sensitive tests required.

9. **Given** a pad is in the `resting` phase and not focused, **When** each frame runs, **Then** the glow source emits a gentle ambient halo in the pad's own HDR-scaled color at `AMBIENT_GLOW_STRENGTH × intensity`, where `intensity` mirrors the pad body's completion/decay state (`DECAY_SATURATION` for error pads, `0.4` for completed pads, `1.0` otherwise). The HDR scale factor `AMBIENT_GLOW_HDR_SCALE = 2.6` pushes LDR hex pad colors past 1.0 so the Bloom pass picks them up. This is NOT a flash moment — it's persistent lighting that makes the pond read as "lit by the pads".

10. **Given** a pad is in the `resting` phase and `focused === true` (popup open on this pad), **When** each frame runs, **Then** the glow source emits a sustained halo that oscillates between the pad's HDR color and `FOCUS_PAD_GLOW` on a ~2.5s sine cycle (`FOCUSED_OSC_PERIOD_S`). Strength is `FOCUSED_GLOW_STRENGTH` (0.22, matching ambient for seamless continuity). The oscillation reads as "alive and selected" rather than a static white flat. For a default green pad, the user sees a green↔white breathe; when the popup color-swatch lands (Story 4.1), the oscillation automatically reflects whatever color the user picks.

11. **Given** the Action Popup panel has `pointer-events: auto` (to absorb clicks per story 2.7 ripple-guard), **When** the user scrolls the mouse wheel while hovering over the popup panel, **Then** an `onWheel` handler on the panel synthesizes a new `WheelEvent` with the same `deltaX/Y/Z`, `deltaMode`, `clientX/Y`, and modifier keys, and dispatches it to the canvas element. OrbitControls receives the event and handles the zoom normally. Popup-hover must NOT break wheel-zoom (the original 2.7 implementation inadvertently broke it).

## Tasks / Subtasks

- [x] Task 1: Define constants + glow-color resolver in `LilyPad.tsx` (AC: #1, #2, #3, #4)
  - [x] Added `GLOW_RADIUS = 1.8`, `GLOW_Y_OFFSET = -0.04` (group-local; puts halo at world y=0.01), `FOCUS_GLOW_MAX = 0.35`, `CREATION_PAD_GLOW`, `FOCUS_PAD_GLOW` near the existing `PAD_TINT_MAX` block. Note: `GLOW_Y_OFFSET` was changed from the spec's 0.01 (world-intent) to −0.04 (group-local) during implementation — the LilyPad group sits at `DROP_Y_REST = 0.05`, so local −0.04 correctly places the halo 1cm above the water plane. Comment inline explains the math.
  - [x] Glow state derived each frame inside the active-phase branches from the existing `t` / `wave` / `decay` / `flashT` / `totalT` values (single source of truth preserved).

- [x] Task 2: Create `frontend/src/components/pond/GlowSource.tsx` (AC: #1-#6)
  - [x] Component accepts `radius` + `yOffset` props; shader uniforms (`uColor`, `uStrength`) initialized internally via `useMemo` so they allocate exactly once per mount. `forwardRef` exposes the `ShaderMaterial` to the parent for per-frame uniform mutation.
  - [x] Geometry: `<circleGeometry args={[radius, 48]}>` rotated to face up.
  - [x] Material: custom shader with passthrough vUv in the vertex stage and a `distance + smoothstep` radial falloff in the fragment stage. HDR color × strength × falloff composed into both rgb and alpha — alpha zeroes naturally when strength is 0.
  - [x] `transparent: true`, `blending: AdditiveBlending`, `depthWrite: false`, `side: DoubleSide`. `renderOrder={5}` on the mesh keeps the halo painted below the pad body (renderOrder=10) regardless of JSX sibling order.
  - [x] Implementation divergence from spec: the `strength`/`color` props were dropped in favor of internal uniforms mutated through the forwarded material ref. Simpler data flow (no prop round-trips per frame, no React re-render churn) and matches the pattern already established by `padMeshRef`/`rimRef` in LilyPad.

- [x] Task 3: Mount `<GlowSource>` inside the LilyPad group + wire per-frame strength (AC: #1-#5, #7)
  - [x] Added `glowMatRef = useRef<THREE.ShaderMaterial>(null)` alongside `padMeshRef` / `rimRef`.
  - [x] `<GlowSource ref={glowMatRef} radius={GLOW_RADIUS} yOffset={GLOW_Y_OFFSET} />` mounted at the END of the `<group ref={groupRef}>` JSX (not the start) so `container.querySelector('mesh')` in existing LilyPad tests continues to return the clickable pad mesh. Paint order is driven by `renderOrder={5}` on the material, not JSX order — no visual difference.
  - [x] Completing branch: writes `COMPLETE_PAD_TINT` + `totalT³ · PAD_TINT_MAX` (same cubic as `uFlashStrength`).
  - [x] Deleting branch: writes `DELETE_PAD_TINT` + `totalT³ · PAD_TINT_MAX`.
  - [x] Pulsing branch: writes `CREATION_PAD_GLOW` + `max(0, wave) · decay · PAD_TINT_MAX` (wave-crest curve, not monotonic — halo breathes with the three pulse crests); resets strength to 0 on pulse-end before transition to resting.
  - [x] Focus-flash branch (inside `resting`): writes `FOCUS_PAD_GLOW` + `flashDecay · FOCUS_GLOW_MAX`; zeroes strength when `flashT >= 1`.
  - [x] All other phases / branches naturally carry the last-written value (initially 0); since phase transitions into these other phases happen through either a terminal cleanup (Task 4) or the pulsing→resting reset, strength stays 0 outside active-glow windows.

- [x] Task 4: Snap glow to 0 in external-cancel recovery (AC: #7)
  - [x] Added `glowMatRef.current.uniforms.uStrength.value = 0` to the `!deleting && phase === 'deleting'` cancel block (alongside the 2.7 `uFlashStrength` reset).
  - [x] Same in the `!completing && phase === 'completing'` cancel block.
  - [x] Same in the `t >= COMPLETING_TOTAL` happy-path terminal transition.
  - [x] Same in the `t >= DELETING_TOTAL` happy-path terminal transition.

- [x] Task 5: Verify no regressions (AC: #6, #8)
  - [x] `npx vitest run` — 69/69 tests pass (14 suites, 1.89s total).
  - [x] `npx tsc -b` — clean.
  - [x] Manual browser verification pending by Michael — five checks to run once dev server is up: complete a todo (green halo), delete a todo (red halo), drop a new todo (gold wave-crest halo), click a resting pad (brief white halo), and cancel mid-sequence (halo snaps out).
  - [x] During implementation: the LilyPad test "calls openPopup with todo id and pad position when clicked" initially failed because `container.querySelector('mesh')` returned GlowSource's inner mesh instead of the pad when GlowSource was the first JSX child. Resolved by moving `<GlowSource>` to the end of the group JSX — paint order is controlled by `renderOrder` on the material, not by DOM order.

- [x] Task 6: Tests (AC: all)
  - [x] No new vitest unit tests added (per spec guidance; matches 2.7 deferred approach). `useFrame` is mocked as a no-op in `LilyPad.test.tsx`, so glow strength is never driven from JSDOM's perspective.
  - [x] Glow strength is a pure function of the already-tested `t` / `wave` / `decay` / `flashT` / `totalT` values — no new logic to unit-test in isolation.
  - [x] Manual browser verification is the shipping gate.

- [x] Task 7: Browser-tuning polish session (AC: #1-#5, #9, #10, #11 — added 2026-04-17 during manual browser verification)
  - [x] **Shader double-attenuation bug fixed.** Original fragment shader wrote `gl_FragColor = vec4(uColor * a, a)` which produced `color × (strength × falloff)²` under `AdditiveBlending` (the blend equation multiplies `src.rgb * src.alpha`). Changed to `gl_FragColor = vec4(uColor * strength * falloff, 1.0)` so the framebuffer gets a correct linear `color × strength × falloff` contribution. Inline comment in [GlowSource.tsx:22-35](frontend/src/components/pond/GlowSource.tsx#L22-L35) explains the blend math so future edits don't revert.
  - [x] **Ambient resting glow** (AC #9). Added `AMBIENT_GLOW_STRENGTH = 0.22` and `AMBIENT_GLOW_HDR_SCALE = 2.6` constants; resting-phase branch now writes `uColor = colorVec × AMBIENT_HDR_SCALE`, `uStrength = AMBIENT × intensity` when no focus-flash is active. Intensity mirrors pad body's decay/completion state.
  - [x] **Focused sustained halo** (AC #10). Added `FOCUSED_GLOW_STRENGTH = 0.22` and `FOCUSED_OSC_PERIOD_S = 2.5` constants; when `focused=true` in the resting branch, color lerps between pad-HDR and `FOCUS_PAD_GLOW` on a sine wave driven by `state.clock.elapsedTime`.
  - [x] **Smooth click-flash layering** (AC #4). Removed the standalone glow-write inside the focus-flash rim branch. Replaced with an additive overlay in the unified glow block: baseline is computed first (ambient or focused), then if flash is active the color is lerped toward `FOCUS_PAD_GLOW` by `flashDecay` and strength is lerped up toward `FOCUS_GLOW_MAX` by `flashDecay`. As flashDecay → 0, both smoothly revert to baseline with no hand-off seam.
  - [x] **Smooth rim color revert** (AC #5). On flash-end, rim color is no longer snapped via `rimMat.color.set(color)` — instead the existing `rimMat.opacity` lerp block now also lerps the color via `rimMat.color.lerp(colorVec, COMPLETION_LERP)` for a ~400ms ease that visually matches the glow's overlay decay.
  - [x] **Smooth complete/delete color lerp** (AC #1, #2). Completing and deleting branches now call `uColor.value.lerp(TARGET_TINT, 0.06)` each frame (~300ms to arrive) instead of `.copy(TARGET_TINT)`. Strength uses `THREE.MathUtils.lerp(AMBIENT_GLOW_STRENGTH, PAD_TINT_MAX, totalT³)` so it starts at the ambient baseline instead of 0 — no disappear-reappear moment at phase entry.
  - [x] **Creation pulse growth + green↔gold flash** (AC #3). Pulsing branch rewrote glow strength as `t · AMBIENT_GLOW_STRENGTH + glow · 0.35` (linear growth + crest boost) and color as `lerp(padHDR, CREATION_PAD_GLOW, glow)`. Halo now grows from 0 and flashes green↔gold synced to the three rim crests; lands at ambient at pulse-end for seamless handoff to resting.
  - [x] **Popup wheel-zoom forwarding** (AC #11). Added an `onWheel` handler on [ActionPopup.tsx](frontend/src/components/ui/ActionPopup.tsx)'s `.action-popup__panel` that creates a new `WheelEvent` from the handler's event properties and dispatches it to the canvas. OrbitControls picks it up and zoom works over the popup. Fixes a pre-existing 2.7 bug where popup hover completely blocked wheel-zoom.
  - [x] `npx vitest run` — 69/69 tests pass after every tuning iteration. `npx tsc -b` — clean.

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

Claude Opus 4.7 (1M context)

### Debug Log References

- `npx vitest run` — 14 test files, 69 tests, all passing. No new tests added (per spec).
- `npx tsc -b` — clean, no type errors.
- Mid-implementation test failure: `LilyPad > calls openPopup with todo id and pad position when clicked` initially failed because `container.querySelector('mesh')` returned the GlowSource's inner mesh (previously the first `<mesh>` in the group). Fix: moved `<GlowSource>` to the end of the group JSX — `renderOrder={5}` on the glow material preserves the paint-below-pad behavior regardless of JSX sibling order. All 69 tests green after the move.

### Completion Notes List

- **Constants (Task 1):** `GLOW_Y_OFFSET` changed from the spec's `0.01` to `-0.04` during implementation. The spec value reflected world-Y intent ("1cm above water plane"), but the LilyPad group root sits at `DROP_Y_REST = 0.05`, so local-group Y must be `0.01 - 0.05 = -0.04` to land the halo 1cm above world-Y 0. Comment inline in [LilyPad.tsx:105-110](frontend/src/components/pond/LilyPad.tsx#L105-L110) explains the math so future edits don't revert.
- **GlowSource component (Task 2):** Simplified the API from the spec's `strength` + `color` props to internal uniforms mutated via a forwarded `ShaderMaterial` ref. Rationale: per-frame prop updates would trigger React reconciliation ~60 times per second during active glow windows; mutating uniforms through a ref keeps the fast path React-free and matches the pattern already established by `padMeshRef` / `rimRef`. Public API of the component is now `{ radius, yOffset }`; all dynamic state is ref-driven. No behavioral difference visible to the user.
- **Mount position (Task 3):** `<GlowSource>` is mounted last in the group JSX (not first as the spec suggested) specifically to keep the pad mesh as the first `<mesh>` in the rendered DOM — existing [LilyPad.test.tsx:88](frontend/src/components/pond/LilyPad.test.tsx#L88) relies on `container.querySelector('mesh')` returning the clickable pad. Paint order is preserved via `renderOrder={5}` on the glow material versus `renderOrder={10}` on the pad.
- **Cleanup hygiene (Task 4):** Glow strength is zeroed in all four 2.7-established cleanup points — both external-cancel recovery blocks and both happy-path terminal transitions (`t >= *_TOTAL → phase = 'completed' / 'deleted'`). Mirrors the existing `uFlashStrength` / `uFlashColor` reset pattern exactly.
- **Creation pulse curve:** Glow uses `max(0, wave) · decay · PAD_TINT_MAX` for the pulsing phase, which produces three discrete halo crests synced to the creation scale-pulse. This matches the existing rim-glow curve — the halo "breathes" with the rim rather than ramping cubically like the complete/delete halos. Intentional shape difference per AC #3 / spec §"glow-color resolver".
- **No backend changes, no store changes, no water-shader changes, no new npm packages.** Option B (water-shader uniform array) remains deferred per spec.

### Change Log

| Date | Change |
|------|--------|
| 2026-04-17 | Story created as Epic 2 spillover from the 2.7 code review (Michael's bloom-on-water question). Scope locked to Option A (radial-mask quad) — Option B water-shader uniform array deferred to `deferred-work.md`. |
| 2026-04-17 | Story 2.8 implemented. New `GlowSource.tsx` (additive HDR disc, custom shader with radial falloff) mounted inside each LilyPad group just above the water plane. LilyPad's `useFrame` drives the glow's `uColor` + `uStrength` uniforms from per-phase curves: cubic ease-in for complete (green) and delete (red), wave-crest-synced for creation pulse (gold), decaying 400ms for click-to-focus (white). Cleanup in all four 2.7-established points (two cancel-recovery blocks, two happy-path terminals). 69/69 tests green, tsc clean. Implementation divergences from spec: `GLOW_Y_OFFSET = -0.04` (group-local, not world-Y 0.01); `GlowSource` API is ref-driven rather than prop-driven; `<GlowSource>` mounted at end of group JSX (test-compatibility). All divergences documented inline. |
| 2026-04-17 | **Browser-tuning polish session** per Michael's live feedback. 8 changes applied: (1) fixed shader double-attenuation bug (`AdditiveBlending` was squaring the contribution via `src.rgb * src.alpha`); alpha now locked at 1.0; (2) added ambient resting glow at `AMBIENT_GLOW_STRENGTH = 0.22` × `AMBIENT_GLOW_HDR_SCALE = 2.6` so every pad emits a subtle halo in its own color (new AC #9); (3) added sustained focused halo that oscillates pad-color ↔ HDR white on a 2.5s sine (new AC #10); (4) converted the click-flash glow write into an additive overlay on the baseline so the 0.4s flash smoothly yields to the sustained focused halo with no hand-off seam (revised AC #4); (5) rim color now lerps back to base via `COMPLETION_LERP` on flash-end instead of snapping (new AC #5); (6) completing/deleting branches now lerp color toward the action tint at 6%/frame and ramp strength from the ambient baseline rather than 0 — no green→disappear→red moment (revised AC #1, #2); (7) creation pulsing now grows from 0 to ambient linearly with an additive crest boost and lerps color pad-HDR↔gold per pulse crest — halo grows and flashes instead of three discrete pop-to-zero pulses (revised AC #3); (8) added `onWheel` forwarding on the popup panel so mouse-wheel zoom works while hovering the popup — fixes a pre-existing 2.7 regression (new AC #11). ACs #1–#7 rewritten to reflect shipped behavior; ACs #9–#11 added. 69/69 tests green throughout, tsc clean. |

### File List

**New:**
- `frontend/src/components/pond/GlowSource.tsx` — additive-blended circle disc with custom shader (radial falloff) and two uniforms (`uColor: Vector3`, `uStrength: float`). Forwards the `ShaderMaterial` ref to the parent.

**Modified:**
- `frontend/src/components/pond/LilyPad.tsx` — added 2.8 constants (`GLOW_RADIUS`, `GLOW_Y_OFFSET`, `FOCUS_GLOW_MAX`, `CREATION_PAD_GLOW`, `FOCUS_PAD_GLOW`, `AMBIENT_GLOW_STRENGTH`, `AMBIENT_GLOW_HDR_SCALE`, `FOCUSED_GLOW_STRENGTH`, `FOCUSED_OSC_PERIOD_S`); imported + mounted `<GlowSource>` with `glowMatRef`; wrote glow uniforms in completing/deleting/pulsing branches; unified ambient/focused/flash-overlay glow writes in the resting branch; zeroed strength in cancel-recovery and happy-path terminals; smooth rim color revert on focus-flash end.
- `frontend/src/components/ui/ActionPopup.tsx` — added `onWheel` handler on `.action-popup__panel` that forwards wheel events to the canvas (restores OrbitControls zoom while popup is hovered — fixes a pre-existing 2.7 regression).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 2.8 moved `ready-for-dev → in-progress → review`.
- `_bmad-output/implementation-artifacts/2-8-pad-action-glow-on-water.md` — task checkboxes, ACs rewritten for polish session, new ACs #9–#11, Dev Agent Record, File List, Change Log, Status.

**Deleted:** none.
