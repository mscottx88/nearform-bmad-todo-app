/**
 * NeonScrollbar — Custom neon wireframe scrollbar.
 *
 * Replaces native browser scrollbars with DOM thumbs so the cursor snake
 * continues tracking during scroll-thumb drag (native scrollbars capture
 * input at the OS compositor level; DOM thumbs fire standard mousemove events).
 *
 * Architecture:
 *   Outer wrapper  — position:relative; overflow:hidden; height from context
 *   Inner div      — height:100%; overflow:scroll; hides native scrollbar
 *   Track-Y / Track-X / Corner — position:absolute overlays
 *   Thumb-Y / Thumb-X — position:absolute inside their tracks
 *
 * Content never overlaps the tracks because the inner has padding-right and
 * padding-bottom equal to the track width (10 px), enforced by box-sizing.
 */

import React, { useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import './NeonScrollbar.css';

export type NeonScrollbarColor = 'cyan' | 'orange' | 'gold' | 'green' | 'pink';

interface NeonScrollbarProps {
  children: React.ReactNode;
  color?: NeonScrollbarColor;
  /** Classes applied to the outer wrapper (e.g. existing layout / border classes). */
  className?: string;
  /** Inline styles on the outer wrapper (e.g. flex:1, maxHeight). */
  style?: React.CSSProperties;
  /** Classes applied to the inner scrollable div (e.g. flex layout classes). */
  innerClassName?: string;
  /** Inline styles on the inner div (e.g. overflowX:'hidden'). */
  innerStyle?: React.CSSProperties;
  /** Forward the inner element to this ref for external scroll control. */
  scrollRef?: { current: HTMLDivElement | null };
  /** Total items in virtual content (enables virtual Y-thumb sizing). */
  virtualYTotal?: number;
  /** 0-based index of first loaded item in DOM. */
  virtualYStart?: number;
  /** Number of loaded items currently in DOM. */
  virtualYLoadedCount?: number;
  /** Called on track click / drag-release with target 0-based item index. */
  onVirtualYNavigate?: (targetRow: number) => void;
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
  virtualYTotal,
  virtualYStart,
  virtualYLoadedCount,
  onVirtualYNavigate,
}) => {
  const innerRef = useRef<HTMLDivElement | null>(null);
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
  const virtualStateRef = useRef<{ thumbH: number; visibleRows: number } | null>(null);
  const isDraggingVirtualRef = useRef(false);

  // Sync refs on every render (refs are mutable, no effect needed)
  virtualYTotalRef.current = virtualYTotal ?? 0;
  virtualYStartRef.current = virtualYStart ?? 0;
  virtualYLoadedCountRef.current = virtualYLoadedCount ?? 0;
  onVirtualYNavigateRef.current = onVirtualYNavigate;

  const setInnerRef = useCallback(
    (el: HTMLDivElement | null): void => {
      innerRef.current = el;
      if (scrollRef) scrollRef.current = el;
    },
    [scrollRef],
  );

  // ── Update thumb positions and visibility ────────────────────────────────
  // useLayoutEffect runs before paint so thumbs are correctly sized on first render
  // and after remounts (e.g. DataTable pagination replaces the loading screen).
  useLayoutEffect(() => {
    const inner = innerRef.current;
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

    const ro = new ResizeObserver(scheduleUpdate);
    ro.observe(inner);

    const mo = new MutationObserver(scheduleUpdate);
    mo.observe(inner, { childList: true, subtree: true });

    updateThumbs();

    return (): void => {
      inner.removeEventListener('scroll', updateThumbs);
      ro.disconnect();
      mo.disconnect();
      if (pendingRaf !== null) cancelAnimationFrame(pendingRaf);
    };
  }, []);

  // ── Vertical thumb drag ──────────────────────────────────────────────────
  useEffect(() => {
    const inner = innerRef.current;
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

    const onMouseUp = (): void => {
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
    };

    thumbY.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return (): void => {
      thumbY.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // ── Horizontal thumb drag ────────────────────────────────────────────────
  useEffect(() => {
    const inner = innerRef.current;
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
    };
  }, []);

  // ── Track click — jump to position ──────────────────────────────────────
  useEffect(() => {
    const inner = innerRef.current;
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
  }, []);

  const outerClass = ['neon-scrollbar', className].filter(Boolean).join(' ');
  const innerClass = ['neon-scrollbar-inner', innerClassName].filter(Boolean).join(' ');

  return (
    <div className={outerClass} style={style} data-color={color}>
      <div ref={setInnerRef} className={innerClass} style={innerStyle}>
        {children}
      </div>
      <div ref={trackYRef} className="nsb-track nsb-track-y">
        <div ref={thumbYRef} className="nsb-thumb nsb-thumb-y" />
      </div>
      <div ref={trackXRef} className="nsb-track nsb-track-x">
        <div ref={thumbXRef} className="nsb-thumb nsb-thumb-x" />
      </div>
      <div ref={cornerRef} className="nsb-corner" />
    </div>
  );
};
