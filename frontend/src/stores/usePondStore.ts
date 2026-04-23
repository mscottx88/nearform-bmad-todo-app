import { create } from 'zustand';
import type { AtmosphereMode, SearchHit, Todo } from '../types';
import type { CameraFit } from '../components/pond/fitCameraToPads';

const ATMOSPHERE_MODES: Array<AtmosphereMode | 'base'> = ['base', 'zen', 'cyberpunk'];

const GLOW_INTENSITY: Record<AtmosphereMode | 'base', number> = {
  base: 1.0,
  zen: 0.6,
  cyberpunk: 1.4,
};

const POPUP_FOCUS_ZOOM = 4;

// Story 5.3: type-anywhere search constants.
//
// The match-visual itself (pads lerp between SEARCH_NEUTRAL_GRAY and
// their committed colour by the match score) is implemented in
// LilyPad.tsx — no exports needed from the store for that since
// LilyPad reads the ref + SEARCH_NEUTRAL_GRAY locally. The store
// only owns the debounce window so the keyboard hook and search-sync
// hook can stay in sync on cadence.
export const SEARCH_DEBOUNCE_MS = 300;

// Mirror of the backend's `Query(max_length=500)` on `GET /api/search`.
// `appendSearchChar` enforces this client-side so key-repeat doesn't
// flood the backend with 422s (each rejection also burns the default
// React Query retry budget).
export const SEARCH_MAX_LENGTH = 500;

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
  /**
   * Story 4.6: transient per-group color preview, mirroring the per-pad
   * colorPreviews slice. Populated by ActionPopup's Group Color swatch
   * hover; cleared on unhover / commit / popup close. ClusterHalo reads
   * the previewed color in preference to the committed group color so
   * the ring lerps toward the new hue live.
   */
  groupColorPreviews: Map<string, string>;

  // Story 3.1: camera-reset slices. `cameraResetRequestId` is a
  // monotonically-increasing counter — only a *change* is the signal.
  // The counter pattern (not a boolean flag) lets two back-to-back
  // reset requests both fire fresh animations; a boolean would
  // coalesce. `pendingCameraFit` holds the computed target pose
  // consumed by PondCamera.useFrame on counter-bump and cleared on
  // animation arrival or cancellation.
  cameraResetRequestId: number;
  pendingCameraFit: CameraFit | null;

  // Story 5.3: type-anywhere search slices.
  //
  // `searchQuery` is the raw text the user has typed (not yet
  // debounced). `searchActive` mirrors `searchQuery.length > 0` as a
  // standalone flag so LilyPad can subscribe to the boolean without
  // re-rendering on every keystroke.
  //
  // `searchResults` is the derived view of the backend response —
  // Map<todo.id, SearchHit>. Absence from the map means "non-match"
  // while `searchActive`.
  //
  // `searchAllMatches` is the ftsSupported=false path: every live
  // todo is treated as a match (AC #9). Distinct from
  // `searchResults.size === totalTodos` because at ftsSupported=false
  // we DON'T know the todo list — the flag is the signal.
  //
  // `vectorSearchUnavailable` drives the "semantic search offline"
  // badge in the overlay (AC #10).
  searchQuery: string;
  searchActive: boolean;
  searchResults: Map<string, SearchHit>;
  searchAllMatches: boolean;
  vectorSearchUnavailable: boolean;

  // Story 3.3: todo-visibility flags. Default (active-only) matches
  // the PRD's primary interaction model; users opt into historical
  // view via slash commands (see frontend/src/utils/slashCommands.ts).
  // All flags live in-memory only — a reload resets to defaults.
  // See story 3.3 Dev Notes § "Why no localStorage" for the rationale.
  showActive: boolean;
  showCompleted: boolean;
  showDeleted: boolean;

  // Story 4.2: spread-out animation targets. Keyed by todo.id; value
  // is the world-space (x, z) the pad should lerp toward during the
  // spread animation. LilyPad reads its own entry imperatively in
  // useFrame and lerps position.x/z toward the target; on arrival
  // (within 0.05 world units) it fires PATCH /api/todos/{id} and
  // clears its own entry. The map is ONLY populated by the
  // `/spread-out` slash command and is empty at rest.
  padTargetPositions: Map<string, { x: number; z: number }>;

  // Story 4.6: multi-selection set for group creation. Shift/Ctrl-click
  // on a pad toggles its id in this set; the ActionPopup's Group button
  // reads `.size` to decide enabled/disabled; PondScene reads the full
  // set when the user clicks Group to POST /api/groups. Session-only.
  selectedPadIds: Set<string>;

  // Story 4.6: the group whose halo the cursor is currently inside
  // (via pointerenter on a member or hit-test against the halo circle).
  // Drives `<ClusterDragHandle>` visibility — only the hovered group's
  // handle renders. Null when the cursor is not over any group halo.
  hoveredGroupId: string | null;

  // Story 4.6: live snapshot of the pad being dragged within a group.
  // Siblings read this imperatively in useFrame to compute their
  // push-off; PondScene reads it to detect pop-out threshold crossings.
  // Null at rest and outside of grouped-member drags.
  groupDragTarget: { groupId: string; anchorId: string; x: number; z: number } | null;

  // Story 4.6: accumulated translation delta from a cluster-drag grip
  // phase. Siblings (non-handle-holder members) read this in useFrame
  // and apply the delta to their rest position. Null at rest.
  clusterTranslation: { groupId: string; dx: number; dz: number } | null;

  // Story 4.6: transient pop-animation triggers keyed by todo id.
  // Value is the R3F-clock time at which the pop was fired. LilyPad
  // reads its own entry in useFrame, applies the 150ms scale pulse,
  // and self-expires (calls `clearPendingPop`) after the animation
  // completes.
  pendingPops: Map<string, number>;

  // Story 4.6: directional wake emission queue. LilyPad enqueues during
  // grouped-pad drag; WaterSurface drains each frame and stamps the
  // entry into a shader wake slot (motion-aligned displacement in the
  // water vertex shader — no separate mesh). Shader gates lifetime via
  // elapsed-time check, so the queue is write-only from the store's
  // perspective; drainWakes empties it after a single tick.
  wakes: Array<{ id: string; x: number; z: number; angle: number; bornAt: number }>;

  // Story 4.6: per-group metadata cache — centroid + halo radius + member
  // ids — maintained by PondScene from `renderTodos`. LilyPad snapshots
  // this at drag start so pop-out (grouped-pad drag exiting its own halo)
  // and pop-in (solo-pad drag entering another group's halo) can be
  // detected without threading a members-prop through the component tree.
  groupMeta: Map<string, { centroid: { x: number; z: number }; R: number; memberIds: string[] }>;

  // Story 4.6 AC #18, #20, #24: camera-follow target during pop-out /
  // pop-in / grip-phase cluster drag. When set, PondCamera pans toward
  // the (x, z) world point each frame so the dragged pad / mouse stays
  // roughly under the cursor. Null at rest. No snap-back on clear —
  // the camera simply holds its last position per the spec.
  followTarget: { worldX: number; worldZ: number } | null;

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
  /**
   * Story 3.1: request a camera-reset animation toward `fit`. Atomically
   * bumps `cameraResetRequestId` and sets `pendingCameraFit`. PondCamera
   * reads both on counter-change. Does NOT touch `cameraFocus` — that's
   * PondCamera's responsibility to clear when it starts the reset lerp.
   */
  requestCameraReset: (fit: CameraFit) => void;
  /**
   * Story 3.1: clear `pendingCameraFit` (e.g. on animation arrival or
   * user cancellation). Does NOT decrement `cameraResetRequestId` — the
   * counter keeps its value so a subsequent request is still seen as
   * fresh by PondCamera's ref-compare.
   */
  clearCameraResetRequest: () => void;
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

  /**
   * Story 4.6: set or clear the group-color preview for a group.
   * Pass a hex string on swatch-hover, null on unhover / commit /
   * popup close. Mirrors setColorPreview's semantics (no-op when
   * already in target state) so rapid hover events don't churn.
   */
  setGroupColorPreview: (groupId: string, color: string | null) => void;

  // Story 5.3: search actions.
  /** Append a printable character to `searchQuery`. Sets `searchActive=true`. */
  appendSearchChar: (ch: string) => void;
  /** Drop the last character of `searchQuery`. Clears `searchActive` when empty. */
  backspaceSearch: () => void;
  /**
   * Replace the derived search state after a backend response arrives.
   * Pass `allMatches=true` for the ftsSupported=false path — `results`
   * may then be empty; every live todo is treated as a match.
   */
  setSearchResults: (args: {
    results: Map<string, SearchHit>;
    allMatches: boolean;
    vectorUnavailable: boolean;
  }) => void;
  /**
   * Reset the full search slice. Does NOT touch `cameraFocus` —
   * search doesn't move the camera in the first place (per user
   * directive: the pond view stays put during search so every pad
   * stays visible), so clearing wouldn't have anything to undo.
   * Called on Escape (AC #12).
   */
  clearSearch: () => void;

  /**
   * Story 3.3: merge a partial visibility patch into the store.
   * Mirrors Zustand's `set` semantics — fields omitted from `patch`
   * retain their current value. Called by the execute() closures of
   * the visibility slash commands (see visibilityCommands.ts).
   */
  setVisibility: (patch: {
    showActive?: boolean;
    showCompleted?: boolean;
    showDeleted?: boolean;
  }) => void;

  /**
   * Story 4.2: replace the full `padTargetPositions` map with a new
   * set of per-pad spread-out targets. Called by the `/spread-out`
   * command's execute() after `computeSpreadPositions` produces the
   * target map. Replacing wholesale (rather than merging) means a
   * second `/spread-out` run always supersedes the first — any pads
   * not in the new result are simply released (LilyPad's arrival
   * check naturally fires when the entry is missing).
   */
  setTargetPositions: (targets: Map<string, { x: number; z: number }>) => void;
  /**
   * Story 4.2: clear a single pad's spread-out target. Called by
   * LilyPad from its useFrame when the pad's position reaches the
   * target within the arrival threshold, OR on pointerDown when the
   * user starts dragging (drag wins over the spread target per AC
   * #12). No-op if the entry is absent.
   */
  clearTargetPosition: (todoId: string) => void;

  // Story 4.6: selection actions.
  /** Add id if absent, remove if present. Shift/Ctrl-click entry point. */
  togglePadSelection: (todoId: string) => void;
  /** Empty the selection. Called on Escape (no popup, no search active). */
  clearSelection: () => void;

  // Story 4.6: cluster-hover action.
  /** Set or clear the currently-hovered group id. Null clears. */
  setHoveredGroupId: (groupId: string | null) => void;

  // Story 4.6: member-drag target setter/clearer.
  /**
   * Update the live position of a grouped pad being dragged. Null
   * clears. Called by LilyPad on every `pointermove` during drag and
   * again on release.
   */
  setGroupDragTarget: (
    target: { groupId: string; anchorId: string; x: number; z: number } | null,
  ) => void;

  // Story 4.6: cluster-translation setter/clearer.
  /** Set the cumulative (dx, dz) offset for a cluster-handle drag. Null clears. */
  setClusterTranslation: (
    translation: { groupId: string; dx: number; dz: number } | null,
  ) => void;

  // Story 4.6: pop animation triggers.
  /**
   * Stamp `todoId` with the current time so LilyPad's `useFrame` picks
   * it up and runs the 150ms scale pulse. `firedAt` is supplied by the
   * caller (caller owns the clock — either performance.now() or the R3F
   * elapsed time, whichever the consumer uses).
   */
  firePop: (todoId: string, firedAt: number) => void;
  /** Remove the pop entry for `todoId`. Called by LilyPad when the pulse completes. */
  clearPendingPop: (todoId: string) => void;

  // Story 4.6: wake primitive.
  /** Append a wake emission. Caller stamps `bornAt` via performance.now(). */
  addWake: (wake: {
    id: string;
    x: number;
    z: number;
    angle: number;
    bornAt: number;
  }) => void;
  /** Clear the wake queue — called by WaterSurface after stamping shader slots. */
  drainWakes: () => void;

  /**
   * Story 4.6: replace the per-group metadata cache. Called by PondScene
   * whenever `renderTodos` changes so LilyPad can read current centroid +
   * radius without threading a members prop through. Identity-preserving
   * no-op when the content is unchanged by shallow key comparison.
   */
  setGroupMeta: (
    meta: Map<string, { centroid: { x: number; z: number }; R: number; memberIds: string[] }>,
  ) => void;

  /** Story 4.6 AC #18, #20, #24: set (non-null) or clear (null) the camera follow target. */
  setFollowTarget: (target: { worldX: number; worldZ: number } | null) => void;
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
  groupColorPreviews: new Map(),
  cameraResetRequestId: 0,
  pendingCameraFit: null,
  searchQuery: '',
  searchActive: false,
  searchResults: new Map(),
  searchAllMatches: false,
  vectorSearchUnavailable: false,

  showActive: true,
  showCompleted: false,
  showDeleted: false,

  padTargetPositions: new Map(),

  selectedPadIds: new Set(),
  hoveredGroupId: null,
  groupDragTarget: null,
  clusterTranslation: null,
  pendingPops: new Map(),
  wakes: [],
  groupMeta: new Map(),
  followTarget: null,

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

  requestCameraReset: (fit) =>
    set((state) => ({
      cameraResetRequestId: state.cameraResetRequestId + 1,
      pendingCameraFit: fit,
    })),

  clearCameraResetRequest: () => set({ pendingCameraFit: null }),

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

  setGroupColorPreview: (groupId: string, color: string | null) => {
    // Mirrors setColorPreview — identity-preserving no-op when the
    // desired state is already in place.
    const current = get().groupColorPreviews;
    if (color === null) {
      if (!current.has(groupId)) return;
      const next = new Map(current);
      next.delete(groupId);
      set({ groupColorPreviews: next });
    } else {
      if (current.get(groupId) === color) return;
      const next = new Map(current);
      next.set(groupId, color);
      set({ groupColorPreviews: next });
    }
  },

  // Story 5.3: search actions.
  appendSearchChar: (ch: string) =>
    set((state) => {
      // Cap at the same 500-char ceiling the backend `Query` validator
      // enforces — key-repeat (~30 keys/sec) would otherwise flood the
      // backend with 422s + React Query retry amplification past 500.
      if (state.searchQuery.length >= SEARCH_MAX_LENGTH) return state;
      const nextQuery = state.searchQuery + ch;
      // Skip writes that would leave the query as whitespace-only.
      // `useSearch`'s `query.trim().length > 0` gate blocks the fetch
      // for all-whitespace queries, which would leave the UI in limbo
      // (searchActive=true, overlay visible, no request fired, no
      // halos lit). Swallowing the char keeps the user in non-search
      // state until a real character lands.
      if (nextQuery.trim().length === 0) return state;
      return { searchQuery: nextQuery, searchActive: true };
    }),

  backspaceSearch: () =>
    set((state) => {
      if (state.searchQuery.length === 0) return state;
      const next = state.searchQuery.slice(0, -1);
      // When the query empties, reset the derived fields so
      // `searchResults` / `searchAllMatches` / `vectorSearchUnavailable`
      // don't retain stale values from the prior session. Symmetric
      // with `clearSearch` (minus the cameraFocus invariant) — keeps
      // any consumer reading `searchResults` without the `searchActive`
      // gate from seeing ghost hits.
      if (next.length === 0) {
        return {
          searchQuery: '',
          searchActive: false,
          searchResults: new Map(),
          searchAllMatches: false,
          vectorSearchUnavailable: false,
        };
      }
      return { searchQuery: next, searchActive: true };
    }),

  setSearchResults: ({ results, allMatches, vectorUnavailable }) =>
    set({
      searchResults: results,
      searchAllMatches: allMatches,
      vectorSearchUnavailable: vectorUnavailable,
    }),

  clearSearch: () =>
    set({
      searchQuery: '',
      searchActive: false,
      searchResults: new Map(),
      searchAllMatches: false,
      vectorSearchUnavailable: false,
    }),

  // Story 3.3: partial-patch merge for the three visibility flags.
  // `set({ ...patch })` with only the provided keys mirrors Zustand's
  // default shallow-merge — omitted keys retain their current value.
  setVisibility: (patch) => set(patch),

  setTargetPositions: (targets) => set({ padTargetPositions: targets }),

  clearTargetPosition: (todoId: string) => {
    const current = get().padTargetPositions;
    if (!current.has(todoId)) return;
    const next = new Map(current);
    next.delete(todoId);
    set({ padTargetPositions: next });
  },

  // Story 4.6: selection actions.
  togglePadSelection: (todoId: string) =>
    set((state) => {
      const next = new Set(state.selectedPadIds);
      if (next.has(todoId)) next.delete(todoId);
      else next.add(todoId);
      return { selectedPadIds: next };
    }),

  clearSelection: () => {
    // No-op when already empty so Escape key spam doesn't churn the
    // Set reference (every allocation triggers a re-render on
    // anything subscribed to `selectedPadIds`).
    if (get().selectedPadIds.size === 0) return;
    set({ selectedPadIds: new Set() });
  },

  setHoveredGroupId: (groupId: string | null) => {
    if (get().hoveredGroupId === groupId) return;
    set({ hoveredGroupId: groupId });
  },

  // Story 4.6: live drag-target for intra-group member drag.
  setGroupDragTarget: (target) => set({ groupDragTarget: target }),

  setClusterTranslation: (translation) => set({ clusterTranslation: translation }),

  firePop: (todoId: string, firedAt: number) =>
    set((state) => {
      const next = new Map(state.pendingPops);
      next.set(todoId, firedAt);
      return { pendingPops: next };
    }),

  clearPendingPop: (todoId: string) => {
    const current = get().pendingPops;
    if (!current.has(todoId)) return;
    const next = new Map(current);
    next.delete(todoId);
    set({ pendingPops: next });
  },

  addWake: (wake) => set((state) => ({ wakes: [...state.wakes, wake] })),

  drainWakes: () =>
    set((state) => (state.wakes.length === 0 ? state : { wakes: [] })),

  setGroupMeta: (meta) =>
    set((state) => {
      // Cheap shallow equality check: same key-set and same memberIds
      // signature skips the write so PondScene re-running its useEffect
      // without real change (React Query identity flips) doesn't churn.
      if (meta.size === state.groupMeta.size) {
        let changed = false;
        for (const [id, value] of meta) {
          const prev = state.groupMeta.get(id);
          if (
            !prev ||
            prev.R !== value.R ||
            prev.centroid.x !== value.centroid.x ||
            prev.centroid.z !== value.centroid.z ||
            prev.memberIds.length !== value.memberIds.length
          ) {
            changed = true;
            break;
          }
        }
        if (!changed) return state;
      }
      return { groupMeta: meta };
    }),

  setFollowTarget: (target) => {
    if (target === null) {
      if (get().followTarget === null) return;
      set({ followTarget: null });
      return;
    }
    const prev = get().followTarget;
    if (prev && prev.worldX === target.worldX && prev.worldZ === target.worldZ) return;
    set({ followTarget: target });
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

// Story 4.2: per-pad spread-out target selector. Returns this pad's
// target (x, z) while a `/spread-out` animation is in flight, or
// undefined when there is no target. LilyPad subscribes via this so
// only pads that *have* a target re-render on the one big map swap
// that `/spread-out` performs — subsequent per-pad clears then
// re-render only the arriving pad.
export const selectTargetPosition =
  (todoId: string) =>
  (s: PondState): { x: number; z: number } | undefined =>
    s.padTargetPositions.get(todoId);

// Story 4.6: per-pad pop trigger selector. Returns the `firedAt`
// timestamp when the pad should play its scale-pulse animation, or
// undefined when there's no pending pop. LilyPad subscribes via this
// so only the pad about to pop re-renders on firePop.
export const selectPendingPop =
  (todoId: string) =>
  (s: PondState): number | undefined =>
    s.pendingPops.get(todoId);

// Story 4.6: per-pad selection selector. Narrowly scoped so only the
// pads whose selection state changed re-render on togglePadSelection.
export const selectIsSelected =
  (todoId: string) =>
  (s: PondState): boolean =>
    s.selectedPadIds.has(todoId);

// Story 5.3: per-pad search-hit selector. Returns the SearchHit for
// this todo if the backend ranked it, else undefined. LilyPad can
// narrow its subscription to just its own hit so one pad's
// match-status change doesn't re-render every other pad. Paired
// with `searchActive` and `searchAllMatches` (read separately via
// targeted selectors or getState() inside useFrame) to compute the
// 'match' | 'nonmatch' | 'none' mode per frame.
export const selectSearchHit =
  (todoId: string) =>
  (s: PondState): SearchHit | undefined =>
    s.searchResults.get(todoId);
