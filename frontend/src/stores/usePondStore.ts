import { create } from 'zustand';
import type { AtmosphereMode, Todo } from '../types';

const ATMOSPHERE_MODES: Array<AtmosphereMode | 'base'> = ['base', 'zen', 'cyberpunk'];

const GLOW_INTENSITY: Record<AtmosphereMode | 'base', number> = {
  base: 1.0,
  zen: 0.6,
  cyberpunk: 1.4,
};

const POPUP_FOCUS_ZOOM = 4;

const getWindowSize = () =>
  typeof window !== 'undefined'
    ? { width: window.innerWidth, height: window.innerHeight }
    : { width: 1920, height: 1080 };

// Story 2.9: ripple queue entry. Holds WORLD coordinates (matches the
// argument names on `triggerRipple(worldX, worldZ)`). The shader uses
// plane-local coords, so `WaterSurface.useFrame` flips world-Z → local-Y
// when writing into the uniform — the store never sees local coords.
//
// `time` field removed vs the pre-2.9 shape: the store no longer serves
// as a change-detection marker (the queue length and identity handle
// that). All ripple timestamps are stamped from the R3F clock inside
// `WaterSurface.useFrame` at drain time.
export interface RippleEvent {
  worldX: number;
  worldZ: number;
}

interface FocusTarget {
  x: number;
  z: number;
  zoom?: number; // target camera distance, if set
}

// A todo mid-completion-sequence. Keeps a snapshot of the todo + the
// selected creature so LilyPad can keep rendering even after the backend
// refetch drops the todo from `useTodos`. `startedAt` defaults to 0 at
// dispatch and is stamped by LilyPad's first active useFrame (R3F clock);
// it's read-only metadata from the store's perspective.
export interface CompletingEntry {
  todo: Todo;
  creatureType: string;
  rarity: string;
  startedAt: number;
}

// A todo mid-deletion-sequence. Parallel to CompletingEntry — the pad
// stays rendered via this override through the full red-flash + dissolve
// even after the backend refetch drops the todo from `useTodos`.
export interface DeletingEntry {
  todo: Todo;
  startedAt: number;
}

// Error-state entry for a todo whose most recent mutation exhausted its
// automatic retries. Drives the decay visual in LilyPad. Cleared on the
// next successful mutation for the same id.
export type TodoErrorOperation = 'update' | 'delete' | 'complete';
export interface TodoErrorEntry {
  todoId: string;
  operation: TodoErrorOperation;
  error: Error;
  stampedAt: number; // performance.now() — UI-clock, not R3F clock
}

interface PondState {
  atmosphereMode: AtmosphereMode | 'base';
  glowIntensity: number;
  viewportSize: { width: number; height: number };
  // Story 2.9: queue of pending ripples, drained FIFO by
  // `WaterSurface.useFrame` each tick. Multiple `triggerRipple` calls
  // within the same JS tick (previously coalesced into a single slot)
  // now all apply — one ripple per enqueue. `WaterSurface` reads this
  // imperatively via `usePondStore.getState()` (no subscription) to
  // avoid a re-render on every enqueue.
  dropRipples: RippleEvent[];
  cameraFocus: FocusTarget | null;
  activePopupTodoId: string | null;
  completingTodos: Map<string, CompletingEntry>;
  deletingTodos: Map<string, DeletingEntry>;
  errorTodos: Map<string, TodoErrorEntry>;
  /**
   * Story 4.1: transient per-pad color preview. Set by ActionPopup
   * while the user hovers a swatch (via `setColorPreview`); cleared
   * on unhover or commit. LilyPad reads this via `selectColorPreview`
   * to live-preview body + rim color before the user commits.
   * Session-only; not persisted.
   */
  colorPreviews: Map<string, string>;
  toggleAtmosphere: () => void;
  setViewportSize: (width: number, height: number) => void;
  /**
   * Enqueue a water ripple at world coordinates.
   *
   * @param worldX  World-space X (R3F scene coords).
   * @param worldZ  World-space Z (R3F scene coords). The WaterSurface
   *                plane is rotated -90° about X so world-Z maps to
   *                plane-local -Y; that flip happens inside WaterSurface
   *                at uniform-write time, NOT here.
   *
   * Safe to call multiple times per tick — each call enqueues a
   * distinct ripple that lands in its own shader slot.
   */
  triggerRipple: (worldX: number, worldZ: number) => void;
  /** Drain the ripple queue — called by WaterSurface after applying. */
  drainRipples: () => void;

  /**
   * Sample the water surface elevation at a world-space (x, z) point.
   * WaterSurface registers the real implementation on mount; until then
   * the default no-op returns 0 (treating the water as flat). Callers
   * can safely invoke from anywhere in the scene (LilyPad uses this to
   * ride the waves). Never allocates.
   *
   * Story 2.10.
   */
  sampleElevation: (worldX: number, worldZ: number) => number;
  /**
   * WaterSurface registers its sampler on mount via this action, and
   * resets to a no-op on unmount. Imperative pattern (not a React
   * subscription) to keep the per-frame read path allocation-free.
   */
  registerElevationSampler: (
    fn: (worldX: number, worldZ: number) => number,
  ) => void;
  /** Reset the sampler to the no-op default (called by WaterSurface unmount). */
  unregisterElevationSampler: () => void;
  focusCamera: (x: number, z: number, zoom?: number) => void;
  openPopup: (todoId: string, x: number, z: number) => void;
  closePopup: () => void;
  startCompletion: (todo: Todo, creatureType: string, rarity: string) => void;
  stampCompletionStart: (todoId: string, startedAt: number) => void;
  finishCompletion: (todoId: string) => void;
  startDeletion: (todo: Todo) => void;
  stampDeletionStart: (todoId: string, startedAt: number) => void;
  finishDeletion: (todoId: string) => void;
  setTodoError: (todoId: string, operation: TodoErrorOperation, error: Error) => void;
  clearTodoError: (todoId: string) => void;

  /**
   * Story 4.1: set or clear the color preview for a todo. Pass a
   * hex string to set; pass `null` to clear. No-op if the entry is
   * already in the desired state. Preview is session-only.
   */
  setColorPreview: (todoId: string, color: string | null) => void;
}

export const usePondStore = create<PondState>((set, get) => ({
  atmosphereMode: 'base',
  glowIntensity: GLOW_INTENSITY.base,
  viewportSize: getWindowSize(),
  dropRipples: [],
  cameraFocus: null,
  activePopupTodoId: null,
  completingTodos: new Map(),
  deletingTodos: new Map(),
  errorTodos: new Map(),
  colorPreviews: new Map(),

  toggleAtmosphere: () =>
    set((state) => {
      const nextIndex = (ATMOSPHERE_MODES.indexOf(state.atmosphereMode) + 1) % ATMOSPHERE_MODES.length;
      const next = ATMOSPHERE_MODES[nextIndex];
      return { atmosphereMode: next, glowIntensity: GLOW_INTENSITY[next] };
    }),

  setViewportSize: (width: number, height: number) =>
    set({ viewportSize: { width: Math.max(1, width), height: Math.max(1, height) } }),

  triggerRipple: (worldX: number, worldZ: number) =>
    set((state) => ({
      dropRipples: [...state.dropRipples, { worldX, worldZ }],
    })),

  drainRipples: () => set({ dropRipples: [] }),

  // Story 2.10: elevation sampler. Default is a no-op returning 0
  // (flat water) — WaterSurface overrides this on mount via
  // `registerElevationSampler`. Stored as a plain function reference
  // on state (NOT a selector-exposed value) so LilyPad.useFrame can
  // call it imperatively via `usePondStore.getState().sampleElevation`
  // without subscribing. The function itself is mutated via set().
  sampleElevation: () => 0,

  registerElevationSampler: (fn) => set({ sampleElevation: fn }),

  unregisterElevationSampler: () => set({ sampleElevation: () => 0 }),

  focusCamera: (x: number, z: number, zoom?: number) =>
    set({ cameraFocus: { x, z, zoom } }),

  openPopup: (todoId: string, x: number, z: number) => {
    set({ activePopupTodoId: todoId });
    get().focusCamera(x, z, POPUP_FOCUS_ZOOM);
  },

  closePopup: () => {
    // Also clear cameraFocus so a mid-focus-lerp dismiss doesn't keep
    // animating the camera toward a pad whose popup is already gone.
    set({ activePopupTodoId: null, cameraFocus: null });
  },

  startCompletion: (todo: Todo, creatureType: string, rarity: string) => {
    const current = get().completingTodos;
    // No-op if this todo is already mid-completion — prevents double-click or
    // double-dispatch from firing a second PATCH + second POST /creatures
    // (the latter fails on the DB's UniqueConstraint("todo_id")).
    if (current.has(todo.id)) return;
    const next = new Map(current);
    next.set(todo.id, { todo, creatureType, rarity, startedAt: 0 });
    set({ completingTodos: next });
  },

  // Called by LilyPad on the first active frame of the 'completing' phase to
  // persist the R3F-clock start time in the store. Idempotent: only stamps
  // when startedAt is still 0 so a component remount mid-sequence reads the
  // existing value instead of re-stamping (which would replay flash+ripple).
  stampCompletionStart: (todoId: string, startedAt: number) => {
    const current = get().completingTodos;
    const entry = current.get(todoId);
    if (!entry || entry.startedAt !== 0) return;
    const next = new Map(current);
    next.set(todoId, { ...entry, startedAt });
    set({ completingTodos: next });
  },

  finishCompletion: (todoId: string) => {
    const current = get().completingTodos;
    if (!current.has(todoId)) return;
    const next = new Map(current);
    next.delete(todoId);
    set({ completingTodos: next });
  },

  startDeletion: (todo: Todo) => {
    const current = get().deletingTodos;
    // Idempotent: a second dispatch for the same id is a no-op so a
    // double-click (or double-mount race) doesn't replace the snapshot
    // mid-sequence or re-fire the DELETE via the caller.
    if (current.has(todo.id)) return;
    const next = new Map(current);
    next.set(todo.id, { todo, startedAt: 0 });
    set({ deletingTodos: next });
  },

  // Parallel to stampCompletionStart — LilyPad calls this on first active
  // frame of the 'deleting' phase so remount-mid-sequence doesn't replay
  // the flash + ripple from zero.
  stampDeletionStart: (todoId: string, startedAt: number) => {
    const current = get().deletingTodos;
    const entry = current.get(todoId);
    if (!entry || entry.startedAt !== 0) return;
    const next = new Map(current);
    next.set(todoId, { ...entry, startedAt });
    set({ deletingTodos: next });
  },

  finishDeletion: (todoId: string) => {
    const current = get().deletingTodos;
    if (!current.has(todoId)) return;
    const next = new Map(current);
    next.delete(todoId);
    set({ deletingTodos: next });
  },

  setTodoError: (todoId: string, operation: TodoErrorOperation, error: Error) => {
    // Latest error wins — a fresh failure on an already-erroring pad
    // replaces the prior entry rather than accumulating history.
    const current = get().errorTodos;
    const next = new Map(current);
    next.set(todoId, {
      todoId,
      operation,
      error,
      stampedAt: performance.now(),
    });
    set({ errorTodos: next });
  },

  clearTodoError: (todoId: string) => {
    // Keyed by todoId only — intentional "latest-wins / all-ops-share-one-slot"
    // semantics. When `usePopupComplete` dispatches `useUpdateTodo` and
    // `useCreateCreature` in parallel on the same id, the hook that succeeds
    // first will clear any entry the other hook stamped. Accepted tradeoff
    // per the 2026-04-17 code-review decision (spec AC #4): one visible
    // decay per pad is sufficient UX; a partially-failed complete reads as
    // "something went wrong, click the pad to retry" regardless of which
    // half failed. If we ever need op-scoped decay, widen the key to
    // `${todoId}:${op}` and fan out the clear from each hook.
    const current = get().errorTodos;
    if (!current.has(todoId)) return;
    const next = new Map(current);
    next.delete(todoId);
    set({ errorTodos: next });
  },

  setColorPreview: (todoId: string, color: string | null) => {
    // Story 4.1: no-op when the desired state is already in place
    // (prevents unnecessary map churn on repeated hover-unhover events
    // from React's synthetic-event coalescing).
    const current = get().colorPreviews;
    if (color === null) {
      if (!current.has(todoId)) return;
      const next = new Map(current);
      next.delete(todoId);
      set({ colorPreviews: next });
    } else {
      if (current.get(todoId) === color) return;
      const next = new Map(current);
      next.set(todoId, color);
      set({ colorPreviews: next });
    }
  },
}));

// Convenience selector per story 2.4 spec — consumers pass it to the hook
// as `usePondStore(selectCompleting(id))` instead of inlining the lookup.
export const selectCompleting =
  (todoId: string) =>
  (s: PondState): CompletingEntry | undefined =>
    s.completingTodos.get(todoId);

// Parallel selector for the deletion-sequence override. Same shape as
// selectCompleting — consumers use `usePondStore(selectDeleting(id))`.
export const selectDeleting =
  (todoId: string) =>
  (s: PondState): DeletingEntry | undefined =>
    s.deletingTodos.get(todoId);

// Error-state selector. Returns the latest TodoErrorEntry for the given id
// if a mutation has exhausted its retries and not yet been retried; else
// undefined. LilyPad uses this to drive its decay visual.
export const selectTodoError =
  (todoId: string) =>
  (s: PondState): TodoErrorEntry | undefined =>
    s.errorTodos.get(todoId);

// Story 4.1: color-preview selector. LilyPad subscribes via
// `usePondStore(selectColorPreview(todo.id))` to get the currently-
// hovered swatch color (or null when nothing is being previewed).
// The subscription re-renders only when THIS pad's preview changes,
// not on every other pad's hover activity.
export const selectColorPreview =
  (todoId: string) =>
  (s: PondState): string | null =>
    s.colorPreviews.get(todoId) ?? null;
