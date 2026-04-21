import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePondSearchKeyboard } from './usePondSearchKeyboard';
import { usePondStore } from '../stores/usePondStore';

// Dispatch a keydown to window, with an optional target override (for
// the input-focus guard test). Matches the pattern used by
// useClosePopupOnEscape.test.ts.
function dispatch(
  key: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
  target?: EventTarget,
) {
  const event = new KeyboardEvent('keydown', {
    key,
    cancelable: true,
    ...modifiers,
  });
  if (target) {
    Object.defineProperty(event, 'target', { value: target, writable: false });
  }
  window.dispatchEvent(event);
  return event;
}

describe('usePondSearchKeyboard', () => {
  beforeEach(() => {
    usePondStore.setState({
      searchQuery: '',
      searchActive: false,
      searchResults: new Map(),
      searchAllMatches: false,
      vectorSearchUnavailable: false,
      activePopupTodoId: null,
      cameraFocus: null,
    });
  });

  it('appends a single printable character to searchQuery', () => {
    const { unmount } = renderHook(() => usePondSearchKeyboard());
    dispatch('a');
    expect(usePondStore.getState().searchQuery).toBe('a');
    expect(usePondStore.getState().searchActive).toBe(true);
    unmount();
  });

  it('accumulates a sequence of characters', () => {
    const { unmount } = renderHook(() => usePondSearchKeyboard());
    dispatch('r');
    dispatch('e');
    dispatch('v');
    expect(usePondStore.getState().searchQuery).toBe('rev');
    unmount();
  });

  it('captures the literal "N" character as a printable key', () => {
    // Regression guard for the useKeyboardShortcuts collision: bare N
    // used to open the new-todo input; it must now land in the search
    // query instead.
    const { unmount } = renderHook(() => usePondSearchKeyboard());
    dispatch('N');
    dispatch('o');
    dispatch('t');
    dispatch('e');
    expect(usePondStore.getState().searchQuery).toBe('Note');
    unmount();
  });

  it('Backspace removes the last character', () => {
    const { unmount } = renderHook(() => usePondSearchKeyboard());
    dispatch('r');
    dispatch('e');
    dispatch('v');
    dispatch('Backspace');
    expect(usePondStore.getState().searchQuery).toBe('re');
    unmount();
  });

  it('Escape clears the full search state without touching the camera', () => {
    // Invariant: search must never touch cameraFocus in either
    // direction. A sentinel cameraFocus (set by some other source
    // like popupOpen) must survive an Escape-clears-search keystroke.
    const sentinelFocus = { x: 1, z: 2, zoom: 10 };
    usePondStore.setState({
      searchQuery: 'review',
      searchActive: true,
      searchResults: new Map([
        ['todo-1', { score: 0.9, matchType: 'hybrid' as const }],
      ]),
      cameraFocus: sentinelFocus,
    });
    const { unmount } = renderHook(() => usePondSearchKeyboard());
    dispatch('Escape');
    const state = usePondStore.getState();
    expect(state.searchQuery).toBe('');
    expect(state.searchActive).toBe(false);
    expect(state.searchResults.size).toBe(0);
    expect(state.cameraFocus).toEqual(sentinelFocus);
    unmount();
  });

  it('ignores keys when an input element has focus', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const { unmount } = renderHook(() => usePondSearchKeyboard());
    dispatch('a', {}, input);
    expect(usePondStore.getState().searchQuery).toBe('');
    unmount();
    document.body.removeChild(input);
  });

  it('ignores keys when the action popup is open', () => {
    usePondStore.setState({ activePopupTodoId: 'todo-1' });
    const { unmount } = renderHook(() => usePondSearchKeyboard());
    dispatch('a');
    expect(usePondStore.getState().searchQuery).toBe('');
    unmount();
  });

  it('ignores keys with Ctrl modifier', () => {
    const { unmount } = renderHook(() => usePondSearchKeyboard());
    dispatch('a', { ctrlKey: true });
    expect(usePondStore.getState().searchQuery).toBe('');
    unmount();
  });

  it('ignores keys with Meta modifier', () => {
    const { unmount } = renderHook(() => usePondSearchKeyboard());
    dispatch('a', { metaKey: true });
    expect(usePondStore.getState().searchQuery).toBe('');
    unmount();
  });

  it('ignores keys with Alt modifier', () => {
    const { unmount } = renderHook(() => usePondSearchKeyboard());
    dispatch('a', { altKey: true });
    expect(usePondStore.getState().searchQuery).toBe('');
    unmount();
  });

  it('ignores non-printable control keys (arrows, function keys, Tab, Enter)', () => {
    const { unmount } = renderHook(() => usePondSearchKeyboard());
    dispatch('ArrowLeft');
    dispatch('F5');
    dispatch('Tab');
    dispatch('Enter');
    expect(usePondStore.getState().searchQuery).toBe('');
    expect(usePondStore.getState().searchActive).toBe(false);
    unmount();
  });

  it('cleans up the window listener on unmount', () => {
    const { unmount } = renderHook(() => usePondSearchKeyboard());
    unmount();
    dispatch('a');
    expect(usePondStore.getState().searchQuery).toBe('');
  });
});
