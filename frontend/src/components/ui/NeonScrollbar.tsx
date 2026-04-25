/**
 * NeonScrollbar — Custom neon wireframe scrollbar.
 *
 * Replaces native browser scrollbars with DOM thumbs so the cursor snake
 * continues tracking during scroll-thumb drag (native scrollbars capture
 * input at the OS compositor level; DOM thumbs fire standard mousemove events).
 *
 * Two modes:
 *   - Wrap mode (default): provide `children`. Component renders an inner
 *     scrollable div that contains the children; tracks overlay that inner.
 *   - Overlay mode: provide `scrollElement` (the externally-owned scrollable
 *     HTMLElement — e.g. a textarea). Component renders only tracks + thumbs
 *     and drives them against the external element's scrollTop/scrollHeight.
 *     The outer wrapper becomes absolutely positioned so the consumer can
 *     layer it over their own scrollable element.
 */

import React, { useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import './NeonScrollbar.css';

export type NeonScrollbarColor = 'cyan' | 'orange' | 'gold' | 'green' | 'pink';

interface NeonScrollbarProps {
  /** Wrap-mode content. Ignored when `scrollElement` is provided. */
  children?: React.ReactNode;
  color?: NeonScrollbarColor;
  /** Classes applied to the outer wrapper (e.g. existing layout / border classes). */
  className?: string;
  /** Inline styles on the outer wrapper (e.g. flex:1, maxHeight). */
  style?: React.CSSProperties;
  /** Classes applied to the inner scrollable div (e.g. flex layout classes). */
  innerClassName?: string;
  /** Inline styles on the inner div (e.g. overflowX:'hidden'). */
  innerStyle?: React.CSSProperties;
  /**
   * Wrap-mode only: forward the inner scrollable div to this ref for
   * external scroll control. Silently ignored in overlay mode (the
   * consumer already owns `scrollElement` and doesn't need a second
   * handle to the same thing).
   */
  scrollRef?: { current: HTMLDivElement | null };
  /**
   * Overlay mode: drive the thumbs against an externally-owned scrollable
   * element (e.g. a textarea). When the prop is passed at all — even as
   * `null` — the component is in overlay mode: it skips the inner wrapping
   * div, ignores `children`, and positions the outer absolutely over the
   * consumer's layout via the `.neon-scrollbar--overlay` modifier.
   *
   * `null` is the expected initial value when using the recommended
   * state-backed callback-ref pattern (`useState<HTMLElement | null>(null)`
   * + `ref={setEl}`) — the effects early-return until the ref callback
   * delivers the real element and re-runs them.
   *
   * Omit this prop entirely (leave `undefined`) to use wrap mode with
   * `children`.
   */
  scrollElement?: HTMLElement | null;
  /**
   * Wrap-mode only: total items in virtual content (enables virtual
   * Y-thumb sizing). Mixing this with `scrollElement` is undefined
   * behaviour — virtual Y math assumes a DataTable-like DOM where
   * `scrollTop` maps to row index, which doesn't hold for textareas
   * or other externally-owned scrollables. A dev-mode warning fires
   * if both are provided.
   */
  virtualYTotal?: number;
  /** 0-based index of first loaded item in DOM. Wrap-mode only. */
  virtualYStart?: number;
  /** Number of loaded items currently in DOM. Wrap-mode only. */
  virtualYLoadedCount?: number;
  /** Called on track click / drag-release with target 0-based item index. Wrap-mode only. */
  onVirtualYNavigate?: (targetRow: number) => void;
  /**
   * Fired when the thumb enters or leaves hover state. Consumers in
   * this repo use it to swap the firefly cursor to the frog-hand
   * grab glyph while the cursor is over a draggable thumb. Optional
   * — the rag-csv-crew source does not use this and can safely omit.
   */
  onThumbHover?: (hovered: boolean) => void;
  /**
   * Fired at thumb drag-start and drag-end (vertical thumb only —
   * horizontal is infrequent and not draggable in our current
   * layouts). Consumers swap cursorMode to 'grabbing' during drag
   * and back to 'grab' on release. The second argument is the
   * MouseEvent on release so consumers can resolve the element
   * under the cursor (document.elementFromPoint) and decide
   * whether to fall back to the 'grab' affordance or return to
   * 'firefly' when the drag ended somewhere other than the thumb.
   */
  onThumbDrag?: (dragging: boolean, event?: MouseEvent) => void;
}

const MIN_THUMB_PX = 28;
const THUMB_INSET = 3; // px inset on all sides of thumb within track

export const NeonScrollbar: React.FC<NeonScrollbarProps> = ({
  children,
  color = 'cyan',
  className,
  style,
  innerClassName,
  innerStyle,
  scrollRef,
  scrollElement,
  virtualYTotal,
  virtualYStart,
  virtualYLoadedCount,
  onVirtualYNavigate,
  onThumbHover,
  onThumbDrag,
}) => {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const overlayMode = scrollElement !== undefined;
  const thumbYRef = useRef<HTMLDivElement>(null);
  const thumbXRef = useRef<HTMLDivElement>(null);
  const trackYRef = useRef<HTMLDivElement>(null);
  const trackXRef = useRef<HTMLDivElement>(null);
  const cornerRef = useRef<HTMLDivElement>(null);

  // Virtual Y-axis: latest prop values in refs for use inside [] effects
  const virtualYTotalRef = useRef(0);
  const virtualYStartRef = useRef(0);
  const virtualYLoadedCountRef = useRef(0);
  const onVirtualYNavigateRef = useRef(onVirtualYNavigate);
  const onThumbHoverRef = useRef(onThumbHover);
  const onThumbDragRef = useRef(onThumbDrag);
  const virtualStateRef = useRef<{ thumbH: number; visibleRows: number } | null>(null);
  const isDraggingVirtualRef = useRef(false);

  // Sync refs on every render (refs are mutable, no effect needed)
  virtualYTotalRef.current = virtualYTotal ?? 0;
  virtualYStartRef.current = virtualYStart ?? 0;
  virtualYLoadedCountRef.current = virtualYLoadedCount ?? 0;
  onVirtualYNavigateRef.current = onVirtualYNavigate;
  onThumbHoverRef.current = onThumbHover;
  onThumbDragRef.current = onThumbDrag;

  const setInnerRef = useCallback(
    (el: HTMLDivElement | null): void => {
      innerRef.current = el;
      if (scrollRef) scrollRef.current = el;
    },
    [scrollRef],
  );

  // ── Dev-mode invariant checks for mutually-exclusive prop modes ──────────
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (scrollElement !== undefined && children !== undefined) {
      console.warn(
        '[NeonScrollbar] `scrollElement` (overlay mode) and `children` (wrap mode) are mutually exclusive; `children` is ignored in overlay mode. Drop one of them to silence this warning.',
      );
    }
    if (scrollElement !== undefined && (virtualYTotal ?? 0) > 0) {
      console.warn(
        '[NeonScrollbar] `virtualYTotal` is a wrap-mode-only feature — mixing it with `scrollElement` (overlay mode) produces undefined thumb math. Pick one.',
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount-only check
  }, []);

  // ── Update thumb positions and visibility ────────────────────────────────
  // useLayoutEffect runs before paint so thumbs are correctly sized on first render
  // and after remounts (e.g. DataTable pagination replaces the loading screen).
  useLayoutEffect(() => {
    const inner = scrollElement ?? innerRef.current;
    const thumbY = thumbYRef.current;
    const thumbX = thumbXRef.current;
    const trackY = trackYRef.current;
    const trackX = trackXRef.current;
    const corner = cornerRef.current;
    if (!inner || !thumbY || !thumbX || !trackY || !trackX || !corner) return;

    const updateThumbs = (): void => {
      const {
        scrollTop, scrollLeft, scrollHeight, scrollWidth, clientHeight, clientWidth,
      } = inner;

      const trackYH = trackY.clientHeight;
      const trackXW = trackX.clientWidth;
      // Usable range after inset on both ends
      const usableYH = trackYH - THUMB_INSET * 2;
      const usableXW = trackXW - THUMB_INSET * 2;

      const vTotal = virtualYTotalRef.current;
      const vStart = virtualYStartRef.current;
      const vLoaded = virtualYLoadedCountRef.current;
      const useVirtual = vTotal > 0 && vLoaded > 0;

      const showY = scrollHeight > clientHeight + 1 || (useVirtual && vTotal > vLoaded);
      if (showY) {
        let thumbH: number;
        let thumbTop: number;

        if (useVirtual) {
          const maxScrollY = scrollHeight - clientHeight;
          const vpRatio = scrollHeight > 0 ? clientHeight / scrollHeight : 1;
          const visibleRows = Math.min(vpRatio * vLoaded, vTotal);
          thumbH = Math.max(MIN_THUMB_PX, (visibleRows / vTotal) * usableYH);

          const domFrac = maxScrollY > 0 ? scrollTop / maxScrollY : 0;
          const scrolledRows = domFrac * Math.max(0, vLoaded - visibleRows);
          const topRow = vStart + scrolledRows;
          const maxRow = Math.max(0, vTotal - visibleRows);
          const posFrac = maxRow > 0 ? Math.min(1, Math.max(0, topRow / maxRow)) : 0;
          thumbTop = THUMB_INSET + posFrac * (usableYH - thumbH);

          virtualStateRef.current = { thumbH, visibleRows };
        } else {
          thumbH = Math.max(MIN_THUMB_PX, (clientHeight / scrollHeight) * usableYH);
          const maxScrollY = scrollHeight - clientHeight;
          const maxThumbTop = usableYH - thumbH;
          thumbTop = THUMB_INSET + (maxScrollY > 0 ? (scrollTop / maxScrollY) * maxThumbTop : 0);
          virtualStateRef.current = null;
        }

        if (!isDraggingVirtualRef.current) {
          thumbY.style.height = `${thumbH}px`;
          thumbY.style.top = `${thumbTop}px`;
        }
        thumbY.style.display = '';
        trackY.style.display = '';
      } else {
        thumbY.style.display = 'none';
        trackY.style.display = 'none';
        virtualStateRef.current = null;
      }

      const showX = scrollWidth > clientWidth + 1;
      if (showX) {
        const thumbW = Math.max(MIN_THUMB_PX, (clientWidth / scrollWidth) * usableXW);
        const maxScrollX = scrollWidth - clientWidth;
        const maxThumbLeft = usableXW - thumbW;
        const thumbLeft = THUMB_INSET + (maxScrollX > 0 ? (scrollLeft / maxScrollX) * maxThumbLeft : 0);
        thumbX.style.width = `${thumbW}px`;
        thumbX.style.left = `${thumbLeft}px`;
        thumbX.style.display = '';
        trackX.style.display = '';
      } else {
        thumbX.style.display = 'none';
        trackX.style.display = 'none';
      }

      corner.style.display = showY && showX ? '' : 'none';

      // Extend tracks to fill the corner gap when the other axis is hidden
      trackY.style.bottom = showX ? '15px' : '0';
      trackX.style.right = showY ? '15px' : '0';
    };

    // RAF-debounced updater: batches rapid MO/RO firings into one update per frame,
    // preventing the flicker caused by multiple style writes during a React render.
    let pendingRaf: number | null = null;
    const scheduleUpdate = (): void => {
      if (pendingRaf !== null) return;
      pendingRaf = requestAnimationFrame((): void => {
        pendingRaf = null;
        updateThumbs();
      });
    };

    // Scroll events stay immediate for smooth thumb tracking during scrolling.
    inner.addEventListener('scroll', updateThumbs, { passive: true });

    // input events bubble up from <textarea> / <input> descendants when
    // the user types. Without this listener, a textarea whose
    // intrinsic height grows with content wouldn't re-trigger our
    // ResizeObserver (which watches the inner div, not its
    // descendants) or MutationObserver (which only sees childList
    // changes, not attribute/content-driven resizes). Catching
    // `input` here keeps thumb size and position proportional to
    // total-vs-visible lines as the user types.
    inner.addEventListener('input', scheduleUpdate);

    const ro = new ResizeObserver(scheduleUpdate);
    ro.observe(inner);

    // Form controls (textarea, input) have no user-facing DOM children,
    // so the descendant-RO walk and character/subtree MO would be
    // dead code on them. The `input` listener above already catches
    // content changes on these elements — skip the expensive observers
    // entirely.
    const isFormControl =
      inner instanceof HTMLTextAreaElement || inner instanceof HTMLInputElement;
    let mo: MutationObserver | null = null;
    const observedChildren = new WeakSet<Element>();
    const observeDescendants = (): void => {
      inner.querySelectorAll('*').forEach((el) => {
        if (!observedChildren.has(el)) {
          ro.observe(el);
          observedChildren.add(el);
        }
      });
    };
    if (!isFormControl) {
      // Observe every descendant (one-level deep is enough for our
      // current wrap-mode use cases — nested panels, dynamic content).
      // Re-attach if the descendant list changes via the MO below.
      observeDescendants();

      mo = new MutationObserver(() => {
        observeDescendants();
        scheduleUpdate();
      });
      mo.observe(inner, {
        childList: true,
        subtree: true,
        // Catch layout-relevant attribute changes only — narrow
        // `attributeFilter` avoids firing on React's per-keystroke
        // `value=` rewrites (which the `input` listener already
        // handles downstream) and on unrelated data-* attributes.
        attributes: true,
        attributeFilter: ['style', 'class', 'rows', 'cols'],
      });
    }

    updateThumbs();

    return (): void => {
      inner.removeEventListener('scroll', updateThumbs);
      inner.removeEventListener('input', scheduleUpdate);
      ro.disconnect();
      mo?.disconnect();
      if (pendingRaf !== null) cancelAnimationFrame(pendingRaf);
    };
  }, [scrollElement]);

  // ── Vertical thumb drag ──────────────────────────────────────────────────
  useEffect(() => {
    const inner = scrollElement ?? innerRef.current;
    const thumbY = thumbYRef.current;
    const trackY = trackYRef.current;
    if (!inner || !thumbY || !trackY) return;

    let isDragging = false;
    let dragStartMouse = 0;
    let dragStartScroll = 0;
    let dragStartThumbTop = 0;
    let thumbSizeAtStart = 0;
    let trackSizeAtStart = 0;
    let isVirtual = false;
    let vDragFraction: number | null = null;

    const onMouseDown = (e: MouseEvent): void => {
      e.preventDefault();
      isDragging = true;
      dragStartMouse = e.clientY;
      thumbSizeAtStart = thumbY.offsetHeight;
      trackSizeAtStart = trackY.clientHeight;
      if (virtualStateRef.current && onVirtualYNavigateRef.current) {
        isVirtual = true;
        isDraggingVirtualRef.current = true;
        dragStartThumbTop = parseFloat(thumbY.style.top) || 0;
        vDragFraction = null;
      } else {
        isVirtual = false;
        dragStartScroll = inner.scrollTop;
      }
      document.body.style.userSelect = 'none';
      onThumbDragRef.current?.(true);
    };

    const onMouseMove = (e: MouseEvent): void => {
      if (!isDragging) return;
      const usableTrack = trackSizeAtStart - THUMB_INSET * 2;
      const maxThumbTop = usableTrack - thumbSizeAtStart;
      if (maxThumbTop <= 0) return;
      if (isVirtual) {
        const delta = e.clientY - dragStartMouse;
        const newTop = Math.max(THUMB_INSET, Math.min(THUMB_INSET + maxThumbTop, dragStartThumbTop + delta));
        thumbY.style.top = `${newTop}px`;
        vDragFraction = (newTop - THUMB_INSET) / maxThumbTop;
      } else {
        const delta = e.clientY - dragStartMouse;
        const fraction = delta / maxThumbTop;
        const maxScroll = inner.scrollHeight - inner.clientHeight;
        inner.scrollTop = dragStartScroll + fraction * maxScroll;
      }
    };

    const onMouseUp = (e: MouseEvent): void => {
      if (!isDragging) return;
      isDragging = false;
      document.body.style.userSelect = '';
      if (isVirtual && vDragFraction !== null) {
        const vs = virtualStateRef.current;
        const navigate = onVirtualYNavigateRef.current;
        if (vs && navigate) {
          const maxRow = Math.max(0, virtualYTotalRef.current - vs.visibleRows);
          navigate(Math.round(vDragFraction * maxRow));
        }
        vDragFraction = null;
      }
      isVirtual = false;
      isDraggingVirtualRef.current = false;
      onThumbDragRef.current?.(false, e);
    };

    // Hover callbacks — consumers use these to swap the app's custom
    // cursor glyph (e.g. firefly → frog hand) while the thumb is
    // under the pointer. Separate from drag so a brief hover without
    // a click still emits the grab affordance.
    const onThumbEnter = (): void => onThumbHoverRef.current?.(true);
    const onThumbLeave = (): void => onThumbHoverRef.current?.(false);
    thumbY.addEventListener('mouseenter', onThumbEnter);
    thumbY.addEventListener('mouseleave', onThumbLeave);

    thumbY.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return (): void => {
      thumbY.removeEventListener('mouseenter', onThumbEnter);
      thumbY.removeEventListener('mouseleave', onThumbLeave);
      thumbY.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      // Teardown during an active drag (e.g. scrollElement swap,
      // parent unmount) would otherwise leak document.body.userSelect,
      // the 'grabbing' cursor the consumer set via onThumbDrag, and
      // the isDraggingVirtualRef flag that gates thumb auto-sync.
      if (isDragging) {
        isDragging = false;
        document.body.style.userSelect = '';
        isDraggingVirtualRef.current = false;
        onThumbDragRef.current?.(false);
      }
    };
  }, [scrollElement]);

  // ── Horizontal thumb drag ────────────────────────────────────────────────
  useEffect(() => {
    const inner = scrollElement ?? innerRef.current;
    const thumbX = thumbXRef.current;
    const trackX = trackXRef.current;
    if (!inner || !thumbX || !trackX) return;

    let isDragging = false;
    let dragStartMouse = 0;
    let dragStartScroll = 0;
    let thumbSizeAtStart = 0;
    let trackSizeAtStart = 0;

    const onMouseDown = (e: MouseEvent): void => {
      e.preventDefault();
      isDragging = true;
      dragStartMouse = e.clientX;
      dragStartScroll = inner.scrollLeft;
      thumbSizeAtStart = thumbX.offsetWidth;
      trackSizeAtStart = trackX.clientWidth;
      document.body.style.userSelect = 'none';
    };

    const onMouseMove = (e: MouseEvent): void => {
      if (!isDragging) return;
      const usableTrack = trackSizeAtStart - THUMB_INSET * 2;
      const maxThumbLeft = usableTrack - thumbSizeAtStart;
      if (maxThumbLeft <= 0) return;
      const delta = e.clientX - dragStartMouse;
      const fraction = delta / maxThumbLeft;
      const maxScroll = inner.scrollWidth - inner.clientWidth;
      inner.scrollLeft = dragStartScroll + fraction * maxScroll;
    };

    const onMouseUp = (): void => {
      if (!isDragging) return;
      isDragging = false;
      document.body.style.userSelect = '';
    };

    thumbX.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return (): void => {
      thumbX.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      // Mid-drag teardown: restore document.body.userSelect so a
      // scrollElement swap / parent unmount during an X-drag can't
      // leave the page with text-selection disabled.
      if (isDragging) {
        isDragging = false;
        document.body.style.userSelect = '';
      }
    };
  }, [scrollElement]);

  // ── Track click — jump to position ──────────────────────────────────────
  useEffect(() => {
    const inner = scrollElement ?? innerRef.current;
    const trackY = trackYRef.current;
    const trackX = trackXRef.current;
    const thumbY = thumbYRef.current;
    const thumbX = thumbXRef.current;
    if (!inner || !trackY || !trackX || !thumbY || !thumbX) return;

    const onTrackYClick = (e: MouseEvent): void => {
      if (e.target === thumbY) return;
      const rect = trackY.getBoundingClientRect();
      const usable = rect.height - THUMB_INSET * 2;
      const fraction = Math.max(0, Math.min(1, (e.clientY - rect.top - THUMB_INSET) / usable));
      const vs = virtualStateRef.current;
      const navigate = onVirtualYNavigateRef.current;
      if (vs && navigate) {
        const maxRow = Math.max(0, virtualYTotalRef.current - vs.visibleRows);
        navigate(Math.round(fraction * maxRow));
      } else {
        inner.scrollTop = fraction * (inner.scrollHeight - inner.clientHeight);
      }
    };

    const onTrackXClick = (e: MouseEvent): void => {
      if (e.target === thumbX) return;
      const rect = trackX.getBoundingClientRect();
      const usable = rect.width - THUMB_INSET * 2;
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left - THUMB_INSET) / usable));
      inner.scrollLeft = fraction * (inner.scrollWidth - inner.clientWidth);
    };

    trackY.addEventListener('click', onTrackYClick);
    trackX.addEventListener('click', onTrackXClick);

    return (): void => {
      trackY.removeEventListener('click', onTrackYClick);
      trackX.removeEventListener('click', onTrackXClick);
    };
  }, [scrollElement]);

  const outerClass = [
    'neon-scrollbar',
    overlayMode ? 'neon-scrollbar--overlay' : null,
    className,
  ].filter(Boolean).join(' ');
  const innerClass = ['neon-scrollbar-inner', innerClassName].filter(Boolean).join(' ');

  return (
    <div className={outerClass} style={style} data-color={color}>
      {!overlayMode && (
        <div ref={setInnerRef} className={innerClass} style={innerStyle}>
          {children}
        </div>
      )}
      {/*
        `data-cursor-managed`: the thumbs hand-roll their own cursor
        mode (open frog hand on hover, closed fist while dragging) via
        `onThumbHover` / `onThumbDrag` callbacks the consumer wires
        into the global cursor store. The `useGlobalCursorMode` hook
        defers when it sees this attribute, leaving those imperative
        modes intact. Without it, every mousemove over the thumb
        would re-infer (the thumb is just a `<div>`) and reset to
        'firefly', killing the grab affordance.
      */}
      {/*
        Track: clicking jumps to that position, so it reads as a
        clickable affordance — `data-cursor="point"` shows the frog
        pointing-finger glyph on hover. The thumb (a child of the
        track) opts into managed mode so its hover/drag handlers
        own the grab/grabbing modes; the explicit attribute on the
        thumb child takes precedence over the track's `data-cursor`
        when the cursor is over the thumb.
      */}
      <div
        ref={trackYRef}
        className="nsb-track nsb-track-y"
        data-cursor="point"
      >
        <div
          ref={thumbYRef}
          className="nsb-thumb nsb-thumb-y"
          data-cursor-managed=""
        />
      </div>
      <div
        ref={trackXRef}
        className="nsb-track nsb-track-x"
        data-cursor="point"
      >
        <div
          ref={thumbXRef}
          className="nsb-thumb nsb-thumb-x"
          data-cursor-managed=""
        />
      </div>
      <div ref={cornerRef} className="nsb-corner" />
    </div>
  );
};
