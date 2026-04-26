import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

const triggerRippleMock = vi.fn();
vi.mock('../../stores/usePondStore', () => ({
  usePondStore: Object.assign(() => undefined, {
    getState: () => ({ triggerRipple: triggerRippleMock }),
  }),
}));

import {
  OracleFrogManager,
  ORACLE_HOME_POSITION,
  ORACLE_BOUNDARY_RADIUS,
  ORACLE_RETURN_DURATION_MS,
  hasDriftedPastBoundary,
} from './OracleFrogManager';
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

describe('OracleFrogManager — first-mount idempotent home seeding (AC 2)', () => {
  beforeEach(() => {
    resetStore();
    triggerRippleMock.mockReset();
  });

  it('seeds setOraclePadPosition({-3.5, 3.5}) on first mount when none persisted', () => {
    expect(useAgentStore.getState().oraclePadPosition).toBeNull();
    render(<OracleFrogManager />);
    const pos = useAgentStore.getState().oraclePadPosition;
    expect(pos).toEqual({ x: ORACLE_HOME_POSITION.x, z: ORACLE_HOME_POSITION.z });
    expect(pos).toEqual({ x: -3.5, z: 3.5 });
  });

  it('does NOT overwrite a persisted oracle position on subsequent mounts', () => {
    useAgentStore.getState().setOraclePadPosition({ x: 7.0, z: -2.0 });
    render(<OracleFrogManager />);
    expect(useAgentStore.getState().oraclePadPosition).toEqual({ x: 7.0, z: -2.0 });
  });

  it('exports the AC-mandated boundary radius + return duration', () => {
    expect(ORACLE_BOUNDARY_RADIUS).toBe(1.0);
    expect(ORACLE_RETURN_DURATION_MS).toBe(1500);
  });
});

describe('hasDriftedPastBoundary (AC 3)', () => {
  it('returns true when current pos is > radius from home', () => {
    expect(
      hasDriftedPastBoundary({ x: 5, z: 5 }, { x: 0, z: 0 }, 1.0),
    ).toBe(true);
  });

  it('returns false when current pos is exactly at home', () => {
    expect(
      hasDriftedPastBoundary({ x: -3.5, z: 3.5 }, { x: -3.5, z: 3.5 }, 1.0),
    ).toBe(false);
  });

  it('returns false when current pos is within radius', () => {
    // 0.7 away on each axis → ~0.99 distance, below radius=1.0.
    expect(
      hasDriftedPastBoundary({ x: 0.7, z: 0.7 }, { x: 0, z: 0 }, 1.0),
    ).toBe(false);
  });

  it('returns true when distance equals radius + epsilon (strict > comparison)', () => {
    // Distance just over 1.0 must trip the boundary.
    expect(
      hasDriftedPastBoundary({ x: 1.01, z: 0 }, { x: 0, z: 0 }, 1.0),
    ).toBe(true);
  });
});
