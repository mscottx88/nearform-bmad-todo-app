import { describe, it, expect, beforeEach } from 'vitest';
import { usePondStore } from './usePondStore';
import type { Todo } from '../types';

function makeTodo(id: string, overrides: Partial<Todo> = {}): Todo {
  return {
    id,
    text: 'test',
    completed: false,
    color: '#00eeff',
    positionX: 0,
    positionY: 0,
    embeddingStatus: 'pending',
    archived: false,
    archivedAt: null,
    deleted: false,
    deletedAt: null,
    createdAt: '2026-04-16T00:00:00Z',
    updatedAt: '2026-04-16T00:00:00Z',
    groupId: null,
    ...overrides,
  };
}

describe('usePondStore', () => {
  beforeEach(() => {
    usePondStore.setState({
      activePopupTodoId: null,
      cameraFocus: null,
      cameraResetRequestId: 0,
      pendingCameraFit: null,
      dropRipples: [],
      completingTodos: new Map(),
      deletingTodos: new Map(),
      errorTodos: new Map(),
    });
  });

  describe('atmosphere', () => {
    it('cycles atmosphere modes and updates glow intensity', () => {
      const initial = usePondStore.getState().atmosphereMode;
      usePondStore.getState().toggleAtmosphere();
      const next = usePondStore.getState().atmosphereMode;
      expect(next).not.toBe(initial);
      expect(usePondStore.getState().glowIntensity).toBeGreaterThan(0);
    });
  });

  describe('triggerRipple / dropRipples queue (story 2.9 AC #2)', () => {
    it('enqueues a ripple with world coordinates', () => {
      usePondStore.getState().triggerRipple(1, 2);
      const queue = usePondStore.getState().dropRipples;
      expect(queue).toHaveLength(1);
      expect(queue[0]).toEqual({ worldX: 1, worldZ: 2 });
    });

    it('two synchronous calls produce two queued ripples (no coalesce)', () => {
      // Pre-2.9 regression guard: the old single-slot `dropRipple` field
      // collapsed simultaneous writes into one. The queue must preserve
      // both calls so the shader can apply them to distinct slots.
      const { triggerRipple } = usePondStore.getState();
      triggerRipple(1, 2);
      triggerRipple(3, 4);
      const queue = usePondStore.getState().dropRipples;
      expect(queue).toHaveLength(2);
      expect(queue[0]).toEqual({ worldX: 1, worldZ: 2 });
      expect(queue[1]).toEqual({ worldX: 3, worldZ: 4 });
    });

    it('drainRipples empties the queue', () => {
      usePondStore.getState().triggerRipple(1, 2);
      usePondStore.getState().triggerRipple(3, 4);
      usePondStore.getState().drainRipples();
      expect(usePondStore.getState().dropRipples).toEqual([]);
    });

    it('post-drain triggerRipple starts a fresh queue', () => {
      usePondStore.getState().triggerRipple(1, 2);
      usePondStore.getState().drainRipples();
      usePondStore.getState().triggerRipple(5, 6);
      const queue = usePondStore.getState().dropRipples;
      expect(queue).toHaveLength(1);
      expect(queue[0]).toEqual({ worldX: 5, worldZ: 6 });
    });
  });

  describe('focusCamera', () => {
    it('sets cameraFocus with x, z, and zoom', () => {
      usePondStore.getState().focusCamera(3, 4, 5);
      expect(usePondStore.getState().cameraFocus).toEqual({ x: 3, z: 4, zoom: 5 });
    });
  });

  describe('requestCameraReset / clearCameraResetRequest (story 3.1 AC #4)', () => {
    const fitA = { position: [1, 2, 3] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    const fitB = { position: [4, 5, 6] as [number, number, number], target: [7, 0, 8] as [number, number, number] };

    it('bumps the counter and sets pendingCameraFit atomically', () => {
      const idBefore = usePondStore.getState().cameraResetRequestId;
      usePondStore.getState().requestCameraReset(fitA);
      const state = usePondStore.getState();
      expect(state.cameraResetRequestId).toBe(idBefore + 1);
      expect(state.pendingCameraFit).toBe(fitA);
    });

    it('second call bumps counter again and latest fit wins', () => {
      usePondStore.getState().requestCameraReset(fitA);
      usePondStore.getState().requestCameraReset(fitB);
      const state = usePondStore.getState();
      expect(state.cameraResetRequestId).toBe(2);
      expect(state.pendingCameraFit).toBe(fitB);
    });

    it('does NOT touch cameraFocus', () => {
      usePondStore.getState().focusCamera(10, 20, 30);
      const focusBefore = usePondStore.getState().cameraFocus;
      usePondStore.getState().requestCameraReset(fitA);
      expect(usePondStore.getState().cameraFocus).toEqual(focusBefore);
    });

    it('clearCameraResetRequest nulls pendingCameraFit but preserves the counter', () => {
      usePondStore.getState().requestCameraReset(fitA);
      const counterAfterRequest = usePondStore.getState().cameraResetRequestId;
      usePondStore.getState().clearCameraResetRequest();
      const state = usePondStore.getState();
      expect(state.pendingCameraFit).toBeNull();
      expect(state.cameraResetRequestId).toBe(counterAfterRequest);
    });
  });

  describe('openPopup', () => {
    it('sets activePopupTodoId and triggers cameraFocus at pad position', () => {
      usePondStore.getState().openPopup('todo-1', 2, 3);
      const state = usePondStore.getState();
      expect(state.activePopupTodoId).toBe('todo-1');
      expect(state.cameraFocus).toEqual({ x: 2, z: 3, zoom: 4 });
    });

    it('replaces the active popup when called again (auto-close prior)', () => {
      usePondStore.getState().openPopup('todo-1', 0, 0);
      usePondStore.getState().openPopup('todo-2', 5, 6);
      const state = usePondStore.getState();
      expect(state.activePopupTodoId).toBe('todo-2');
      expect(state.cameraFocus).toEqual({ x: 5, z: 6, zoom: 4 });
    });
  });

  describe('closePopup', () => {
    it('clears activePopupTodoId and cameraFocus', () => {
      usePondStore.getState().openPopup('todo-1', 1, 1);
      expect(usePondStore.getState().cameraFocus).not.toBeNull();
      usePondStore.getState().closePopup();
      const state = usePondStore.getState();
      expect(state.activePopupTodoId).toBeNull();
      expect(state.cameraFocus).toBeNull();
    });

    it('is a no-op when no popup is open', () => {
      usePondStore.getState().closePopup();
      expect(usePondStore.getState().activePopupTodoId).toBeNull();
    });
  });

  describe('startCompletion / finishCompletion', () => {
    it('startCompletion adds an entry keyed by todo id with the todo snapshot', () => {
      const todo = makeTodo('todo-1', { text: 'write report', color: '#39ff14' });
      usePondStore.getState().startCompletion(todo, 'firefly', 'common');
      const entry = usePondStore.getState().completingTodos.get('todo-1');
      expect(entry).toBeDefined();
      expect(entry?.todo).toEqual(todo);
      expect(entry?.creatureType).toBe('firefly');
      expect(entry?.rarity).toBe('common');
    });

    it('finishCompletion removes the entry', () => {
      const todo = makeTodo('todo-1');
      usePondStore.getState().startCompletion(todo, 'frog', 'uncommon');
      usePondStore.getState().finishCompletion('todo-1');
      expect(usePondStore.getState().completingTodos.has('todo-1')).toBe(false);
    });

    it('finishCompletion is a no-op when the id is not in the map', () => {
      const sizeBefore = usePondStore.getState().completingTodos.size;
      usePondStore.getState().finishCompletion('nonexistent');
      expect(usePondStore.getState().completingTodos.size).toBe(sizeBefore);
    });

    it('supports multiple concurrent completing todos', () => {
      const a = makeTodo('a');
      const b = makeTodo('b');
      usePondStore.getState().startCompletion(a, 'firefly', 'common');
      usePondStore.getState().startCompletion(b, 'golden_koi', 'legendary');
      const state = usePondStore.getState().completingTodos;
      expect(state.size).toBe(2);
      expect(state.get('a')?.rarity).toBe('common');
      expect(state.get('b')?.rarity).toBe('legendary');
    });
  });

  describe('startDeletion / finishDeletion', () => {
    it('startDeletion adds an entry keyed by todo id with the todo snapshot', () => {
      const todo = makeTodo('todo-1', { text: 'delete me', color: '#ff1744' });
      usePondStore.getState().startDeletion(todo);
      const entry = usePondStore.getState().deletingTodos.get('todo-1');
      expect(entry).toBeDefined();
      expect(entry?.todo).toEqual(todo);
      expect(entry?.startedAt).toBe(0);
    });

    it('finishDeletion removes the entry', () => {
      const todo = makeTodo('todo-1');
      usePondStore.getState().startDeletion(todo);
      usePondStore.getState().finishDeletion('todo-1');
      expect(usePondStore.getState().deletingTodos.has('todo-1')).toBe(false);
    });

    it('finishDeletion is a no-op when the id is not in the map', () => {
      const sizeBefore = usePondStore.getState().deletingTodos.size;
      usePondStore.getState().finishDeletion('nonexistent');
      expect(usePondStore.getState().deletingTodos.size).toBe(sizeBefore);
    });

    it('startDeletion is idempotent when the id is already present', () => {
      const todo = makeTodo('todo-1', { text: 'original' });
      usePondStore.getState().startDeletion(todo);
      const firstEntry = usePondStore.getState().deletingTodos.get('todo-1');
      // Second call with a mutated snapshot should NOT replace the entry.
      const mutated = makeTodo('todo-1', { text: 'mutated' });
      usePondStore.getState().startDeletion(mutated);
      const state = usePondStore.getState();
      expect(state.deletingTodos.size).toBe(1);
      expect(state.deletingTodos.get('todo-1')).toBe(firstEntry);
    });

    it('supports multiple concurrent deleting todos', () => {
      const a = makeTodo('a');
      const b = makeTodo('b');
      usePondStore.getState().startDeletion(a);
      usePondStore.getState().startDeletion(b);
      const state = usePondStore.getState().deletingTodos;
      expect(state.size).toBe(2);
    });

    it('completingTodos and deletingTodos coexist independently', () => {
      const completing = makeTodo('c');
      const deleting = makeTodo('d');
      usePondStore.getState().startCompletion(completing, 'firefly', 'common');
      usePondStore.getState().startDeletion(deleting);
      const state = usePondStore.getState();
      expect(state.completingTodos.has('c')).toBe(true);
      expect(state.deletingTodos.has('d')).toBe(true);
      expect(state.completingTodos.has('d')).toBe(false);
      expect(state.deletingTodos.has('c')).toBe(false);
    });
  });

  describe('selectDeleting selector', () => {
    it('returns the entry when the id is present', async () => {
      const { selectDeleting } = await import('./usePondStore');
      const todo = makeTodo('todo-1');
      usePondStore.getState().startDeletion(todo);
      const state = usePondStore.getState();
      expect(selectDeleting('todo-1')(state)?.todo).toEqual(todo);
    });

    it('returns undefined when the id is absent', async () => {
      const { selectDeleting } = await import('./usePondStore');
      const state = usePondStore.getState();
      expect(selectDeleting('nope')(state)).toBeUndefined();
    });
  });

  describe('setTodoError / clearTodoError', () => {
    it('setTodoError stamps an entry keyed by todo id', () => {
      const err = new Error('boom');
      usePondStore.getState().setTodoError('todo-1', 'update', err);
      const entry = usePondStore.getState().errorTodos.get('todo-1');
      expect(entry).toBeDefined();
      expect(entry?.todoId).toBe('todo-1');
      expect(entry?.operation).toBe('update');
      expect(entry?.error).toBe(err);
      expect(typeof entry?.stampedAt).toBe('number');
    });

    it('clearTodoError removes the entry', () => {
      usePondStore.getState().setTodoError('todo-1', 'delete', new Error('x'));
      usePondStore.getState().clearTodoError('todo-1');
      expect(usePondStore.getState().errorTodos.has('todo-1')).toBe(false);
    });

    it('clearTodoError is a no-op when the id is not present', () => {
      const sizeBefore = usePondStore.getState().errorTodos.size;
      usePondStore.getState().clearTodoError('nope');
      expect(usePondStore.getState().errorTodos.size).toBe(sizeBefore);
    });

    it('setTodoError called twice on the same id keeps the latest entry', () => {
      const first = new Error('first');
      const second = new Error('second');
      usePondStore.getState().setTodoError('todo-1', 'update', first);
      usePondStore.getState().setTodoError('todo-1', 'delete', second);
      const entry = usePondStore.getState().errorTodos.get('todo-1');
      expect(entry?.error).toBe(second);
      expect(entry?.operation).toBe('delete');
      expect(usePondStore.getState().errorTodos.size).toBe(1);
    });

    it('supports concurrent errors on different todos', () => {
      usePondStore.getState().setTodoError('a', 'update', new Error('a'));
      usePondStore.getState().setTodoError('b', 'delete', new Error('b'));
      const map = usePondStore.getState().errorTodos;
      expect(map.size).toBe(2);
      expect(map.get('a')?.operation).toBe('update');
      expect(map.get('b')?.operation).toBe('delete');
    });
  });

  describe('selectTodoError selector', () => {
    it('returns the entry when present', async () => {
      const { selectTodoError } = await import('./usePondStore');
      usePondStore.getState().setTodoError('todo-1', 'complete', new Error('x'));
      const state = usePondStore.getState();
      expect(selectTodoError('todo-1')(state)?.operation).toBe('complete');
    });

    it('returns undefined when absent', async () => {
      const { selectTodoError } = await import('./usePondStore');
      const state = usePondStore.getState();
      expect(selectTodoError('nope')(state)).toBeUndefined();
    });
  });

  // Story 5.3: search slices + actions.
  describe('search slices', () => {
    beforeEach(() => {
      usePondStore.setState({
        searchQuery: '',
        searchActive: false,
        searchResults: new Map(),
        searchAllMatches: false,
        vectorSearchUnavailable: false,
        cameraFocus: null,
      });
    });

    it('appendSearchChar adds the char and activates search', () => {
      usePondStore.getState().appendSearchChar('r');
      const state = usePondStore.getState();
      expect(state.searchQuery).toBe('r');
      expect(state.searchActive).toBe(true);
    });

    it('appendSearchChar accumulates multiple characters', () => {
      const { appendSearchChar } = usePondStore.getState();
      appendSearchChar('r');
      appendSearchChar('e');
      appendSearchChar('v');
      expect(usePondStore.getState().searchQuery).toBe('rev');
    });

    it('backspaceSearch drops the last character', () => {
      usePondStore.setState({ searchQuery: 'rev', searchActive: true });
      usePondStore.getState().backspaceSearch();
      expect(usePondStore.getState().searchQuery).toBe('re');
      expect(usePondStore.getState().searchActive).toBe(true);
    });

    it('backspaceSearch clears searchActive when the query empties', () => {
      usePondStore.setState({ searchQuery: 'a', searchActive: true });
      usePondStore.getState().backspaceSearch();
      const state = usePondStore.getState();
      expect(state.searchQuery).toBe('');
      expect(state.searchActive).toBe(false);
    });

    it('backspaceSearch is a no-op on empty query', () => {
      usePondStore.getState().backspaceSearch();
      expect(usePondStore.getState().searchQuery).toBe('');
      expect(usePondStore.getState().searchActive).toBe(false);
    });

    it('setSearchResults replaces the results map + flags', () => {
      const results = new Map([
        ['todo-1', { score: 0.9, matchType: 'hybrid' as const }],
      ]);
      usePondStore.getState().setSearchResults({
        results,
        allMatches: false,
        vectorUnavailable: true,
      });
      const state = usePondStore.getState();
      expect(state.searchResults.size).toBe(1);
      expect(state.searchResults.get('todo-1')?.matchType).toBe('hybrid');
      expect(state.searchAllMatches).toBe(false);
      expect(state.vectorSearchUnavailable).toBe(true);
    });

    it('clearSearch resets all five search slices and leaves cameraFocus alone', () => {
      // Invariant: search must never touch the camera in either
      // direction — not set it and not clear it. A sentinel
      // cameraFocus must survive clearSearch().
      const sentinelFocus = { x: 1, z: 2, zoom: 10 };
      usePondStore.setState({
        searchQuery: 'zebra',
        searchActive: true,
        searchResults: new Map([
          ['todo-1', { score: 0.5, matchType: 'keyword' as const }],
        ]),
        searchAllMatches: true,
        vectorSearchUnavailable: true,
        cameraFocus: sentinelFocus,
      });
      usePondStore.getState().clearSearch();
      const state = usePondStore.getState();
      expect(state.searchQuery).toBe('');
      expect(state.searchActive).toBe(false);
      expect(state.searchResults.size).toBe(0);
      expect(state.searchAllMatches).toBe(false);
      expect(state.vectorSearchUnavailable).toBe(false);
      expect(state.cameraFocus).toEqual(sentinelFocus);
    });

    it('selectSearchHit returns the hit for a matched todo', async () => {
      const { selectSearchHit } = await import('./usePondStore');
      const results = new Map([
        ['todo-1', { score: 0.8, matchType: 'semantic' as const }],
      ]);
      usePondStore.setState({ searchResults: results });
      const state = usePondStore.getState();
      expect(selectSearchHit('todo-1')(state)?.score).toBe(0.8);
      expect(selectSearchHit('todo-2')(state)).toBeUndefined();
    });
  });

  // Story 3.3: visibility slices + setVisibility action.
  describe('visibility slices (story 3.3)', () => {
    beforeEach(() => {
      usePondStore.setState({
        showActive: true,
        showCompleted: false,
        showDeleted: false,
      });
    });

    it('defaults match the PRD active-only contract', () => {
      const state = usePondStore.getState();
      expect(state.showActive).toBe(true);
      expect(state.showCompleted).toBe(false);
      expect(state.showDeleted).toBe(false);
    });

    it('setVisibility partial patch merges without touching unrelated keys', () => {
      usePondStore.getState().setVisibility({ showCompleted: true });
      const state = usePondStore.getState();
      expect(state.showActive).toBe(true);
      expect(state.showCompleted).toBe(true);
      expect(state.showDeleted).toBe(false);
    });

    it('setVisibility accepts all three keys at once', () => {
      usePondStore.getState().setVisibility({
        showActive: false,
        showCompleted: true,
        showDeleted: true,
      });
      const state = usePondStore.getState();
      expect(state.showActive).toBe(false);
      expect(state.showCompleted).toBe(true);
      expect(state.showDeleted).toBe(true);
    });

    it('setVisibility with empty patch is a no-op on values', () => {
      usePondStore.getState().setVisibility({});
      const state = usePondStore.getState();
      expect(state.showActive).toBe(true);
      expect(state.showCompleted).toBe(false);
      expect(state.showDeleted).toBe(false);
    });

    it('idempotent: applying the same patch twice leaves values unchanged', () => {
      usePondStore.getState().setVisibility({ showCompleted: true });
      usePondStore.getState().setVisibility({ showCompleted: true });
      expect(usePondStore.getState().showCompleted).toBe(true);
    });
  });

  // Story 4.2: padTargetPositions slice drives the `/spread-out`
  // animation. LilyPad reads its own entry in useFrame and clears
  // it on arrival; `/spread-out` populates the whole map.
  describe('padTargetPositions (story 4.2)', () => {
    beforeEach(() => {
      usePondStore.setState({ padTargetPositions: new Map() });
    });

    it('starts as an empty Map', () => {
      expect(usePondStore.getState().padTargetPositions.size).toBe(0);
    });

    it('setTargetPositions replaces the map wholesale', () => {
      const first = new Map<string, { x: number; z: number }>([
        ['a', { x: 1, z: 2 }],
      ]);
      usePondStore.getState().setTargetPositions(first);
      expect(usePondStore.getState().padTargetPositions.size).toBe(1);
      expect(usePondStore.getState().padTargetPositions.get('a')).toEqual({ x: 1, z: 2 });

      // A second call replaces (not merges) — `a` should be gone.
      const second = new Map<string, { x: number; z: number }>([
        ['b', { x: 3, z: 4 }],
      ]);
      usePondStore.getState().setTargetPositions(second);
      expect(usePondStore.getState().padTargetPositions.size).toBe(1);
      expect(usePondStore.getState().padTargetPositions.has('a')).toBe(false);
      expect(usePondStore.getState().padTargetPositions.get('b')).toEqual({ x: 3, z: 4 });
    });

    it('clearTargetPosition removes a single entry, leaving the rest intact', () => {
      const targets = new Map<string, { x: number; z: number }>([
        ['a', { x: 1, z: 2 }],
        ['b', { x: 3, z: 4 }],
      ]);
      usePondStore.getState().setTargetPositions(targets);
      usePondStore.getState().clearTargetPosition('a');
      const after = usePondStore.getState().padTargetPositions;
      expect(after.size).toBe(1);
      expect(after.has('a')).toBe(false);
      expect(after.get('b')).toEqual({ x: 3, z: 4 });
    });

    it('clearTargetPosition on a missing id is a no-op (does not mutate or recreate the map)', () => {
      const targets = new Map<string, { x: number; z: number }>([
        ['a', { x: 1, z: 2 }],
      ]);
      usePondStore.getState().setTargetPositions(targets);
      const beforeRef = usePondStore.getState().padTargetPositions;
      usePondStore.getState().clearTargetPosition('does-not-exist');
      // Same Map identity — no-op shortcut was taken.
      expect(usePondStore.getState().padTargetPositions).toBe(beforeRef);
    });

    // Reference the un-used helper so eslint doesn't complain — the
    // other tests in the file share `makeTodo`.
    void makeTodo;
  });

  // ─── Story 4.6: selection + cluster slices ───
  describe('togglePadSelection / clearSelection (story 4.6 AC #1–#2)', () => {
    beforeEach(() => {
      usePondStore.setState({ selectedPadIds: new Set() });
    });

    it('toggle adds an absent id', () => {
      usePondStore.getState().togglePadSelection('pad-1');
      const ids = usePondStore.getState().selectedPadIds;
      expect(ids.has('pad-1')).toBe(true);
      expect(ids.size).toBe(1);
    });

    it('toggle removes a present id (second call)', () => {
      usePondStore.getState().togglePadSelection('pad-1');
      usePondStore.getState().togglePadSelection('pad-1');
      expect(usePondStore.getState().selectedPadIds.size).toBe(0);
    });

    it('toggle preserves other selected ids', () => {
      usePondStore.getState().togglePadSelection('pad-1');
      usePondStore.getState().togglePadSelection('pad-2');
      usePondStore.getState().togglePadSelection('pad-1');
      const ids = usePondStore.getState().selectedPadIds;
      expect(ids.has('pad-2')).toBe(true);
      expect(ids.has('pad-1')).toBe(false);
    });

    it('clearSelection empties the set', () => {
      usePondStore.getState().togglePadSelection('a');
      usePondStore.getState().togglePadSelection('b');
      usePondStore.getState().clearSelection();
      expect(usePondStore.getState().selectedPadIds.size).toBe(0);
    });

    it('clearSelection on empty set is a no-op (same reference)', () => {
      const before = usePondStore.getState().selectedPadIds;
      usePondStore.getState().clearSelection();
      expect(usePondStore.getState().selectedPadIds).toBe(before);
    });
  });

  describe('setHoveredGroupId (story 4.6 AC #13)', () => {
    beforeEach(() => {
      usePondStore.setState({ hoveredGroupId: null });
    });

    it('sets a group id', () => {
      usePondStore.getState().setHoveredGroupId('g-1');
      expect(usePondStore.getState().hoveredGroupId).toBe('g-1');
    });

    it('clears on null', () => {
      usePondStore.getState().setHoveredGroupId('g-1');
      usePondStore.getState().setHoveredGroupId(null);
      expect(usePondStore.getState().hoveredGroupId).toBeNull();
    });

    it('identical re-set is a no-op (no state churn)', () => {
      usePondStore.getState().setHoveredGroupId('g-1');
      const refBefore = usePondStore.getState();
      usePondStore.getState().setHoveredGroupId('g-1');
      // Zustand preserves object identity when `set` isn't called.
      expect(usePondStore.getState()).toBe(refBefore);
    });
  });

  describe('setGroupDragTarget (story 4.6 AC #14–#17)', () => {
    beforeEach(() => {
      usePondStore.setState({ groupDragTarget: null });
    });

    it('round-trip set and clear', () => {
      const target = { groupId: 'g', anchorId: 'a', x: 1, z: 2 };
      usePondStore.getState().setGroupDragTarget(target);
      expect(usePondStore.getState().groupDragTarget).toEqual(target);
      usePondStore.getState().setGroupDragTarget(null);
      expect(usePondStore.getState().groupDragTarget).toBeNull();
    });
  });

  describe('setClusterTranslation (story 4.6 AC #23)', () => {
    beforeEach(() => {
      usePondStore.setState({ clusterTranslation: null });
    });

    it('stores the translation delta', () => {
      usePondStore.getState().setClusterTranslation({ groupId: 'g', dx: 0.5, dz: -1.2 });
      expect(usePondStore.getState().clusterTranslation).toEqual({
        groupId: 'g',
        dx: 0.5,
        dz: -1.2,
      });
    });

    it('accepts successive updates (grip phase accumulates)', () => {
      usePondStore.getState().setClusterTranslation({ groupId: 'g', dx: 0.5, dz: 0 });
      usePondStore.getState().setClusterTranslation({ groupId: 'g', dx: 1.0, dz: 0 });
      expect(usePondStore.getState().clusterTranslation?.dx).toBe(1.0);
    });
  });

  describe('firePop / clearPendingPop (story 4.6 AC #7, #18.ii, #20.ii)', () => {
    beforeEach(() => {
      usePondStore.setState({ pendingPops: new Map() });
    });

    it('firePop stamps the todoId with the given time', () => {
      usePondStore.getState().firePop('pad-1', 123.45);
      expect(usePondStore.getState().pendingPops.get('pad-1')).toBe(123.45);
    });

    it('clearPendingPop removes the entry', () => {
      usePondStore.getState().firePop('pad-1', 10);
      usePondStore.getState().clearPendingPop('pad-1');
      expect(usePondStore.getState().pendingPops.has('pad-1')).toBe(false);
    });

    it('clearPendingPop on missing id is a no-op (same Map ref)', () => {
      const before = usePondStore.getState().pendingPops;
      usePondStore.getState().clearPendingPop('nope');
      expect(usePondStore.getState().pendingPops).toBe(before);
    });
  });

  describe('addWake / expireWakes (story 4.6 AC #16)', () => {
    beforeEach(() => {
      usePondStore.setState({ wakes: [] });
    });

    it('addWake appends to the list', () => {
      const now = 1000;
      usePondStore.getState().addWake({ id: 'w1', x: 0, z: 0, angle: 0, bornAt: now });
      expect(usePondStore.getState().wakes).toHaveLength(1);
    });

    it('expireWakes drops entries older than maxAge', () => {
      usePondStore.getState().addWake({ id: 'old', x: 0, z: 0, angle: 0, bornAt: 0 });
      usePondStore.getState().addWake({ id: 'new', x: 0, z: 0, angle: 0, bornAt: 500 });
      usePondStore.getState().expireWakes(600, 400);
      const wakes = usePondStore.getState().wakes;
      expect(wakes).toHaveLength(1);
      expect(wakes[0].id).toBe('new');
    });

    it('expireWakes with nothing to expire keeps identity', () => {
      usePondStore.getState().addWake({ id: 'w', x: 0, z: 0, angle: 0, bornAt: 1000 });
      const before = usePondStore.getState().wakes;
      usePondStore.getState().expireWakes(1100, 400);
      expect(usePondStore.getState().wakes).toBe(before);
    });
  });

  describe('setGroupMeta (story 4.6 — pop-out/pop-in snapshot source)', () => {
    beforeEach(() => {
      usePondStore.setState({ groupMeta: new Map() });
    });

    it('stores a new meta map', () => {
      const meta = new Map([
        ['g1', { centroid: { x: 1, z: 2 }, R: 3, memberIds: ['a', 'b'] }],
      ]);
      usePondStore.getState().setGroupMeta(meta);
      expect(usePondStore.getState().groupMeta.get('g1')?.R).toBe(3);
    });

    it('skips the set when the shape is unchanged (identity preserved)', () => {
      const meta1 = new Map([
        ['g1', { centroid: { x: 1, z: 2 }, R: 3, memberIds: ['a', 'b'] }],
      ]);
      usePondStore.getState().setGroupMeta(meta1);
      const ref = usePondStore.getState().groupMeta;
      // Identical content in a fresh Map — should not replace the ref.
      const meta2 = new Map([
        ['g1', { centroid: { x: 1, z: 2 }, R: 3, memberIds: ['a', 'b'] }],
      ]);
      usePondStore.getState().setGroupMeta(meta2);
      expect(usePondStore.getState().groupMeta).toBe(ref);
    });

    it('updates when R changes', () => {
      const meta1 = new Map([
        ['g1', { centroid: { x: 0, z: 0 }, R: 1, memberIds: ['a'] }],
      ]);
      usePondStore.getState().setGroupMeta(meta1);
      const meta2 = new Map([
        ['g1', { centroid: { x: 0, z: 0 }, R: 2, memberIds: ['a'] }],
      ]);
      usePondStore.getState().setGroupMeta(meta2);
      expect(usePondStore.getState().groupMeta.get('g1')?.R).toBe(2);
    });
  });

  describe('setFollowTarget (story 4.6 AC #18, #20, #24)', () => {
    beforeEach(() => {
      usePondStore.setState({ followTarget: null });
    });

    it('sets a new target', () => {
      usePondStore.getState().setFollowTarget({ worldX: 5, worldZ: 7 });
      expect(usePondStore.getState().followTarget).toEqual({ worldX: 5, worldZ: 7 });
    });

    it('clearing when already null is a no-op', () => {
      const before = usePondStore.getState();
      usePondStore.getState().setFollowTarget(null);
      expect(usePondStore.getState()).toBe(before);
    });

    it('setting an identical target is a no-op', () => {
      usePondStore.getState().setFollowTarget({ worldX: 1, worldZ: 2 });
      const ref = usePondStore.getState().followTarget;
      usePondStore.getState().setFollowTarget({ worldX: 1, worldZ: 2 });
      expect(usePondStore.getState().followTarget).toBe(ref);
    });

    it('clears to null', () => {
      usePondStore.getState().setFollowTarget({ worldX: 1, worldZ: 2 });
      usePondStore.getState().setFollowTarget(null);
      expect(usePondStore.getState().followTarget).toBeNull();
    });
  });
});
