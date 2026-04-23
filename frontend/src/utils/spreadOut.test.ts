import { describe, it, expect } from 'vitest';
import { computeSpreadPositions, PAD_MIN_DIST } from './spreadOut';
import type { Todo } from '../types';

// Minimal Todo factory — only the fields the algorithm reads need
// to be realistic. Other fields are set to sensible defaults so
// the type check passes.
function makeTodo(id: string, x: number | null, y: number | null): Todo {
  return {
    id,
    text: id,
    completed: false,
    color: '#00ff88',
    positionX: x,
    positionY: y,
    embeddingStatus: 'pending',
    archived: false,
    archivedAt: null,
    deleted: false,
    deletedAt: null,
    createdAt: '2026-04-22T00:00:00Z',
    updatedAt: '2026-04-22T00:00:00Z',
  };
}

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

describe('computeSpreadPositions', () => {
  it('returns an empty map for an empty input', () => {
    const result = computeSpreadPositions([], new Map());
    expect(result.size).toBe(0);
  });

  it('returns no changes for a single pad (nothing to overlap with)', () => {
    const todos = [makeTodo('solo', 5, 5)];
    const result = computeSpreadPositions(todos, new Map());
    expect(result.size).toBe(0);
  });

  it('does not move pads that are already spread (≥ PAD_MIN_DIST apart)', () => {
    const todos = [
      makeTodo('a', 0, 0),
      makeTodo('b', 5, 0), // > PAD_MIN_DIST (2.4)
      makeTodo('c', 0, 5),
    ];
    const result = computeSpreadPositions(todos, new Map());
    expect(result.size).toBe(0);
  });

  it('resolves two overlapping pads to at least PAD_MIN_DIST apart', () => {
    const todos = [makeTodo('a', 0, 0), makeTodo('b', 1, 0)]; // dist = 1, overlap
    const result = computeSpreadPositions(todos, new Map());
    const posA = result.get('a') ?? { x: 0, z: 0 };
    const posB = result.get('b') ?? { x: 1, z: 0 };
    expect(distance(posA, posB)).toBeGreaterThanOrEqual(PAD_MIN_DIST - 1e-3);
  });

  it('handles exactly-coincident pads with deterministic jitter (does not crash)', () => {
    const todos = [makeTodo('a', 0, 0), makeTodo('b', 0, 0), makeTodo('c', 0, 0)];
    const result = computeSpreadPositions(todos, new Map());
    // All three should have moved off the origin pile.
    const finalPositions = todos.map((t) =>
      result.get(t.id) ?? { x: t.positionX ?? 0, z: t.positionY ?? 0 },
    );
    // Every pair should be at least PAD_MIN_DIST apart.
    for (let i = 0; i < finalPositions.length; i++) {
      for (let j = i + 1; j < finalPositions.length; j++) {
        expect(distance(finalPositions[i], finalPositions[j])).toBeGreaterThanOrEqual(
          PAD_MIN_DIST - 1e-3,
        );
      }
    }
  });

  it('treats null positions as (0, 0) rather than crashing', () => {
    const todos = [
      makeTodo('a', null, null),
      makeTodo('b', null, null),
    ];
    const result = computeSpreadPositions(todos, new Map());
    // Both pads start at the origin → both should move.
    expect(result.size).toBe(2);
    const posA = result.get('a')!;
    const posB = result.get('b')!;
    expect(distance(posA, posB)).toBeGreaterThanOrEqual(PAD_MIN_DIST - 1e-3);
  });

  it('preserves relative offsets within a group (two pads move together)', () => {
    // a and b share group 'g1'. c is a solo pad within PAD_MIN_DIST
    // of the group centroid, forcing the group to translate.
    const todos = [
      makeTodo('a', 0, 0),
      makeTodo('b', 0.5, 0), // part of g1, 0.5 unit offset from a
      makeTodo('c', 1, 0), // solo, should repel g1
    ];
    const groupings = new Map<string, string>([
      ['a', 'g1'],
      ['b', 'g1'],
    ]);
    const result = computeSpreadPositions(todos, groupings);
    // a and b MUST have the same translation delta (same dx, same dz) —
    // their relative offset (0.5, 0) must be preserved.
    const finalA = result.get('a') ?? { x: 0, z: 0 };
    const finalB = result.get('b') ?? { x: 0.5, z: 0 };
    expect(finalB.x - finalA.x).toBeCloseTo(0.5, 3);
    expect(finalB.z - finalA.z).toBeCloseTo(0, 3);
  });

  it('omits pads whose change is below the no-change threshold', () => {
    // Pads that are very slightly closer than PAD_MIN_DIST but not
    // overlapping enough to register a meaningful change after a
    // single relaxation pass should still be in the result if they
    // cross the NO_CHANGE_THRESHOLD. Verify that two pads at
    // PAD_MIN_DIST exactly are treated as no-change.
    const todos = [
      makeTodo('a', 0, 0),
      makeTodo('b', PAD_MIN_DIST, 0),
    ];
    const result = computeSpreadPositions(todos, new Map());
    expect(result.size).toBe(0);
  });

  it('produces a stable result under re-invocation on an already-relaxed layout', () => {
    const todos = [makeTodo('a', 0, 0), makeTodo('b', 1, 0), makeTodo('c', 0, 1)];
    const first = computeSpreadPositions(todos, new Map());
    // Apply the first result to build a "spread" todo list.
    const spreadTodos = todos.map((t) => {
      const pos = first.get(t.id);
      if (!pos) return t;
      return { ...t, positionX: pos.x, positionY: pos.z };
    });
    const second = computeSpreadPositions(spreadTodos, new Map());
    // A relaxed layout shouldn't spawn a new round of motion.
    expect(second.size).toBe(0);
  });
});
