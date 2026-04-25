import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGlobalCursorMode } from './useGlobalCursorMode';
import { usePondStore } from '../stores/usePondStore';

function dispatchMove(target: Element) {
  // jsdom doesn't implement document.elementFromPoint, so we stub it
  // to return the target we want under the pointer for this test.
  const stub = vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0 }));
  stub.mockRestore();
}

describe('useGlobalCursorMode', () => {
  // Story 6.2 Group C CR P7: the hook now rAF-coalesces inference.
  // jsdom doesn't flush rAF inside React's `act`, so spy on rAF to
  // run callbacks synchronously — keeps the existing test contract
  // (dispatch then assert) without forcing every test to await
  // a frame manually.
  beforeEach(() => {
    usePondStore.setState({ cursorMode: 'firefly' });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(performance.now());
      return 0;
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('sets cursor mode to "point" over an enabled button', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const { unmount } = renderHook(() => useGlobalCursorMode());
    act(() => dispatchMove(btn));
    expect(usePondStore.getState().cursorMode).toBe('point');
    unmount();
  });

  it('sets cursor mode to "no-access" over a disabled button', () => {
    const btn = document.createElement('button');
    btn.disabled = true;
    document.body.appendChild(btn);
    const { unmount } = renderHook(() => useGlobalCursorMode());
    act(() => dispatchMove(btn));
    expect(usePondStore.getState().cursorMode).toBe('no-access');
    unmount();
  });

  it('sets cursor mode to "text" over a textarea', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    const { unmount } = renderHook(() => useGlobalCursorMode());
    act(() => dispatchMove(ta));
    expect(usePondStore.getState().cursorMode).toBe('text');
    unmount();
  });

  it('sets cursor mode to "text" over a text input', () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    const { unmount } = renderHook(() => useGlobalCursorMode());
    act(() => dispatchMove(input));
    expect(usePondStore.getState().cursorMode).toBe('text');
    unmount();
  });

  it('sets cursor mode to "point" over a non-text input (e.g. checkbox)', () => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    document.body.appendChild(input);
    const { unmount } = renderHook(() => useGlobalCursorMode());
    act(() => dispatchMove(input));
    expect(usePondStore.getState().cursorMode).toBe('point');
    unmount();
  });

  it('sets cursor mode to "point" over an anchor with href', () => {
    const a = document.createElement('a');
    a.href = 'https://example.com';
    document.body.appendChild(a);
    const { unmount } = renderHook(() => useGlobalCursorMode());
    act(() => dispatchMove(a));
    expect(usePondStore.getState().cursorMode).toBe('point');
    unmount();
  });

  it('walks up to a button ancestor when the immediate target is a span inside it', () => {
    const btn = document.createElement('button');
    const span = document.createElement('span');
    span.textContent = 'click me';
    btn.appendChild(span);
    document.body.appendChild(btn);
    const { unmount } = renderHook(() => useGlobalCursorMode());
    act(() => dispatchMove(span));
    expect(usePondStore.getState().cursorMode).toBe('point');
    unmount();
  });

  it('falls back to "firefly" over inert empty content', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const { unmount } = renderHook(() => useGlobalCursorMode());
    usePondStore.setState({ cursorMode: 'point' });
    act(() => dispatchMove(div));
    expect(usePondStore.getState().cursorMode).toBe('firefly');
    unmount();
  });

  it('shows the I-beam over selectable text (user-select != none)', () => {
    // A plain paragraph with text — `user-select: text` is the
    // default, so the cursor should mirror the OS I-beam.
    const p = document.createElement('p');
    p.textContent = 'some prose';
    document.body.appendChild(p);
    const { unmount } = renderHook(() => useGlobalCursorMode());
    act(() => dispatchMove(p));
    expect(usePondStore.getState().cursorMode).toBe('text');
    unmount();
  });

  it('does NOT show the I-beam when user-select is none', () => {
    const span = document.createElement('span');
    span.textContent = 'decorative chrome';
    span.style.userSelect = 'none';
    document.body.appendChild(span);
    const { unmount } = renderHook(() => useGlobalCursorMode());
    act(() => dispatchMove(span));
    expect(usePondStore.getState().cursorMode).toBe('firefly');
    unmount();
  });

  it('overrides stale "grab" mode when the cursor moves to a new target', () => {
    // 'grab' is hover-only; the hook re-infers it on every mousemove
    // so a stale grab set by one component (e.g. InfoPopup leaving
    // its panel) can't poison the cursor for the rest of the page.
    // Components that need grab to PERSIST (scrollbar thumb, resize
    // handle) opt their elements into managed mode via
    // `data-cursor-managed`; see the next test.
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const { unmount } = renderHook(() => useGlobalCursorMode());
    usePondStore.setState({ cursorMode: 'grab' });
    act(() => dispatchMove(btn));
    expect(usePondStore.getState().cursorMode).toBe('point');
    unmount();
  });

  it('does not override "grabbing" mode', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const { unmount } = renderHook(() => useGlobalCursorMode());
    usePondStore.setState({ cursorMode: 'grabbing' });
    act(() => dispatchMove(btn));
    expect(usePondStore.getState().cursorMode).toBe('grabbing');
    unmount();
  });

  it('preserves imperative modes (point / grab) on a managed <canvas>', () => {
    // The R3F canvas hosts the pond scene — LilyPad sets 'point' on
    // pointerEnter and 'grabbing' on drag-start. The global hook
    // must NOT clobber those imperative modes when the next
    // mousemove fires inside the canvas.
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const { unmount } = renderHook(() => useGlobalCursorMode());
    usePondStore.setState({ cursorMode: 'point' });
    act(() => dispatchMove(canvas));
    expect(usePondStore.getState().cursorMode).toBe('point');
    unmount();
  });

  it('clears stale hook-owned modes (text / no-access) on entry to managed', () => {
    // When the cursor moves from a paragraph (hook set 'text') into
    // the canvas, the stale 'text' would otherwise persist until
    // some imperative handler fired — which never happens if the
    // user is over empty water. The hook clears 'text' /
    // 'no-access' on managed entry so the cursor falls back to
    // 'firefly' until LilyPad's pointerEnter takes over.
    const div = document.createElement('div');
    div.setAttribute('data-cursor-managed', '');
    document.body.appendChild(div);
    const { unmount } = renderHook(() => useGlobalCursorMode());
    usePondStore.setState({ cursorMode: 'text' });
    act(() => dispatchMove(div));
    expect(usePondStore.getState().cursorMode).toBe('firefly');

    usePondStore.setState({ cursorMode: 'no-access' });
    act(() => dispatchMove(div));
    expect(usePondStore.getState().cursorMode).toBe('firefly');
    unmount();
  });

  it('honours role=button and aria-disabled', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'button');
    div.setAttribute('aria-disabled', 'true');
    document.body.appendChild(div);
    const { unmount } = renderHook(() => useGlobalCursorMode());
    act(() => dispatchMove(div));
    expect(usePondStore.getState().cursorMode).toBe('no-access');
    unmount();
  });
});
