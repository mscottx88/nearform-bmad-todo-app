import { useEffect } from 'react';
import { usePondStore } from '../stores/usePondStore';

// Module-scope sentinel: if two components both mount this hook (HMR
// double-render, a hypothetical split-pane feature, accidental second
// import), the second mount becomes a no-op instead of duplicating
// every keystroke into the search query. The hook is designed to be
// mounted exactly once at the top of PondScene; this guard turns
// "mounted twice" from a silent correctness bug into a dev-visible
// warning.
let mountCount = 0;

// Story 5.3: type-anywhere search keyboard capture.
//
// Installs ONE window-level keydown listener that translates bare
// printable keys into search-query characters, Backspace into edits,
// and Escape into a full search reset. Event targeting is filtered
// out of the usual interactive surfaces (inputs, popups) so typing
// inside TodoInput or ActionPopup is never hijacked.
//
// See the story's § "Keyboard-handler audit" for the catalogue of
// other keyboard listeners in the app and how they coexist with this
// one (short version: useClosePopupOnEscape shares Escape by design,
// PopupColorSwatch's Escape is capture-phase and only live while the
// color sub-panel is open, TodoInput's onKeyDown is element-scoped,
// drei OrbitControls only claims arrow keys).
export function usePondSearchKeyboard(): void {
  useEffect(() => {
    mountCount += 1;
    if (mountCount > 1) {
      // Second mount — don't register a listener (would double every
      // keystroke). Log in dev so the regression is visible; prod is
      // silent since the user impact is already "nothing extra happens".
      if (import.meta.env.DEV) {
        console.warn(
          'usePondSearchKeyboard mounted more than once; subsequent mounts are no-ops.',
        );
      }
      return () => {
        mountCount -= 1;
      };
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip events inside editable surfaces — same check as
      // useClosePopupOnEscape. Keeps TodoInput and any future input
      // free of unwanted hijacking.
      //
      // Check BOTH `e.target` (the element that received the event)
      // AND `document.activeElement` (the element with actual input
      // focus). A user can open the TodoInput, click outside it so
      // focus drifts to body, and then start typing — the event
      // target is <body> but the user "thinks" they're typing into
      // the TodoInput. The activeElement fallback covers that case.
      const isEditableElement = (el: Element | null): boolean =>
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable);
      if (
        isEditableElement(e.target as Element | null) ||
        isEditableElement(document.activeElement)
      ) {
        return;
      }

      // Skip events when the action popup is open — it has its own
      // keyboard story (Escape to close, swatch nav, etc.). AC #14.
      const state = usePondStore.getState();
      if (state.activePopupTodoId !== null) return;

      // Leave OS / browser shortcuts alone (Ctrl+N, Cmd+A, Alt+Tab,
      // Cmd+Shift+T, Meta+Space, etc.). AC #1.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Escape') {
        state.clearSearch();
        return;
      }

      if (e.key === 'Backspace') {
        // preventDefault so browser "back" navigation doesn't fire
        // (some keyboards route Backspace through History.back when
        // no input is focused).
        e.preventDefault();
        state.backspaceSearch();
        return;
      }

      // `e.key.length === 1` is the cheap printable-char filter:
      // letters, digits, punctuation, space all satisfy it; arrow
      // keys, F-keys, Enter, Tab, Shift all produce multi-char names
      // and are skipped. Paired with the modifier check above, this
      // catches exactly the bare typing cases.
      if (e.key.length !== 1) return;

      e.preventDefault();
      state.appendSearchChar(e.key);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      mountCount -= 1;
    };
  }, []);
}
