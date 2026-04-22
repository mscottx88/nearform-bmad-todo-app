import { describe, it, expect } from 'vitest';
import {
  fitCameraToPads,
  RESET_BBOX_PADDING,
  RESET_MIN_DISTANCE,
  RESET_MAX_DISTANCE,
  RESET_POLAR_ANGLE,
} from './fitCameraToPads';
import type { Todo } from '../../types';

function makeTodo(overrides: Partial<Todo> & Pick<Todo, 'id'>): Todo {
  return {
    id: overrides.id,
    text: overrides.text ?? 'test',
    completed: overrides.completed ?? false,
    color: overrides.color ?? '#00eeff',
    positionX: overrides.positionX ?? null,
    positionY: overrides.positionY ?? null,
    embeddingStatus: overrides.embeddingStatus ?? 'complete',
    archived: overrides.archived ?? false,
    archivedAt: overrides.archivedAt ?? null,
    deleted: overrides.deleted ?? false,
    deletedAt: overrides.deletedAt ?? null,
    createdAt: overrides.createdAt ?? '2026-04-22T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-04-22T00:00:00Z',
  };
}

// Helper to keep float asserts readable at 4 decimal places.
const approx = (n: number) => Math.round(n * 10000) / 10000;

describe('fitCameraToPads', () => {
  it('falls back to default framing on empty input', () => {
    const fit = fitCameraToPads([]);
    expect(fit.position).toEqual([0, 15, 20]);
    expect(fit.target).toEqual([0, 0, 0]);
  });

  it('falls back to default when every pad has null positions', () => {
    const fit = fitCameraToPads([
      makeTodo({ id: 'a', positionX: null, positionY: null }),
      makeTodo({ id: 'b', positionX: null, positionY: null }),
    ]);
    expect(fit.position).toEqual([0, 15, 20]);
    expect(fit.target).toEqual([0, 0, 0]);
  });

  it('single pad at origin — distance clamps to RESET_MIN_DISTANCE', () => {
    const fit = fitCameraToPads([
      makeTodo({ id: 'a', positionX: 0, positionY: 0 }),
    ]);
    // diagonal = 0 → raw distance = 0, clamped up to RESET_MIN_DISTANCE = 15.
    const D = RESET_MIN_DISTANCE;
    expect(fit.target).toEqual([0, 0, 0]);
    expect(approx(fit.position[0])).toBe(0);
    expect(approx(fit.position[1])).toBe(approx(D * Math.cos(RESET_POLAR_ANGLE))); // ≈ 9
    expect(approx(fit.position[2])).toBe(approx(D * Math.sin(RESET_POLAR_ANGLE))); // ≈ 12
  });

  it('two pads on opposite corners — centroid at origin, fit distance from diagonal', () => {
    const fit = fitCameraToPads([
      makeTodo({ id: 'a', positionX: -5, positionY: -5 }),
      makeTodo({ id: 'b', positionX: 5, positionY: 5 }),
    ]);
    const diagonal = Math.hypot(10, 10); // ≈ 14.1421
    const rawDistance = diagonal * RESET_BBOX_PADDING; // ≈ 18.385
    const D = Math.max(RESET_MIN_DISTANCE, rawDistance);
    expect(fit.target).toEqual([0, 0, 0]);
    expect(approx(fit.position[0])).toBe(0);
    expect(approx(fit.position[1])).toBe(approx(D * Math.cos(RESET_POLAR_ANGLE)));
    expect(approx(fit.position[2])).toBe(approx(D * Math.sin(RESET_POLAR_ANGLE)));
  });

  it('dispersed cluster clamps at RESET_MAX_DISTANCE', () => {
    // Diagonal of 100 * 1.3 = 130 world units → clamp down to 60.
    const fit = fitCameraToPads([
      makeTodo({ id: 'a', positionX: -50, positionY: -50 }),
      makeTodo({ id: 'b', positionX: 50, positionY: 50 }),
    ]);
    const D = RESET_MAX_DISTANCE;
    expect(fit.target).toEqual([0, 0, 0]);
    expect(approx(fit.position[1])).toBe(approx(D * Math.cos(RESET_POLAR_ANGLE)));
    expect(approx(fit.position[2])).toBe(approx(D * Math.sin(RESET_POLAR_ANGLE)));
  });

  it('off-centre cluster moves target to centroid, preserves pitch', () => {
    const fit = fitCameraToPads([
      makeTodo({ id: 'a', positionX: 10, positionY: 10 }),
      makeTodo({ id: 'b', positionX: 12, positionY: 12 }),
    ]);
    // centroid = (11, 11); diagonal = hypot(2,2) ≈ 2.83 → padded 3.68 →
    // clamped up to RESET_MIN_DISTANCE = 15.
    const D = RESET_MIN_DISTANCE;
    expect(fit.target).toEqual([11, 0, 11]);
    expect(approx(fit.position[0])).toBe(11);
    expect(approx(fit.position[1])).toBe(approx(D * Math.cos(RESET_POLAR_ANGLE)));
    // Position.z = centroid.z + offset, so 11 + D*sin(polar).
    expect(approx(fit.position[2])).toBe(approx(11 + D * Math.sin(RESET_POLAR_ANGLE)));
  });

  it('filters out pads with null positions but keeps the rest', () => {
    const fit = fitCameraToPads([
      makeTodo({ id: 'a', positionX: -5, positionY: -5 }),
      makeTodo({ id: 'b', positionX: null, positionY: null }),
      makeTodo({ id: 'c', positionX: 5, positionY: 5 }),
      makeTodo({ id: 'd', positionX: null, positionY: 3 }), // half-null also filtered
    ]);
    // Only 'a' and 'c' contribute → same result as the two-pad case above.
    expect(fit.target).toEqual([0, 0, 0]);
    const diagonal = Math.hypot(10, 10);
    const D = Math.max(
      RESET_MIN_DISTANCE,
      Math.min(RESET_MAX_DISTANCE, diagonal * RESET_BBOX_PADDING),
    );
    expect(approx(fit.position[1])).toBe(approx(D * Math.cos(RESET_POLAR_ANGLE)));
  });

  it('preserved pitch matches the default-pose polar angle', () => {
    // Sanity check: the default camera (0,15,20) looking at origin has
    // cos(polar) = 15/25 = 0.6 and sin(polar) = 20/25 = 0.8. Assert the
    // constant matches.
    expect(approx(Math.cos(RESET_POLAR_ANGLE))).toBe(0.6);
    expect(approx(Math.sin(RESET_POLAR_ANGLE))).toBe(0.8);
  });
});
