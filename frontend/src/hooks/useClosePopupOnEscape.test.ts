import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useClosePopupOnEscape } from './useClosePopupOnEscape';
import { usePondStore } from '../stores/usePondStore';

function dispatchEscape(target?: EventTarget) {
  const event = new KeyboardEvent('keydown', { key: 'Escape' });
  if (target) {
    Object.defineProperty(event, 'target', { value: target, writable: false });
  }
  window.dispatchEvent(event);
}

describe('useClosePopupOnEscape', () => {
  beforeEach(() => {
    usePondStore.setState({ activePopupTodoId: null, cameraFocus: null });
  });

  it('closes the popup when Escape is pressed and a popup is active', () => {
    usePondStore.setState({ activePopupTodoId: 'todo-1' });
    const { unmount } = renderHook(() => useClosePopupOnEscape());
    dispatchEscape();
    expect(usePondStore.getState().activePopupTodoId).toBeNull();
    unmount();
  });

  it('is a no-op when no popup is active', () => {
    const closeSpy = vi.spyOn(usePondStore.getState(), 'closePopup');
    const { unmount } = renderHook(() => useClosePopupOnEscape());
    dispatchEscape();
    expect(closeSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('does nothing when the Escape is fired from an input element', () => {
    usePondStore.setState({ activePopupTodoId: 'todo-1' });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const { unmount } = renderHook(() => useClosePopupOnEscape());
    dispatchEscape(input);
    expect(usePondStore.getState().activePopupTodoId).toBe('todo-1');
    unmount();
    document.body.removeChild(input);
  });

  it('cleans up the listener on unmount', () => {
    usePondStore.setState({ activePopupTodoId: 'todo-1' });
    const { unmount } = renderHook(() => useClosePopupOnEscape());
    unmount();
    dispatchEscape();
    expect(usePondStore.getState().activePopupTodoId).toBe('todo-1');
  });

  // Story 4.6 AC #2: Escape clears multi-selection when no popup/search.
  describe('story 4.6 — Escape clears multi-selection', () => {
    beforeEach(() => {
      usePondStore.setState({
        activePopupTodoId: null,
        searchActive: false,
        selectedPadIds: new Set(),
      });
    });

    it('clears selection when no popup and no search', () => {
      usePondStore.setState({ selectedPadIds: new Set(['a', 'b']) });
      const { unmount } = renderHook(() => useClosePopupOnEscape());
      dispatchEscape();
      expect(usePondStore.getState().selectedPadIds.size).toBe(0);
      unmount();
    });

    it('prefers closing the popup over clearing selection', () => {
      usePondStore.setState({
        activePopupTodoId: 'todo-1',
        selectedPadIds: new Set(['a', 'b']),
      });
      const { unmount } = renderHook(() => useClosePopupOnEscape());
      dispatchEscape();
      expect(usePondStore.getState().activePopupTodoId).toBeNull();
      // Selection preserved — a second Escape would clear it.
      expect(usePondStore.getState().selectedPadIds.size).toBe(2);
      unmount();
    });

    it('does not clear selection while search is active', () => {
      usePondStore.setState({
        searchActive: true,
        selectedPadIds: new Set(['a']),
      });
      const { unmount } = renderHook(() => useClosePopupOnEscape());
      dispatchEscape();
      // Search hook owns Escape when active — selection untouched.
      expect(usePondStore.getState().selectedPadIds.size).toBe(1);
      unmount();
    });
  });
});
