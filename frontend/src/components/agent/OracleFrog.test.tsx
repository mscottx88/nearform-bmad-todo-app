import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import * as THREE from 'three';

// We mock R3F so the component renders as plain DOM (the JSX tree
// includes <mesh>, <sphereGeometry>, etc. — none of those are real
// DOM elements, but R3F's reconciler creates Three.js objects from
// them. Without a Canvas, the reconciler isn't running, so the JSX
// just renders into happy-dom as unknown elements. We don't assert
// on the DOM structure; we assert on the geometry helpers + the
// useFrame callback's effects on the mocked refs.
vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

import {
  createFrogOutlineGeometry,
  FROG_OUTLINE_POINTS,
  FROG_EMISSIVE_INTENSITY,
} from './oracleFrogGeometry';
import { OracleFrog } from './OracleFrog';
import { useAgentStore } from '../../stores/useAgentStore';

function resetStore() {
  useAgentStore.setState({
    panelOpen: false,
    activeSessionId: null,
    sessions: [],
    messages: [],
    inputDraft: '',
    streamingMessageId: null,
    streamingBuffer: '',
    agentState: 'idle',
    oraclePadPosition: null,
  });
}

describe('oracleFrogGeometry', () => {
  it('exports ~12-20 silhouette control points (AC 1)', () => {
    expect(FROG_OUTLINE_POINTS.length).toBeGreaterThanOrEqual(12);
    expect(FROG_OUTLINE_POINTS.length).toBeLessThanOrEqual(20);
  });

  it('createFrogOutlineGeometry returns a closed CatmullRomCurve3 + TubeGeometry', () => {
    const { curve, tube } = createFrogOutlineGeometry();
    expect(curve).toBeInstanceOf(THREE.CatmullRomCurve3);
    expect(tube).toBeInstanceOf(THREE.TubeGeometry);
    // closed=true on the curve so the silhouette wraps back to start.
    // Three.js exposes this on the curve instance.
    expect(curve.closed).toBe(true);
  });

  it('TubeGeometry honours the AC defaults (64 segments, 0.012 radius, 6 radial segments)', () => {
    const { tube } = createFrogOutlineGeometry();
    // The parameters object is preserved on TubeGeometry instances by
    // Three.js so callers (and tests) can inspect what was used.
    expect(tube.parameters.tubularSegments).toBe(64);
    expect(tube.parameters.radius).toBe(0.012);
    expect(tube.parameters.radialSegments).toBe(6);
    expect(tube.parameters.closed).toBe(true);
  });
});

describe('OracleFrog — emissive intensity per state (AC 4)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('exports the per-state emissive table that the component consumes', () => {
    expect(FROG_EMISSIVE_INTENSITY.idle).toBe(0.4);
    expect(FROG_EMISSIVE_INTENSITY.listening).toBe(0.55);
    expect(FROG_EMISSIVE_INTENSITY.thinking).toBe(0.7);
    expect(FROG_EMISSIVE_INTENSITY.speaking).toBe(0.85);
    // 'success' flashes briefly to 1.2 (decay handled in useFrame).
    expect(FROG_EMISSIVE_INTENSITY.success).toBe(1.2);
    // 'error' uses 0.85 with an emissive colour shift.
    expect(FROG_EMISSIVE_INTENSITY.error).toBe(0.85);
  });

  it('mounts under a mocked R3F context without throwing', () => {
    // Smoke render: confirms the JSX tree (groups, meshes, geometries)
    // is well-formed enough that React doesn't bail. The mocked
    // useFrame callback is captured but not invoked here.
    expect(() => {
      render(<OracleFrog />);
    }).not.toThrow();
  });

  it('reduces motion: when matchMedia(reduce) returns true, useFrame skips body/eye math', async () => {
    // Sub the matchMedia API so the cached ref reads `true` on mount.
    const original = window.matchMedia;
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = ((
      q: string,
    ) => ({
      matches: q.includes('reduce'),
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    try {
      const fiber = await import('@react-three/fiber');
      const useFrameMock = fiber.useFrame as unknown as ReturnType<typeof vi.fn>;
      useFrameMock.mockReset();
      let captured: ((state: { clock: { elapsedTime: number } }) => void) | null =
        null;
      useFrameMock.mockImplementation(
        (cb: (state: { clock: { elapsedTime: number } }) => void) => {
          captured = cb;
        },
      );

      render(<OracleFrog />);
      // Wait a microtask so the mount-effect (matchMedia read) runs.
      await Promise.resolve();
      expect(captured).not.toBeNull();
      // We can't easily assert "no mesh writes happen" without a real
      // R3F instance — but we can confirm the callback runs without
      // throwing under reduce-motion. The body of useFrame short-
      // circuits before any mesh ref read other than emissive, which
      // is harmless on a null ref.
      expect(() => {
        captured?.({ clock: { elapsedTime: 1.5 } });
      }).not.toThrow();
    } finally {
      window.matchMedia = original;
    }
  });
});
