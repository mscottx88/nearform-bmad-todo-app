import { useEffect } from 'react';
import { useAgentStore } from '../stores/useAgentStore';
import { usePondStore } from '../stores/usePondStore';

// Story 3.3: the callback now receives the initial input value — the
// Enter path passes `''`, the `/` path passes `'/'` so TodoInput opens
// pre-filled ready for the next keystroke to extend the slash command.
type OpenInputCallback = (initialValue: string) => void;

// Story 5.3: the pre-existing bare-key shortcut (`n`/`N`/`/`) was
// retired because type-anywhere search captures every printable
// character at the window level. Enter is unambiguous (no printable-
// char meaning in the search context). Story 3.3 adds `/` back with
// belt-and-braces stopImmediatePropagation + a carve-out in the
// search handler, so an idle pond's `/` opens TodoInput in
// slash-command mode with one keypress instead of two.
//
// Three guards stack on top of the input-focus check:
//   1. An input/textarea/contenteditable already has focus.
//   2. A popup is open (its own keystrokes are authoritative).
//   3. A search is active (Enter / `/` should not claim when the user
//      is narrowing the pond — Escape clears first).
export function useKeyboardShortcuts(onOpenInput: OpenInputCallback) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Story 6.2 AC 1 + Group C CR P4 + P5 + P6: F1 toggles the agent
      // panel from ANYWHERE — including inside focused inputs and
      // textareas. AC 1 frames F1 as a global panel toggle, and
      // capturing it before the input-focus filter is the only way to
      // suppress the browser's native F1 help dialog (a previous
      // version of this hook returned early on inputs without
      // preventDefault'ing F1, so typing in TodoInput + pressing F1
      // popped the OS help dialog instead of toggling the panel).
      //
      // Bare F1 only — `Ctrl+F1` / `Cmd+F1` / `Shift+F1` / `Alt+F1`
      // are reserved for the OS / browser (macOS uses `Cmd+F1` for
      // mirror-display toggle, etc). `e.repeat` skips the OS auto-
      // repeat firing keydown at ~30Hz when the user holds the key.
      if (
        e.key === 'F1' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey &&
        !e.repeat
      ) {
        e.preventDefault();
        useAgentStore.getState().togglePanel();
        return;
      }

      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const { activePopupTodoId, searchActive } = usePondStore.getState();
      if (activePopupTodoId !== null || searchActive) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        onOpenInput('');
        return;
      }

      // Story 3.3 AC #10: '/' opens TodoInput pre-filled with '/'.
      // stopImmediatePropagation so the Story 5.3 search handler (also
      // window-level) doesn't ALSO consume this '/' as the first char
      // of a new search query — belt-and-braces on top of the search
      // handler's own '/' carve-out.
      if (e.key === '/') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onOpenInput('/');
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenInput]);
}
