/**
 * Story 4.9: In-memory world-metadata store.
 *
 * Canonical source of spatial state (position, rotation, drift seed,
 * transient velocity) for every loaded todo. Hydrated on mount from
 * `GET /api/todos`, mutated directly by LilyPad interactions, and
 * flushed to the backend via `PATCH /api/todos/positions` on a
 * periodic cadence + on tab exit.
 *
 * All local timestamps (`lastUpdatedLocalMs`, `lastSavedAtMs`) use
 * `performance.now()` — monotonic, unaffected by wall-clock changes.
 * Never use `Date.now()` for dirty-tracking arithmetic.
 *
 * The store is deliberately separate from `usePondStore`:
 * - Different concern: spatial state vs UI state.
 * - Higher mutation volume: drag frames write every ~16 ms.
 * - Isolated subscribers: `useFrame` consumers shouldn't re-render
 *   on unrelated UI changes.
 */

import { create } from 'zustand';
import type { Todo } from '../types';

/** Per-todo world-metadata entry. */
export interface WorldEntry {
  /** Persisted fields (flush via `PATCH /api/todos/positions`). */
  positionX: number;
  positionY: number;
  rotationY: number;
  /** Persisted but immutable during session — server-assigned. */
  driftSeed: number;
  /** Transient — drift / nudge dynamics, not persisted to the backend. */
  velocityX: number;
  velocityZ: number;
  /**
   * Last local mutation time (`performance.now()`). Starts at 0 for
   * freshly-hydrated entries — dirty check is strictly `>`, so a zero
   * lastUpdated is always <= any `lastSavedAtMs`.
   */
  lastUpdatedLocalMs: number;
  /**
   * Last time this entry was known to match the server. Set on
   * hydration (mount) and on successful periodic save.
   */
  lastSavedAtMs: number;
}

/** Maximum number of todos to hold in the store at once. */
export const MAX_LOADED_TODOS = 500;

/** How often the periodic save timer fires (milliseconds). */
export const PERIODIC_SAVE_INTERVAL_MS = 300_000; // 5 minutes

interface WorldState {
  /**
   * `Map` keyed by todo id. Stored as a readonly map on the state so
   * selectors that compare identities detect replacements. Mutations
   * replace the whole map (standard Zustand immutable-update pattern).
   */
  worldMetadata: ReadonlyMap<string, WorldEntry>;

  /**
   * Bulk load at app mount. Populates every entry from scratch. Honours
   * `MAX_LOADED_TODOS` — overflow is dropped with a console.warn.
   */
  hydrateFromTodos: (todos: ReadonlyArray<Todo>) => void;

  /**
   * Apply a refetch to the existing store:
   * - Incoming todo's position overwrites a **clean** entry (server is
   *   authoritative when we haven't locally modified it).
   * - Incoming position is **ignored** for a **dirty** entry — our
   *   in-memory mutation wins until it's flushed.
   * - New ids create fresh entries (same as hydration).
   * - Ids absent from the response but present in the store are
   *   removed (soft-delete / completion fell out of renderTodos).
   */
  mergeRefetch: (todos: ReadonlyArray<Todo>) => void;

  /** Atomic position write + timestamp stamp. Creates the entry if missing. */
  setPosition: (id: string, x: number, z: number) => void;

  /** Rotation write + timestamp stamp. */
  setRotation: (id: string, rotationY: number) => void;

  /** Transient velocity write (no timestamp stamp — velocity is not persisted). */
  setVelocity: (id: string, vx: number, vz: number) => void;

  /**
   * Mark a set of entries as saved. Use the `dispatchMs` captured
   * BEFORE the save request dispatched — entries mutated during the
   * flight keep `lastUpdatedLocalMs > dispatchMs` and therefore stay
   * dirty for the next cycle.
   */
  applySaveCommit: (ids: ReadonlyArray<string>, dispatchMs: number) => void;

  /** Drop a single entry (soft-delete / removed from renderTodos). */
  removeEntry: (id: string) => void;

  /** Returns every entry with `lastUpdatedLocalMs > lastSavedAtMs`. */
  getDirtyEntries: () => Array<{ id: string; entry: WorldEntry }>;
}

function hydrateEntry(todo: Todo, nowMs: number): WorldEntry {
  return {
    positionX: todo.positionX ?? 0,
    positionY: todo.positionY ?? 0,
    rotationY: todo.rotationY,
    driftSeed: todo.driftSeed,
    velocityX: 0,
    velocityZ: 0,
    lastUpdatedLocalMs: 0,
    lastSavedAtMs: nowMs,
  };
}

/**
 * Returns a monotonically-increasing `performance.now()` value that is
 * STRICTLY greater than `against`. Guards the edge case where
 * `performance.now()` has sub-millisecond resolution that doesn't
 * advance between two synchronous calls (common in jsdom tests; rare
 * in production browsers but still possible under aggressive timer
 * throttling). Keeping the stamp strictly greater ensures the dirty
 * check (`lastUpdatedLocalMs > lastSavedAtMs`) behaves as expected.
 */
function monotonicStamp(against: number): number {
  const now = performance.now();
  return now > against ? now : against + 1;
}

function mutateEntry(
  map: ReadonlyMap<string, WorldEntry>,
  id: string,
  patch: Partial<WorldEntry>,
  stampTime: boolean,
): Map<string, WorldEntry> {
  const next = new Map(map);
  const existing = next.get(id);
  const base: WorldEntry = existing ?? {
    positionX: 0,
    positionY: 0,
    rotationY: 0,
    driftSeed: 0,
    velocityX: 0,
    velocityZ: 0,
    lastUpdatedLocalMs: 0,
    lastSavedAtMs: 0,
  };
  next.set(id, {
    ...base,
    ...patch,
    lastUpdatedLocalMs: stampTime
      ? monotonicStamp(base.lastSavedAtMs)
      : base.lastUpdatedLocalMs,
  });
  return next;
}

export const useWorldStore = create<WorldState>((set, get) => ({
  worldMetadata: new Map(),

  hydrateFromTodos: (todos) => {
    const now = performance.now();
    if (todos.length > MAX_LOADED_TODOS) {
      console.warn(
        `[useWorldStore] ${todos.length} todos received; loading the first ${MAX_LOADED_TODOS}. ${
          todos.length - MAX_LOADED_TODOS
        } todo(s) deferred (overflow).`,
      );
    }
    const capped = todos.slice(0, MAX_LOADED_TODOS);
    const next = new Map<string, WorldEntry>();
    for (const todo of capped) {
      next.set(todo.id, hydrateEntry(todo, now));
    }
    set({ worldMetadata: next });
  },

  mergeRefetch: (todos) => {
    const now = performance.now();
    const current = get().worldMetadata;
    const next = new Map<string, WorldEntry>();
    const incomingIds = new Set<string>();
    for (const todo of todos) {
      incomingIds.add(todo.id);
      const existing = current.get(todo.id);
      if (existing === undefined) {
        // New id: hydrate fresh.
        next.set(todo.id, hydrateEntry(todo, now));
        continue;
      }
      const isDirty = existing.lastUpdatedLocalMs > existing.lastSavedAtMs;
      if (isDirty) {
        // Keep in-memory position + rotation; update only drift seed
        // (server-assigned, immutable in practice — defensive copy).
        next.set(todo.id, { ...existing, driftSeed: todo.driftSeed });
      } else {
        // Clean entry: server is authoritative; overwrite position +
        // rotation + drift and bump lastSavedAtMs to now.
        next.set(todo.id, {
          ...existing,
          positionX: todo.positionX ?? existing.positionX,
          positionY: todo.positionY ?? existing.positionY,
          rotationY: todo.rotationY,
          driftSeed: todo.driftSeed,
          lastSavedAtMs: now,
        });
      }
    }
    // Entries absent from the refetch are removed.
    set({ worldMetadata: next });
    // Warning suppressed: removal is expected on soft-delete /
    // completion. No console noise.
    void incomingIds;
  },

  setPosition: (id, x, z) => {
    const current = get().worldMetadata.get(id);
    if (current !== undefined && current.positionX === x && current.positionY === z) {
      return;
    }
    set({ worldMetadata: mutateEntry(get().worldMetadata, id, { positionX: x, positionY: z }, true) });
  },

  setRotation: (id, rotationY) => {
    const current = get().worldMetadata.get(id);
    if (current !== undefined && current.rotationY === rotationY) return;
    set({ worldMetadata: mutateEntry(get().worldMetadata, id, { rotationY }, true) });
  },

  setVelocity: (id, vx, vz) => {
    const current = get().worldMetadata.get(id);
    if (current !== undefined && current.velocityX === vx && current.velocityZ === vz) {
      return;
    }
    // Velocity is transient — DO NOT stamp lastUpdatedLocalMs (stamping
    // it would mark the entry dirty even though velocity isn't saved).
    set({ worldMetadata: mutateEntry(get().worldMetadata, id, { velocityX: vx, velocityZ: vz }, false) });
  },

  applySaveCommit: (ids, dispatchMs) => {
    const current = get().worldMetadata;
    const next = new Map(current);
    for (const id of ids) {
      const entry = next.get(id);
      if (entry === undefined) continue;
      next.set(id, { ...entry, lastSavedAtMs: dispatchMs });
    }
    set({ worldMetadata: next });
  },

  removeEntry: (id) => {
    const current = get().worldMetadata;
    if (!current.has(id)) return;
    const next = new Map(current);
    next.delete(id);
    set({ worldMetadata: next });
  },

  getDirtyEntries: () => {
    const dirty: Array<{ id: string; entry: WorldEntry }> = [];
    for (const [id, entry] of get().worldMetadata) {
      if (entry.lastUpdatedLocalMs > entry.lastSavedAtMs) {
        dirty.push({ id, entry });
      }
    }
    return dirty;
  },
}));
