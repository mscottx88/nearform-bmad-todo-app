import { useEffect } from 'react';
import { usePondStore } from '../stores/usePondStore';

export function useClosePopupOnEscape() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;

      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return;
      }

      const {
        activePopupTodoId,
        closePopup,
        searchActive,
        selectedPadIds,
        clearSelection,
      } = usePondStore.getState();
      if (activePopupTodoId !== null) {
        closePopup();
        return;
      }
      // Story 4.6 AC #2: with no popup and no search, Escape clears
      // the multi-selection set. Search Escape-handling already runs
      // through its own keyboard hook (usePondSearchKeyboard) and
      // takes priority via `searchActive` check — we do not clobber
      // the user's search with a selection clear.
      if (!searchActive && selectedPadIds.size > 0) {
        clearSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
