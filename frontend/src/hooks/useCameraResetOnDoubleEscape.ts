import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePondStore } from '../stores/usePondStore';
import { fitCameraToPads } from '../components/pond/fitCameraToPads';
import { TODOS_KEY } from '../api/todoApi';
import type { Todo } from '../types';

const ESC_DOUBLE_WINDOW_MS = 600;

/**
 * Story 3.1 AC #4: two Escape keypresses within 600ms dispatch a
 * camera reset toward a fit computed from the current pad cluster.
 *
 * Additive behavior: this hook does NOT preventDefault or
 * stopPropagation — useClosePopupOnEscape (popup close) and
 * usePondSearchKeyboard (search clear) continue to handle their
 * own single-Escape logic. This one observes timestamps and
 * dispatches the reset independently.
 *
 * Input guard: Escape keydowns originating inside a focused input,
 * textarea, or contenteditable element are ignored — matches the
 * guard in useClosePopupOnEscape so the user's in-input Escape
 * handling isn't shadowed.
 *
 * Consume-on-trigger: after firing the reset, the timestamp is
 * cleared so a third rapid Escape doesn't immediately trigger a
 * second reset.
 */
export function useCameraResetOnDoubleEscape(): void {
  // Seeded to -Infinity so the first ESC is never within the window of
  // a phantom prior ESC at t=0 — the first keypress just records a
  // timestamp and returns.
  const lastEscapeTs = useRef(Number.NEGATIVE_INFINITY);
  const queryClient = useQueryClient();

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (
        t?.tagName === 'INPUT' ||
        t?.tagName === 'TEXTAREA' ||
        t?.isContentEditable
      ) {
        return;
      }
      const now = performance.now();
      if (now - lastEscapeTs.current < ESC_DOUBLE_WINDOW_MS) {
        // Story 3.3: useTodos now keys per visibility triple, so the
        // plain ['todos', 'list'] key no longer resolves. Read every
        // cache entry under that prefix and merge — de-dupe by id so
        // overlapping triples (e.g. active-only + all-three) don't
        // double-count the same pad in the fit computation.
        const entries = queryClient.getQueriesData<Todo[]>({
          queryKey: TODOS_KEY,
        });
        const todos: Todo[] = [];
        const seen = new Set<string>();
        for (const [, data] of entries) {
          if (!data) continue;
          for (const t of data) {
            if (seen.has(t.id)) continue;
            seen.add(t.id);
            todos.push(t);
          }
        }
        const fit = fitCameraToPads(todos);
        usePondStore.getState().requestCameraReset(fit);
        // Consume the double-tap so a third rapid ESC doesn't fire a second reset.
        lastEscapeTs.current = Number.NEGATIVE_INFINITY;
      } else {
        lastEscapeTs.current = now;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [queryClient]);
}
