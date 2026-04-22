// Story 4.2: pure helper for the `/spread-out` slash command.
//
// Given a set of todos (each with a current position) and an optional
// group-membership map, iteratively relax overlaps so no two pad
// bodies sit closer than `PAD_MIN_DIST` apart. Pads that share a
// group move as a rigid unit — their relative offsets within the
// group are preserved; only the group centroid is repelled.
//
// For story 4.2, callers always pass `new Map()` (no groups exist
// yet in the store/backend). Story 4.6 adds the group infrastructure
// and will pass real memberships without touching the algorithm.
//
// The function is PURE: same inputs → same outputs (modulo the
// deterministic-jitter tie-break for exactly-coincident positions).
// Safe to test in isolation, no store or React dependencies.

import type { Todo } from '../types';

export interface PadPosition {
  x: number;
  z: number;
}

// Must match LilyPad.tsx `PAD_RADIUS = 1.0`. Minimum centre-to-centre
// distance = 2×PAD_RADIUS + 0.4 gap = 2.4 world units. Keeping the
// constant here (rather than importing from LilyPad) avoids pulling
// the whole Three.js module graph into pure-function tests.
export const PAD_MIN_DIST = 2.4;

// Relaxation iteration cap. At 80 iterations with a push of
// (PAD_MIN_DIST - dist)/2 per overlap, even a pathological
// stack-of-30-coincident-pads converges in under 30 iterations in
// practice. 80 is comfortably above any realistic pond size.
const MAX_ITERATIONS = 80;

// Settle-in threshold — once no pair's overlap is larger than this,
// we declare the system relaxed and exit early. Prevents iterating
// to MAX_ITERATIONS on already-spread ponds.
const STABLE_EPSILON = 1e-4;

// Pads that registered as zero change (within this) after relaxation
// are omitted from the return map — a no-op PATCH would burn a
// network round-trip for nothing. Slightly larger than
// STABLE_EPSILON so borderline shifts round to "no change."
const NO_CHANGE_THRESHOLD = 0.01;

// Deterministic "jitter" direction when two pads are exactly
// coincident (dist ≈ 0). Using an index-derived angle (instead of
// Math.random) keeps the algorithm pure — same input always yields
// the same output, which is critical for test reproducibility.
function jitterDirection(i: number, j: number): { dx: number; dz: number } {
  const angle = ((i * 131 + j * 257) % 360) * (Math.PI / 180);
  return { dx: Math.cos(angle), dz: Math.sin(angle) };
}

/**
 * Compute non-overlapping target positions for the given todos.
 *
 * @param todos Source list. `positionX`/`positionY` are read; null
 *   coords are treated as (0, 0). Passing an empty array returns
 *   an empty map.
 * @param groupings Map of todoId → groupId. Pads sharing a groupId
 *   are translated as a single rigid unit. For story 4.2 callers
 *   pass `new Map()` (all pads are singletons).
 * @returns Map<todoId, PadPosition> containing ONLY the pads whose
 *   position changed by more than NO_CHANGE_THRESHOLD on either
 *   axis. Already-spread pads are omitted so `/spread-out` on a
 *   clean pond is a cheap no-op.
 */
export function computeSpreadPositions(
  todos: readonly Todo[],
  groupings: ReadonlyMap<string, string>,
): Map<string, PadPosition> {
  if (todos.length === 0) return new Map();

  // Snapshot original positions for the final change-vs-no-change
  // comparison. Stored alongside the working positions so we don't
  // double-iterate at the end.
  const original = new Map<string, PadPosition>();
  const working = new Map<string, PadPosition>();
  for (const t of todos) {
    const pos: PadPosition = { x: t.positionX ?? 0, z: t.positionY ?? 0 };
    original.set(t.id, { ...pos });
    working.set(t.id, pos);
  }

  // Build a stable group-key → member-ids index. A pad with no
  // entry in `groupings` is its own singleton group, keyed by its
  // todo id. This unifies the "is this pad grouped?" branch into
  // a single "which group is this pad in" lookup.
  const groupKeyOf = (id: string): string => groupings.get(id) ?? id;
  const groupMembers = new Map<string, string[]>();
  for (const t of todos) {
    const k = groupKeyOf(t.id);
    let list = groupMembers.get(k);
    if (!list) {
      list = [];
      groupMembers.set(k, list);
    }
    list.push(t.id);
  }

  // Each pair is iterated (a, b) with a < b to avoid double-work.
  // Group keys are looked up per pair so same-group pairs skip the
  // repulsion (they're already "together"). For cross-group pairs
  // the full member list of each group is translated by half the
  // push — this preserves intra-group offsets while repelling the
  // cluster as a whole.
  const ids = todos.map((t) => t.id);

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let maxOverlap = 0;
    for (let i = 0; i < ids.length; i++) {
      const idA = ids[i];
      const kA = groupKeyOf(idA);
      const a = working.get(idA)!;
      for (let j = i + 1; j < ids.length; j++) {
        const idB = ids[j];
        const kB = groupKeyOf(idB);
        if (kA === kB) continue; // same group — move together, no repulsion
        const b = working.get(idB)!;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist >= PAD_MIN_DIST) continue;

        // Direction from A toward B. For exactly-coincident pads
        // pick a deterministic perpendicular so iteration can make
        // progress — otherwise dist stays 0 forever.
        let nx: number;
        let nz: number;
        if (dist < 1e-6) {
          const jit = jitterDirection(i, j);
          nx = jit.dx;
          nz = jit.dz;
        } else {
          nx = dx / dist;
          nz = dz / dist;
        }

        const overlap = PAD_MIN_DIST - dist;
        if (overlap > maxOverlap) maxOverlap = overlap;
        const push = overlap / 2;

        // Apply opposite pushes to every member of each group. Each
        // group translates rigidly so intra-group offsets survive.
        const membersA = groupMembers.get(kA)!;
        const membersB = groupMembers.get(kB)!;
        for (const m of membersA) {
          const p = working.get(m)!;
          p.x -= nx * push;
          p.z -= nz * push;
        }
        for (const m of membersB) {
          const p = working.get(m)!;
          p.x += nx * push;
          p.z += nz * push;
        }
      }
    }
    if (maxOverlap < STABLE_EPSILON) break;
  }

  // Collect only the pads that actually moved. A no-change pad is
  // omitted so `/spread-out` on an already-spread pond doesn't fire
  // a PATCH storm.
  const result = new Map<string, PadPosition>();
  for (const t of todos) {
    const orig = original.get(t.id)!;
    const now = working.get(t.id)!;
    if (
      Math.abs(now.x - orig.x) > NO_CHANGE_THRESHOLD ||
      Math.abs(now.z - orig.z) > NO_CHANGE_THRESHOLD
    ) {
      result.set(t.id, { x: now.x, z: now.z });
    }
  }
  return result;
}
