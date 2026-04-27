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

/** Sentinel return value: "this element manages its own cursor mode
 *  imperatively — leave whatever the store currently has set alone."
 *  Used for `<canvas>` (R3F 3D scene; LilyPad's onPointerEnter sets
 *  'point' / 'grabbing' directly) and any element opting in via the
 *  `data-cursor-managed` attribute. */
type InferredMode = 'point' | 'text' | 'no-access' | 'firefly' | 'managed';

/** Whitelist of explicit `data-cursor` attribute values that the hook
 *  will honour. Anything else is ignored so a typo doesn't stick the
 *  cursor on a never-cleared mode. */
const EXPLICIT_CURSOR_VALUES = new Set([
  'point',
  'text',
  'no-access',
  'firefly',
]);

/**
 * Walk up from `el` looking for an interactive affordance. If none is
 * found, fall through and check whether the original target hovers
 * over selectable text — if so, show the I-beam glyph (mirrors the
 * OS default cursor behaviour over `<p>`, `<span>`, etc. with the
 * default `user-select: text`).
 */
function inferModeForElement(el: Element | null): InferredMode {
  const original = el;
  let target: Element | null = el;
  while (target && target !== document.body && target !== document.documentElement) {
    const tag = target.tagName;

    if (tag === 'CANVAS' || target.hasAttribute('data-cursor-managed')) {
      return 'managed';
    }
    // Explicit override via `data-cursor="<mode>"` — useful for
    // clickable affordances that aren't natural buttons / inputs
    // (e.g. the NeonScrollbar track jumps to the click position so
    // it should read as 'point' even though it's a `<div>`).
    const explicit = target.getAttribute('data-cursor');
    if (explicit && EXPLICIT_CURSOR_VALUES.has(explicit)) {
      return explicit as InferredMode;
    }
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

  // No interactive affordance ancestor — fall through to the
  // selectable-text check. `user-select: text` (the default for
  // most prose) means the user can drag-select; show the I-beam to
  // signal that. `user-select: none` (UI chrome, decorative spans)
  // stays on the firefly default.
  if (original instanceof HTMLElement && original.textContent?.trim()) {
    const style = window.getComputedStyle(original);
    if (style.userSelect !== 'none') {
      return 'text';
    }
  }
  return 'firefly';
}

export function useGlobalCursorMode(): void {
  useEffect(() => {
    // Story 6.2 Group C CR P7: rAF-coalesce the inference traversal.
    // `document.elementFromPoint` is called synchronously in the
    // move handler (it's a single hit-test, the cheap part, AND
    // tests rely on it being captured at event-dispatch time when
    // `elementFromPoint` is stubbed). The expensive walk —
    // `inferModeForElement` with its `getComputedStyle` /
    // `userSelect` reads on the selectable-text fallback — is
    // deferred to a rAF callback so a 1000Hz mouse only triggers
    // one traversal per frame instead of hundreds.
    let pendingEl: Element | null = null;
    let scheduled = false;

    const runInference = () => {
      scheduled = false;
      const store = usePondStore.getState();
      // Only defer during ACTIVE drags. 'grab' (hover affordance) is
      // re-inferred every mousemove so a stale 'grab' set by one
      // component (e.g. InfoPopup leaving its panel) can't poison the
      // cursor for the rest of the page. Hover handlers that need
      // 'grab' to persist mark their element with the
      // `data-cursor-managed` attribute (or rely on `<canvas>`); the
      // hook returns 'managed' for those and skips the override
      // entirely.
      //
      // Story 6.9: 'resize-h' is also imperatively-owned — the
      // AgentPanel resize handle's pointerEnter/Leave/Down/Up handlers
      // own the lifecycle (and need to keep the cursor on resize-h
      // mid-drag even when the pointer has moved off the handle).
      // Without this skip, the hook would clobber resize-h back to
      // firefly on the next mousemove.
      if (store.cursorMode === 'grabbing' || store.cursorMode === 'resize-h') {
        return;
      }
      const next = inferModeForElement(pendingEl);
      // 'managed' is a sentinel: the cursor is over a self-managing
      // element (R3F canvas, opt-in `data-cursor-managed`). Skip
      // overriding the imperative mode that element's own handlers
      // set — but FIRST clear hook-owned modes that wouldn't be
      // valid inside the managed region. Without this clear, a
      // stale 'text' (set by hovering a paragraph) or 'no-access'
      // (set by hovering a disabled button) "leaks" into the
      // managed region until LilyPad's pointerEnter happens to fire
      // — which it doesn't if the user moves over empty water.
      if (next === 'managed') {
        if (
          store.cursorMode === 'text' ||
          store.cursorMode === 'no-access'
        ) {
          store.setCursorMode('firefly');
        }
        return;
      }
      if (next !== store.cursorMode) {
        store.setCursorMode(next);
      }
    };

    const onMove = (e: MouseEvent) => {
      pendingEl = document.elementFromPoint(e.clientX, e.clientY);
      if (scheduled) return;
      scheduled = true;
      // Tests dispatch synthetic mousemoves and read the store
      // synchronously via `act(() => dispatch())`. `requestAnimationFrame`
      // in jsdom flushes during `act`'s scheduler tick — but only if
      // we DON'T also defer past `act`'s boundary. Run inference
      // synchronously when rAF isn't available (jsdom guards), or
      // schedule via rAF in real browsers.
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(runInference);
      } else {
        runInference();
      }
    };

    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, []);
}
