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

interface RippleEvent {
  x: number;
  z: number;
  time: number;
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

interface PondState {
  atmosphereMode: AtmosphereMode | 'base';
  glowIntensity: number;
  viewportSize: { width: number; height: number };
  dropRipple: RippleEvent | null;
  cameraFocus: FocusTarget | null;
  activePopupTodoId: string | null;
  completingTodos: Map<string, CompletingEntry>;
  toggleAtmosphere: () => void;
  setViewportSize: (width: number, height: number) => void;
  triggerRipple: (x: number, z: number) => void;
  focusCamera: (x: number, z: number, zoom?: number) => void;
  openPopup: (todoId: string, x: number, z: number) => void;
  closePopup: () => void;
  startCompletion: (todo: Todo, creatureType: string, rarity: string) => void;
  finishCompletion: (todoId: string) => void;
}

export const usePondStore = create<PondState>((set, get) => ({
  atmosphereMode: 'base',
  glowIntensity: GLOW_INTENSITY.base,
  viewportSize: getWindowSize(),
  dropRipple: null,
  cameraFocus: null,
  activePopupTodoId: null,
  completingTodos: new Map(),

  toggleAtmosphere: () =>
    set((state) => {
      const nextIndex = (ATMOSPHERE_MODES.indexOf(state.atmosphereMode) + 1) % ATMOSPHERE_MODES.length;
      const next = ATMOSPHERE_MODES[nextIndex];
      return { atmosphereMode: next, glowIntensity: GLOW_INTENSITY[next] };
    }),

  setViewportSize: (width: number, height: number) =>
    set({ viewportSize: { width: Math.max(1, width), height: Math.max(1, height) } }),

  triggerRipple: (x: number, z: number) =>
    set({ dropRipple: { x, z, time: performance.now() / 1000 } }),

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

  finishCompletion: (todoId: string) => {
    const current = get().completingTodos;
    if (!current.has(todoId)) return;
    const next = new Map(current);
    next.delete(todoId);
    set({ completingTodos: next });
  },
}));

// Convenience selector per story 2.4 spec — consumers pass it to the hook
// as `usePondStore(selectCompleting(id))` instead of inlining the lookup.
export const selectCompleting =
  (todoId: string) =>
  (s: PondState): CompletingEntry | undefined =>
    s.completingTodos.get(todoId);
