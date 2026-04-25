/**
 * Document-level cursor-mode driver.
 *
 * On every mousemove the hook reads the element under the pointer via
 * `document.elementFromPoint`, walks up the DOM looking for an
 * affordance (button, link, text input), and tells `usePondStore`
 * which custom-cursor glyph to render:
 *
 *   - `<button>` (or `[role="button"]`), enabled  → 'point'
 *   - `<button>` (or `[role="button"]`), disabled → 'no-access'
 *   - `<a href>`                                  → 'point'
 *   - `<input>` (text-like) / `<textarea>` /
 *     `[contenteditable]`                         → 'text'
 *   - none of the above                           → 'firefly' (default)
 *
 * The hook deliberately does NOT touch 'grab' / 'grabbing' modes —
 * those are owned by direct callers (LilyPad's drag handle,
 * NeonScrollbar's thumb), and overriding them would flicker the
 * cursor while the user is mid-drag. Anything else flows through
 * here so individual components don't need their own
 * `setCursorMode` boilerplate.
 *
 * Mount once at the App level (alongside `<CursorFirefly />`).
 */

import { useEffect } from 'react';
import { usePondStore } from '../stores/usePondStore';

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'number',
  '', // <input> with no `type=` defaults to text
]);

function inferModeForElement(
  el: Element | null,
): 'point' | 'text' | 'no-access' | 'firefly' {
  let target: Element | null = el;
  while (target && target !== document.body && target !== document.documentElement) {
    const tag = target.tagName;

    if (tag === 'BUTTON') {
      return (target as HTMLButtonElement).disabled ? 'no-access' : 'point';
    }
    if (tag === 'A' && (target as HTMLAnchorElement).href) {
      return 'point';
    }
    if (tag === 'TEXTAREA') {
      return (target as HTMLTextAreaElement).disabled ? 'no-access' : 'text';
    }
    if (tag === 'INPUT') {
      const input = target as HTMLInputElement;
      if (input.disabled) return 'no-access';
      const type = (input.type || '').toLowerCase();
      return TEXT_INPUT_TYPES.has(type) ? 'text' : 'point';
    }
    if ((target as HTMLElement).isContentEditable) {
      return 'text';
    }
    if (target.getAttribute('role') === 'button') {
      const ariaDisabled = target.getAttribute('aria-disabled') === 'true';
      return ariaDisabled ? 'no-access' : 'point';
    }

    target = target.parentElement;
  }
  return 'firefly';
}

export function useGlobalCursorMode(): void {
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const store = usePondStore.getState();
      // Defer to direct callers that own grab-style modes (LilyPad
      // drag handle, NeonScrollbar thumb). Their pointerLeave / drag-
      // end handlers reset to 'firefly', at which point the next
      // mousemove this fires will pick up whatever's under the
      // pointer naturally.
      if (store.cursorMode === 'grab' || store.cursorMode === 'grabbing') {
        return;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const next = inferModeForElement(el);
      if (next !== store.cursorMode) {
        store.setCursorMode(next);
      }
    };
    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, []);
}
