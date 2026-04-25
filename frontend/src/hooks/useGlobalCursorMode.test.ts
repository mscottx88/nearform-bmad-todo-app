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
  beforeEach(() => {
    usePondStore.setState({ cursorMode: 'firefly' });
  });

  afterEach(() => {
    document.body.innerHTML = '';
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

  it('falls back to "firefly" over inert content', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const { unmount } = renderHook(() => useGlobalCursorMode());
    usePondStore.setState({ cursorMode: 'point' });
    act(() => dispatchMove(div));
    expect(usePondStore.getState().cursorMode).toBe('firefly');
    unmount();
  });

  it('does not override "grab" mode (set by LilyPad / scrollbar)', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const { unmount } = renderHook(() => useGlobalCursorMode());
    usePondStore.setState({ cursorMode: 'grab' });
    act(() => dispatchMove(btn));
    expect(usePondStore.getState().cursorMode).toBe('grab');
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
