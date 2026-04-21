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
describe('useKeyboardShortcuts (Story 5.3 rebind)', () => {
  beforeEach(() => {
    usePondStore.setState({
      activePopupTodoId: null,
      searchQuery: '',
      searchActive: false,
    });
  });

  it('opens the input on Enter when nothing else is active', () => {
    const onOpen = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts(onOpen));
    dispatch('Enter');
    expect(onOpen).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('does NOT fire on bare `n`, `N`, or `/` anymore', () => {
    const onOpen = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts(onOpen));
    dispatch('n');
    dispatch('N');
    dispatch('/');
    expect(onOpen).not.toHaveBeenCalled();
    unmount();
  });

  it('does not fire while the action popup is open', () => {
    usePondStore.setState({ activePopupTodoId: 'todo-1' });
    const onOpen = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts(onOpen));
    dispatch('Enter');
    expect(onOpen).not.toHaveBeenCalled();
    unmount();
  });

  it('does not fire while search is active', () => {
    usePondStore.setState({ searchActive: true, searchQuery: 'rev' });
    const onOpen = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts(onOpen));
    dispatch('Enter');
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
    expect(onOpen).not.toHaveBeenCalled();
    unmount();
    document.body.removeChild(input);
  });

  it('cleans up the listener on unmount', () => {
    const onOpen = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts(onOpen));
    unmount();
    dispatch('Enter');
    expect(onOpen).not.toHaveBeenCalled();
  });
});
