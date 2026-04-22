import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { usePondStore } from '../stores/usePondStore';

function dispatch(key: string, target?: EventTarget) {
  const event = new KeyboardEvent('keydown', { key, cancelable: true });
  if (target) {
    Object.defineProperty(event, 'target', { value: target, writable: false });
  }
  window.dispatchEvent(event);
  return event;
}

// Story 5.3 Task 2b: the new-todo shortcut used to fire on bare `n`,
// `N`, or `/`. Those keys now feed type-anywhere search, so the
// shortcut was rebound to `Enter` + guards against popup-open and
// search-active states.
//
// Story 3.3 AC #10: `/` is back — it opens TodoInput pre-filled with
// `/` so slash-command mode is reachable in one keypress. Same guards
// as Enter; belt-and-braces stopImmediatePropagation so the Story 5.3
// search handler (also window-level) doesn't ALSO consume it.
describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    usePondStore.setState({
      activePopupTodoId: null,
      searchQuery: '',
      searchActive: false,
    });
  });

  it('opens the input with empty initial on Enter when nothing else is active', () => {
    const onOpen = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts(onOpen));
    dispatch('Enter');
    expect(onOpen).toHaveBeenCalledWith('');
    unmount();
  });

  it('opens the input with "/" initial on bare `/` (story 3.3 AC #10)', () => {
    const onOpen = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts(onOpen));
    dispatch('/');
    expect(onOpen).toHaveBeenCalledWith('/');
    unmount();
  });

  it('does NOT fire on bare `n` or `N` (retired pre-5.3 shortcuts)', () => {
    const onOpen = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts(onOpen));
    dispatch('n');
    dispatch('N');
    expect(onOpen).not.toHaveBeenCalled();
    unmount();
  });

  it('calls preventDefault + stopImmediatePropagation on the `/` path', () => {
    const onOpen = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts(onOpen));

    // Spy on the native event methods by dispatching a handcrafted event.
    const event = new KeyboardEvent('keydown', { key: '/', cancelable: true });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    const stopImmSpy = vi.spyOn(event, 'stopImmediatePropagation');
    window.dispatchEvent(event);

    expect(onOpen).toHaveBeenCalledWith('/');
    expect(preventSpy).toHaveBeenCalled();
    expect(stopImmSpy).toHaveBeenCalled();
    unmount();
  });

  it('does not fire Enter while the action popup is open', () => {
    usePondStore.setState({ activePopupTodoId: 'todo-1' });
    const onOpen = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts(onOpen));
    dispatch('Enter');
    expect(onOpen).not.toHaveBeenCalled();
    unmount();
  });

  it('does not fire `/` while the action popup is open', () => {
    usePondStore.setState({ activePopupTodoId: 'todo-1' });
    const onOpen = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts(onOpen));
    dispatch('/');
    expect(onOpen).not.toHaveBeenCalled();
    unmount();
  });

  it('does not fire Enter while search is active', () => {
    usePondStore.setState({ searchActive: true, searchQuery: 'rev' });
    const onOpen = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts(onOpen));
    dispatch('Enter');
    expect(onOpen).not.toHaveBeenCalled();
    unmount();
  });

  it('does not fire `/` while search is active (flows to search handler)', () => {
    usePondStore.setState({ searchActive: true, searchQuery: 'rev' });
    const onOpen = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts(onOpen));
    dispatch('/');
    expect(onOpen).not.toHaveBeenCalled();
    unmount();
  });

  it('does not fire when an input element has focus', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const onOpen = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts(onOpen));
    dispatch('Enter', input);
    dispatch('/', input);
    expect(onOpen).not.toHaveBeenCalled();
    unmount();
    document.body.removeChild(input);
  });

  it('cleans up the listener on unmount', () => {
    const onOpen = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts(onOpen));
    unmount();
    dispatch('Enter');
    dispatch('/');
    expect(onOpen).not.toHaveBeenCalled();
  });
});
