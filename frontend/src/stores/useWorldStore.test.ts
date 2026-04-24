import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Todo } from '../types';
import {
  useWorldStore,
  MAX_LOADED_TODOS,
  PERIODIC_SAVE_INTERVAL_MS,
} from './useWorldStore';

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    text: 'test',
    completed: false,
    color: '#00ff88',
    positionX: 1,
    positionY: 2,
    rotationY: 0.5,
    driftSeed: 0.9,
    embeddingStatus: 'complete',
    archived: false,
    archivedAt: null,
    deleted: false,
    deletedAt: null,
    createdAt: '2026-04-24T00:00:00Z',
    updatedAt: '2026-04-24T00:00:00Z',
    ...overrides,
  };
}

describe('useWorldStore', () => {
  beforeEach(() => {
    // Reset store between tests.
    useWorldStore.setState({ worldMetadata: new Map() });
  });

  describe('hydrateFromTodos', () => {
    it('populates every entry from a fresh response', () => {
      const todos = [
        makeTodo({ id: 'a', positionX: 1, positionY: 2, rotationY: 0.1, driftSeed: 0.5 }),
        makeTodo({ id: 'b', positionX: 3, positionY: 4, rotationY: 0.2, driftSeed: 0.6 }),
      ];
      useWorldStore.getState().hydrateFromTodos(todos);
      const map = useWorldStore.getState().worldMetadata;
      expect(map.size).toBe(2);
      const a = map.get('a');
      expect(a?.positionX).toBe(1);
      expect(a?.positionY).toBe(2);
      expect(a?.rotationY).toBe(0.1);
      expect(a?.driftSeed).toBe(0.5);
      expect(a?.velocityX).toBe(0);
      expect(a?.velocityZ).toBe(0);
      expect(a?.lastUpdatedLocalMs).toBe(0);
      expect(a?.lastSavedAtMs).toBeGreaterThan(0);
    });

    it('treats null positions as 0', () => {
      useWorldStore
        .getState()
        .hydrateFromTodos([makeTodo({ positionX: null, positionY: null })]);
      const entry = useWorldStore.getState().worldMetadata.get('t1');
      expect(entry?.positionX).toBe(0);
      expect(entry?.positionY).toBe(0);
    });

    it('caps at MAX_LOADED_TODOS and warns on overflow', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const todos = Array.from({ length: MAX_LOADED_TODOS + 3 }, (_, i) =>
        makeTodo({ id: `t-${i}` }),
      );
      useWorldStore.getState().hydrateFromTodos(todos);
      expect(useWorldStore.getState().worldMetadata.size).toBe(MAX_LOADED_TODOS);
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/3 todo\(s\) deferred/),
      );
      warn.mockRestore();
    });
  });

  describe('mergeRefetch', () => {
    beforeEach(() => {
      useWorldStore
        .getState()
        .hydrateFromTodos([makeTodo({ id: 'a', positionX: 1, positionY: 2 })]);
    });

    it('overwrites position on a clean entry', () => {
      // Fresh hydration → clean entry.
      useWorldStore.getState().mergeRefetch([
        makeTodo({ id: 'a', positionX: 10, positionY: 20 }),
      ]);
      const entry = useWorldStore.getState().worldMetadata.get('a');
      expect(entry?.positionX).toBe(10);
      expect(entry?.positionY).toBe(20);
    });

    it('protects position on a dirty entry', () => {
      // Mutate locally → dirty.
      useWorldStore.getState().setPosition('a', 5, 6);
      useWorldStore.getState().mergeRefetch([
        makeTodo({ id: 'a', positionX: 10, positionY: 20, driftSeed: 0.99 }),
      ]);
      const entry = useWorldStore.getState().worldMetadata.get('a');
      expect(entry?.positionX).toBe(5);
      expect(entry?.positionY).toBe(6);
      // Drift seed IS accepted even on dirty entries (server-assigned).
      expect(entry?.driftSeed).toBe(0.99);
    });

    it('creates fresh entry for ids new to the store', () => {
      useWorldStore.getState().mergeRefetch([
        makeTodo({ id: 'a', positionX: 1, positionY: 2 }),
        makeTodo({ id: 'new', positionX: 7, positionY: 8 }),
      ]);
      const fresh = useWorldStore.getState().worldMetadata.get('new');
      expect(fresh?.positionX).toBe(7);
      expect(fresh?.positionY).toBe(8);
      expect(fresh?.lastUpdatedLocalMs).toBe(0);
    });

    it('removes ids absent from the refetch response', () => {
      useWorldStore.getState().mergeRefetch([]);
      expect(useWorldStore.getState().worldMetadata.size).toBe(0);
    });
  });

  describe('setPosition / setRotation / setVelocity', () => {
    beforeEach(() => {
      useWorldStore.getState().hydrateFromTodos([makeTodo({ id: 'a' })]);
    });

    it('setPosition stamps lastUpdatedLocalMs and marks entry dirty', () => {
      const before = useWorldStore.getState().worldMetadata.get('a')!;
      useWorldStore.getState().setPosition('a', 100, 200);
      const after = useWorldStore.getState().worldMetadata.get('a')!;
      expect(after.positionX).toBe(100);
      expect(after.positionY).toBe(200);
      expect(after.lastUpdatedLocalMs).toBeGreaterThan(before.lastUpdatedLocalMs);
      expect(after.lastUpdatedLocalMs).toBeGreaterThan(after.lastSavedAtMs);
    });

    it('setPosition no-ops when value is unchanged', () => {
      const initial = useWorldStore.getState().worldMetadata.get('a')!;
      useWorldStore.getState().setPosition('a', initial.positionX, initial.positionY);
      const after = useWorldStore.getState().worldMetadata.get('a')!;
      expect(after.lastUpdatedLocalMs).toBe(initial.lastUpdatedLocalMs);
    });

    it('setRotation stamps lastUpdatedLocalMs', () => {
      useWorldStore.getState().setRotation('a', 1.23);
      const after = useWorldStore.getState().worldMetadata.get('a')!;
      expect(after.rotationY).toBe(1.23);
      expect(after.lastUpdatedLocalMs).toBeGreaterThan(after.lastSavedAtMs);
    });

    it('setVelocity does NOT stamp lastUpdatedLocalMs (transient, not persisted)', () => {
      const before = useWorldStore.getState().worldMetadata.get('a')!;
      useWorldStore.getState().setVelocity('a', 0.5, -0.3);
      const after = useWorldStore.getState().worldMetadata.get('a')!;
      expect(after.velocityX).toBe(0.5);
      expect(after.velocityZ).toBe(-0.3);
      expect(after.lastUpdatedLocalMs).toBe(before.lastUpdatedLocalMs);
    });
  });

  describe('getDirtyEntries', () => {
    it('returns the entries with lastUpdatedLocalMs > lastSavedAtMs', () => {
      useWorldStore.getState().hydrateFromTodos([
        makeTodo({ id: 'a' }),
        makeTodo({ id: 'b' }),
        makeTodo({ id: 'c' }),
      ]);
      useWorldStore.getState().setPosition('a', 1, 1);
      useWorldStore.getState().setPosition('c', 2, 2);
      const dirty = useWorldStore.getState().getDirtyEntries();
      expect(dirty.map((d) => d.id).sort()).toEqual(['a', 'c']);
    });

    it('returns empty when nothing is dirty', () => {
      useWorldStore.getState().hydrateFromTodos([makeTodo({ id: 'a' })]);
      expect(useWorldStore.getState().getDirtyEntries()).toEqual([]);
    });
  });

  describe('applySaveCommit', () => {
    it('bumps lastSavedAtMs for committed ids and clears the dirty flag', () => {
      useWorldStore.getState().hydrateFromTodos([makeTodo({ id: 'a' })]);
      // Use values distinct from makeTodo defaults (1, 2) so the
      // identity-preserving setPosition early-return doesn't skip.
      useWorldStore.getState().setPosition('a', 99, 100);
      expect(useWorldStore.getState().getDirtyEntries()).toHaveLength(1);
      const dispatchMs = performance.now() + 1000;
      useWorldStore.getState().applySaveCommit(['a'], dispatchMs);
      expect(useWorldStore.getState().getDirtyEntries()).toHaveLength(0);
      expect(useWorldStore.getState().worldMetadata.get('a')?.lastSavedAtMs).toBe(dispatchMs);
    });

    it('preserves dirty state for entries mutated AFTER dispatch', () => {
      useWorldStore.getState().hydrateFromTodos([makeTodo({ id: 'a' })]);
      const dispatchMs = performance.now();
      // Mutate AFTER dispatch (simulated — in real flow dispatchMs is captured first).
      useWorldStore.getState().setPosition('a', 5, 5);
      useWorldStore.getState().applySaveCommit(['a'], dispatchMs);
      // Mutation after dispatch → lastUpdatedLocalMs > dispatchMs → still dirty.
      expect(useWorldStore.getState().getDirtyEntries()).toHaveLength(1);
    });

    it('is a no-op for ids not in the store', () => {
      useWorldStore.getState().applySaveCommit(['missing'], performance.now());
      expect(useWorldStore.getState().worldMetadata.size).toBe(0);
    });
  });

  describe('removeEntry', () => {
    it('drops a single entry', () => {
      useWorldStore.getState().hydrateFromTodos([
        makeTodo({ id: 'a' }),
        makeTodo({ id: 'b' }),
      ]);
      useWorldStore.getState().removeEntry('a');
      expect(useWorldStore.getState().worldMetadata.has('a')).toBe(false);
      expect(useWorldStore.getState().worldMetadata.has('b')).toBe(true);
    });

    it('is a no-op for unknown ids', () => {
      useWorldStore.getState().hydrateFromTodos([makeTodo({ id: 'a' })]);
      useWorldStore.getState().removeEntry('missing');
      expect(useWorldStore.getState().worldMetadata.size).toBe(1);
    });
  });

  describe('constants', () => {
    it('exports MAX_LOADED_TODOS = 500', () => {
      expect(MAX_LOADED_TODOS).toBe(500);
    });

    it('exports PERIODIC_SAVE_INTERVAL_MS = 300_000 (5 minutes)', () => {
      expect(PERIODIC_SAVE_INTERVAL_MS).toBe(300_000);
    });
  });
});
