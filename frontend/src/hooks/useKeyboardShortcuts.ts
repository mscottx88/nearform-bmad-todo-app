import { useEffect } from 'react';
import { usePondStore } from '../stores/usePondStore';

// Story 5.3: the pre-existing bare-key shortcut (`n`/`N`/`/`) had to
// be retired because type-anywhere search consumes every printable
// character at the window level. Rebinding to `Enter` is unambiguous
// (no printable-char meaning in the search context), matches
// TodoInput's own Enter-to-submit semantics, and doesn't clash with
// browser-reserved modifier shortcuts.
//
// Three guards stack on top of the original input-focus check:
//   1. An input/textarea/contenteditable already has focus.
//   2. A popup is open (its own keystrokes are authoritative).
//   3. A search is active (Enter should NOT open the new-todo input
//      while the user is narrowing the pond — Escape clears first).
export function useKeyboardShortcuts(onOpenInput: () => void) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key !== 'Enter') return;

      // Story 5.3 guards: don't spawn the new-todo input on top of
      // an open popup or an active search.
      const { activePopupTodoId, searchActive } = usePondStore.getState();
      if (activePopupTodoId !== null || searchActive) return;

      e.preventDefault();
      onOpenInput();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenInput]);
}
