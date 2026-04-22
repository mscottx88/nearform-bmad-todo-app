import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { forwardRef } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import * as THREE from 'three';
import { PondCamera } from './PondCamera';
import { usePondStore } from '../../stores/usePondStore';

// ---- R3F + Drei mocks -----------------------------------------------------

// Captured from the OrbitControls mock on render. Assertions read this.
let orbitControlsProps: Record<string, unknown> = {};

// Mock "controls" instance exposed via the OrbitControls ref — a minimal
// subset of OrbitControls covering what PondCamera.useFrame touches.
const mockControls = {
  target: new THREE.Vector3(0, 0, 0),
  update: vi.fn(),
};

// Mock camera exposed via useThree.
const mockCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
mockCamera.position.set(0, 15, 20);

// Mock canvas element that pointer/wheel listeners attach to. JSDOM's
// default getBoundingClientRect returns zeros for a detached element,
// which would produce NaN NDC coordinates and make the raycast in
// handlePointerUp miss. Stub it to a full-viewport-sized rect so the
// click-no-drag raycast lands on the water plane.
const mockCanvas = document.createElement('canvas');
mockCanvas.getBoundingClientRect = () =>
  ({ left: 0, top: 0, width: 1024, height: 768, right: 1024, bottom: 768, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

// Capture useFrame callbacks so tests can invoke them synthetically.
const frameCallbacks: Array<() => void> = [];

vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: () => void) => {
    frameCallbacks.push(cb);
  },
  useThree: () => ({ camera: mockCamera, gl: { domElement: mockCanvas } }),
}));

vi.mock('@react-three/drei', () => ({
  // eslint-disable-next-line react/display-name
  OrbitControls: forwardRef<typeof mockControls, Record<string, unknown>>(
    (props, ref) => {
      orbitControlsProps = props;
      if (typeof ref === 'function') {
        ref(mockControls);
      } else if (ref) {
        (ref as MutableRefObject<typeof mockControls>).current = mockControls;
      }
      return null;
    },
  ),
  Html: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// ---- Helpers ---------------------------------------------------------------

function runFrame(n = 1): void {
  for (let i = 0; i < n; i += 1) {
    for (const cb of frameCallbacks) cb();
  }
}

function resetMockState(): void {
  mockCamera.position.set(0, 15, 20);
  mockControls.target.set(0, 0, 0);
  mockControls.update.mockReset();
  frameCallbacks.length = 0;
  orbitControlsProps = {};
  usePondStore.setState({
    cameraResetRequestId: 0,
    pendingCameraFit: null,
    cameraFocus: null,
    activePopupTodoId: null,
  });
}

// ---- Tests -----------------------------------------------------------------

describe('PondCamera — OrbitControls config', () => {
  beforeEach(resetMockState);

  it('passes expected config props to OrbitControls', () => {
    render(<PondCamera />);
    expect(orbitControlsProps.maxPolarAngle).toBe(Math.PI / 2.2);
    // minPolarAngle is left unset so OrbitControls uses its default of 0 —
    // users can orbit up to a full top-down bird's-eye view (AC #3).
    expect(orbitControlsProps.minPolarAngle).toBeUndefined();
    expect(orbitControlsProps.minDistance).toBe(5);
    expect(orbitControlsProps.maxDistance).toBe(60);
    expect(orbitControlsProps.enableDamping).toBe(true);
    expect(orbitControlsProps.dampingFactor).toBe(0.05);
    expect(orbitControlsProps.enablePan).toBe(true);
    expect(orbitControlsProps.zoomToCursor).toBe(true);
    expect(orbitControlsProps.screenSpacePanning).toBe(false);
    const buttons = orbitControlsProps.mouseButtons as Record<string, unknown>;
    // Story 4.2: LEFT is intentionally omitted so plain left-button
    // drag is always a pad interaction (click or drag), never a
    // camera pan. Users retain pan via Ctrl+RMB (OrbitControls'
    // built-in modifier swap on the ROTATE button).
    expect(buttons.LEFT).toBeUndefined();
    expect(buttons.RIGHT).toBe(THREE.MOUSE.ROTATE);
    // MIDDLE is intentionally omitted so OrbitControls skips MMB.
    expect(buttons.MIDDLE).toBeUndefined();
  });
});

describe('PondCamera — click-to-centre retirement (AC #2)', () => {
  beforeEach(resetMockState);

  it('LMB click-no-drag on water with no popup does not mutate camera', () => {
    render(<PondCamera />);
    const posBefore = mockCamera.position.clone();
    const targetBefore = mockControls.target.clone();

    mockCanvas.dispatchEvent(new PointerEvent('pointerdown', {
      button: 0,
      clientX: 200,
      clientY: 200,
    }));
    mockCanvas.dispatchEvent(new PointerEvent('pointerup', {
      button: 0,
      clientX: 201,
      clientY: 201, // within the 5px click threshold
    }));

    // Run a couple of frames — nothing should move.
    runFrame(3);

    expect(mockCamera.position.equals(posBefore)).toBe(true);
    expect(mockControls.target.equals(targetBefore)).toBe(true);
  });

  it('LMB click-no-drag with popup open closes the popup (preserved path)', () => {
    usePondStore.setState({ activePopupTodoId: 'todo-1' });
    const closeSpy = vi.spyOn(usePondStore.getState(), 'closePopup');
    render(<PondCamera />);

    mockCanvas.dispatchEvent(new PointerEvent('pointerdown', {
      button: 0,
      clientX: 100,
      clientY: 100,
    }));
    mockCanvas.dispatchEvent(new PointerEvent('pointerup', {
      button: 0,
      clientX: 100,
      clientY: 100,
    }));

    expect(closeSpy).toHaveBeenCalled();
  });
});

describe('PondCamera — MMB ascend/descend (AC #8)', () => {
  beforeEach(resetMockState);

  it('MMB-drag up translates camera.y and target.y by the same positive delta', () => {
    render(<PondCamera />);
    const cameraStartY = mockCamera.position.y;
    const targetStartY = mockControls.target.y;

    mockCanvas.dispatchEvent(new PointerEvent('pointerdown', {
      button: 1,
      clientX: 100,
      clientY: 500,
    }));
    window.dispatchEvent(new PointerEvent('pointermove', {
      button: 1,
      clientX: 100,
      clientY: 400, // 100 px up (dy = -100)
    }));
    mockCanvas.dispatchEvent(new PointerEvent('pointerup', {
      button: 1,
      clientX: 100,
      clientY: 400,
    }));

    // MMB_ASCEND_SENSITIVITY = 0.03; delta = -dy * 0.03 = 100 * 0.03 = 3.0
    expect(mockCamera.position.y).toBeCloseTo(cameraStartY + 3.0, 5);
    expect(mockControls.target.y).toBeCloseTo(targetStartY + 3.0, 5);
  });

  it('MMB-drag down descends but clamps at CAMERA_MIN_Y', () => {
    mockCamera.position.set(0, 1.0, 20); // close to the floor
    render(<PondCamera />);

    mockCanvas.dispatchEvent(new PointerEvent('pointerdown', {
      button: 1,
      clientX: 100,
      clientY: 100,
    }));
    // Drag down hard — wants to descend by 5 units (167 px * 0.03).
    window.dispatchEvent(new PointerEvent('pointermove', {
      button: 1,
      clientX: 100,
      clientY: 100 + 167,
    }));
    mockCanvas.dispatchEvent(new PointerEvent('pointerup', {
      button: 1,
      clientX: 100,
      clientY: 267,
    }));

    // Camera clamps at CAMERA_MIN_Y = 0.5; target advances by the truncated
    // delta = (0.5 - 1.0) = -0.5 so rigid-body stays coherent.
    expect(mockCamera.position.y).toBeCloseTo(0.5, 5);
    expect(mockControls.target.y).toBeCloseTo(-0.5, 5);
  });

  it('MMB pointerup on window (off-canvas release) clears drag state', () => {
    render(<PondCamera />);
    mockCamera.position.set(0, 10, 20);

    // Start MMB drag on canvas
    mockCanvas.dispatchEvent(new PointerEvent('pointerdown', {
      button: 1,
      clientX: 100,
      clientY: 500,
    }));
    // One move to establish we ARE dragging
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 100,
      clientY: 400,
    }));
    const yMidDrag = mockCamera.position.y;
    expect(yMidDrag).toBeCloseTo(10 + 3.0, 5); // dy=-100 * 0.03 = +3

    // User releases MMB OFF the canvas — pointerup fires only on window.
    // Without the window-level handler, `mmbDragPrevY` would stay set and
    // the next pointermove would re-engage the drag.
    window.dispatchEvent(new PointerEvent('pointerup', {
      button: 1,
      clientX: 100,
      clientY: 400,
    }));

    // Subsequent pointermove must NOT continue translating the camera —
    // drag state should be cleared.
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 100,
      clientY: 200, // would have been another 6 unit ascend
    }));
    expect(mockCamera.position.y).toBeCloseTo(yMidDrag, 5);
  });

  it('MMB-drag start cancels an in-flight reset', () => {
    render(<PondCamera />);
    // Kick off a reset
    usePondStore.getState().requestCameraReset({
      position: [10, 9, 12],
      target: [10, 0, 0],
    });
    runFrame(1); // start animation
    expect(usePondStore.getState().pendingCameraFit).not.toBeNull();

    mockCanvas.dispatchEvent(new PointerEvent('pointerdown', {
      button: 1,
      clientX: 50,
      clientY: 50,
    }));
    // MMB-down should cancel the reset → pendingCameraFit cleared
    expect(usePondStore.getState().pendingCameraFit).toBeNull();
  });
});

describe('PondCamera — reset animation + fit (AC #4)', () => {
  beforeEach(resetMockState);

  it('requestCameraReset is consumed by useFrame and lerps to the fit', () => {
    render(<PondCamera />);
    // Simulate user orbited somewhere arbitrary
    mockCamera.position.set(0, 5, 5);
    mockControls.target.set(-3, 0, -3);

    usePondStore.getState().requestCameraReset({
      position: [10, 9, 12],
      target: [10, 0, 0],
    });

    // Run 200 ticks (well beyond the ~333ms decay at 60fps). The ARRIVE
    // threshold should latch and the animation end.
    runFrame(200);

    expect(mockCamera.position.distanceTo(new THREE.Vector3(10, 9, 12))).toBeLessThan(0.1);
    expect(mockControls.target.distanceTo(new THREE.Vector3(10, 0, 0))).toBeLessThan(0.1);
    // Pending fit is cleared on arrival.
    expect(usePondStore.getState().pendingCameraFit).toBeNull();

    // One more tick should not mutate camera further (animation ended).
    const posAfter = mockCamera.position.clone();
    runFrame(1);
    expect(mockCamera.position.equals(posAfter)).toBe(true);
  });

  it('wheel mid-reset cancels the animation and clears pending fit', () => {
    render(<PondCamera />);
    mockCamera.position.set(0, 5, 5);
    mockControls.target.set(-3, 0, -3);

    usePondStore.getState().requestCameraReset({
      position: [10, 9, 12],
      target: [10, 0, 0],
    });
    runFrame(3); // partial progress

    // Wheel cancels the reset
    mockCanvas.dispatchEvent(new WheelEvent('wheel'));
    const posAfterCancel = mockCamera.position.clone();

    runFrame(10);
    // No further camera mutation toward the fit — position is essentially
    // unchanged (controls.update() only runs from here on).
    expect(mockCamera.position.distanceTo(posAfterCancel)).toBeLessThan(0.01);
    expect(usePondStore.getState().pendingCameraFit).toBeNull();
  });

  it('counter bump with null pendingCameraFit is treated as consumed (no animation)', () => {
    render(<PondCamera />);
    mockCamera.position.set(1, 2, 3);
    mockControls.target.set(4, 0, 5);
    const posBefore = mockCamera.position.clone();
    const targetBefore = mockControls.target.clone();

    // Simulate a cancellation race — counter bumps but fit is null.
    usePondStore.setState((state) => ({
      cameraResetRequestId: state.cameraResetRequestId + 1,
      pendingCameraFit: null,
    }));
    runFrame(5);

    expect(mockCamera.position.equals(posBefore)).toBe(true);
    expect(mockControls.target.equals(targetBefore)).toBe(true);
  });
});

describe('PondCamera — frame-level camera.y floor (AC #9)', () => {
  beforeEach(resetMockState);

  it('clamps camera.position.y at CAMERA_MIN_Y on every frame', () => {
    render(<PondCamera />);
    mockCamera.position.set(0, -2, 0); // deliberately below the floor
    const targetBefore = mockControls.target.clone();

    runFrame(1);

    expect(mockCamera.position.y).toBe(0.5);
    // Target is NOT clamped — only camera.y.
    expect(mockControls.target.equals(targetBefore)).toBe(true);
  });

  it('is a no-op when camera.y is already above the floor', () => {
    render(<PondCamera />);
    mockCamera.position.set(0, 15, 20);

    runFrame(1);

    expect(mockCamera.position.y).toBe(15);
  });
});
