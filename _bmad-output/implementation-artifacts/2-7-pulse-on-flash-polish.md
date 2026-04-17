# Story 2.7: Pulse-on-Flash Polish (Completion + Deletion)

Status: backlog

> Follow-up polish after [Story 2.4](./2-4-completion-via-popup-green-flash-and-dissolve.md) and [Story 2.5](./2-5-deletion-via-popup-red-flash-and-dissolve.md). The current flash on complete/delete is a flat 300ms color override with no scale change. The creation sequence has a much more tactile feel because of its `pulsing` phase (scale oscillation + rim color-lerp). This story layers the same kind of scale pulse onto the flash window for both sequences so completing and deleting feel as physical as dropping.

## Story

As a user,
I want the lily pad to pulse — not just flash — when I complete or delete it,
so that the click lands with the same tactile feel as dropping a new pad into the pond.

## Acceptance Criteria

1. **Given** an active todo's popup is open, **When** I click **Complete**, **Then** during the green flash window the pad's scale oscillates with a decaying sinusoidal pulse (same family as the creation-pulse: `scale = 1 + sin(t · ω) · amplitude · (1 - t)`), reading as a clear "thump" before the dissolve begins.

2. **Given** an active todo's popup is open, **When** I click **Delete**, **Then** during the red flash window the same scale pulse plays — identical shape, identical duration — so completion and deletion remain visually parallel.

3. **Given** the flash+pulse window is playing, **When** it ends, **Then** the group scale is exactly 1.0 at the moment the dissolve takes over (no discontinuity). The dissolve's own `scale: 1 → 0` ramp should read as continuous with the pulse's tail.

4. **Given** the pulse is playing, **When** the Bloom pass runs, **Then** the pulse's scale peak and the color flash peak are visible in the same frame (they reinforce each other — bloom picks up the brightest moment).

5. **Given** the timing budget, **When** the pulse+flash window ends, **Then** the overall sequence duration is unchanged — still ~1.6s total per story 2.4's timing table. The pulse extends the *expressiveness* of the flash window, not its duration.

6. **Given** I re-run the full test suite after this change, **When** all tests finish, **Then** every existing test remains green (no timing-assertion regressions, no new mocks needed).

## Implementation Notes

**Files likely to touch:**
- `frontend/src/components/pond/LilyPad.tsx` — the `'completing'` and `'deleting'` phase branches in `useFrame`. Layer a `group.scale.setScalar(1 + sin(flashT · ω) · amplitude · (1 - flashT))` inside the existing flash window. On flash-end, set scale back to 1.0 so the dissolve's scale ramp starts cleanly.

**Reference pattern** — the creation-pulse branch (same file, `phase === 'pulsing'`):
```ts
const wave = Math.sin(t * Math.PI * 6);
const decay = 1 - t;
group.scale.setScalar(1.0 + wave * 0.12 * decay);
```

**Design dials to pick during impl:**
- **Amplitude.** Creation uses 0.12 (12%). Flash is a briefer moment — 0.08–0.10 may read better without stealing from the dissolve. Try 0.10 first.
- **Frequency.** Creation uses `t · Math.PI · 6` — 3 full oscillations over 1.2s. For a 300ms flash window, `t · Math.PI · 4` gives ~1 full "thump" which is probably right. Two oscillations (`Math.PI · 8`) reads as a stutter — avoid.
- **Rim color pulse.** Creation also lerps rim color toward gold. For complete, lerping the rim toward `#39ff14` briefly could compound the effect; for delete, toward `#ff1744`. Try without first — the shader-uniform flash may already saturate the look.
- **Flash window duration.** Stay at 300ms unless the scale pulse feels rushed. If extending, push to 400ms max and shift `DISSOLVE_START` accordingly so total sequence stays ~1.6s. Do NOT extend the total — that breaks the shared timing with 2.4.

## Anti-Patterns to Avoid

- DO NOT add a separate pulse phase before the flash. Layer it onto the flash window. A new phase would extend total duration and force timing-table updates across 2.4 + 2.5.
- DO NOT oscillate scale during the dissolve. Scale is already being driven to 0 by the dissolve branch; a second sinusoid on top would look broken.
- DO NOT change any AC timings in stories 2.4 or 2.5. This story is purely additive polish.
- DO NOT reintroduce a creation-style "bounce on settle" for complete/delete — the dissolve is the terminal state; there's nothing to settle onto.

## References

- [Source: `frontend/src/components/pond/LilyPad.tsx` `phase === 'pulsing'` branch] — creation pulse reference
- [Source: `frontend/src/components/pond/LilyPad.tsx` `phase === 'completing'` flash window] — where to layer the complete pulse
- [Source: `frontend/src/components/pond/LilyPad.tsx` `phase === 'deleting'` flash window] — where to layer the delete pulse
- [Source: story 2.4 Timing Summary] — canonical 1.6s total sequence that this story preserves

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
