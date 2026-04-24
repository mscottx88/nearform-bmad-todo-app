import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import type { Todo } from '../../types';
import { NeonScrollbar } from './NeonScrollbar';
import { PopupColorSwatch } from './PopupColorSwatch';
import { usePondStore } from '../../stores/usePondStore';
import { formatTimestamp, formatRelative } from '../../utils/formatTodoMeta';
import './InfoPopup.css';

const INFO_PANEL_OFFSET_X = 280;
const INFO_PANEL_OFFSET_Y = 120;

// ROYGBIV — Set Color letter tinting (lifted from ActionPopup).
const RAINBOW_HUES = [
  '#ff1744', // R
  '#ff9100', // O
  '#ffea00', // Y
  '#00e676', // G
  '#00b0ff', // B
  '#3d5afe', // I
  '#d500f9', // V
];
function makeRainbowLetters(text: string): ReadonlyArray<{ ch: string; hue: string | null }> {
  let hueIdx = 0;
  return text.split('').map((ch) => {
    if (ch === ' ') return { ch, hue: null };
    const hue = RAINBOW_HUES[hueIdx % RAINBOW_HUES.length];
    hueIdx += 1;
    return { ch, hue };
  });
}
const SET_COLOR_LETTERS = makeRainbowLetters('Set Color');

interface InfoPopupProps {
  todo: Todo;
  focused: boolean;
  /** Fired when Complete/Uncomplete clicked. Only called in focused mode. */
  onComplete?: () => void;
  /** Fired when Delete/Undelete clicked. Only called in focused mode. */
  onDelete?: () => void;
  /** Fired when a swatch is committed. Only called in focused mode. */
  onCommitColor?: (color: string) => void;
  /** Fired on swatch hover/unhover. Only called in focused mode. */
  onPreviewColor?: (color: string | null) => void;
  /** Fired when a new text value is committed via edit mode. */
  onCommitText?: (text: string) => void;
}

function StatusBadge({ label, color }: { label: string; color: string }): React.ReactElement {
  return (
    <span className="info-popup__badge" style={{ color }}>
      {label}
    </span>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <>
      <span className="info-popup__meta-label">{label}</span>
      <span className="info-popup__meta-value">{children}</span>
    </>
  );
}

export function InfoPopup({
  todo,
  focused,
  onComplete,
  onDelete,
  onCommitColor,
  onPreviewColor,
  onCommitText,
}: InfoPopupProps): React.ReactElement {
  // Drag-follow: popup tracks the live drag position while this pad owns
  // activeDragAnchor. Falls back to persisted positionX/positionY at rest.
  const dragAnchor = usePondStore((s) =>
    s.activeDragAnchor?.padId === todo.id ? s.activeDragAnchor : null,
  );
  // Release-flash mitigation: hold the last-known drag position in state
  // so the popup doesn't snap back to the stale persisted value for a
  // frame while the refetch lands (~50-200ms).
  const [stickyPos, setStickyPos] = useState<{ x: number; z: number } | null>(null);
  const wasDraggingRef = useRef(false);
  useEffect(() => {
    if (dragAnchor) {
      wasDraggingRef.current = true;
      setStickyPos({ x: dragAnchor.x, z: dragAnchor.z });
      return;
    }
    if (wasDraggingRef.current && stickyPos) {
      const dx = Math.abs((todo.positionX ?? 0) - stickyPos.x);
      const dz = Math.abs((todo.positionY ?? 0) - stickyPos.z);
      if (dx < 0.1 && dz < 0.1) {
        wasDraggingRef.current = false;
        setStickyPos(null);
      }
    }
  }, [dragAnchor, stickyPos, todo.positionX, todo.positionY]);

  const effective = dragAnchor ?? stickyPos;
  const popupX = effective ? effective.x : todo.positionX ?? 0;
  const popupZ = effective
    ? (effective as { x: number; z: number }).z
    : todo.positionY ?? 0;

  // Swatch sub-panel state (merged from ActionPopup, focused-only).
  const [swatchOpen, setSwatchOpen] = useState(false);
  const [previewColor, setPreviewColor] = useState<string | null>(null);
  // Notify parent on preview change so pad can lerp the preview color.
  useEffect(() => {
    onPreviewColor?.(previewColor);
  }, [previewColor, onPreviewColor]);
  // Any close path (toggle, Escape, commit) clears lingering preview.
  useEffect(() => {
    if (!swatchOpen && previewColor !== null) {
      setPreviewColor(null);
    }
  }, [swatchOpen, previewColor]);
  const collapseSwatch = useCallback(() => {
    setSwatchOpen(false);
    setPreviewColor(null);
  }, []);
  // Focus loss collapses the swatch too — it's focused-mode-only UI.
  useEffect(() => {
    if (!focused && swatchOpen) collapseSwatch();
  }, [focused, swatchOpen, collapseSwatch]);

  // Edit-mode state. Edit happens INLINE in the popup (replaces the
  // readonly text div with a textarea); the text region is
  // user-resizable via a neon resize handle at its bottom edge.
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(todo.text);
  const EDITOR_DEFAULT_HEIGHT = 180;
  const EDITOR_MIN_HEIGHT = 80;
  // Max resize height is viewport-relative so the user can stretch
  // the editor across most of the screen when composing long text.
  // The fallback covers SSR / jsdom (tests) where window is absent.
  const EDITOR_MAX_HEIGHT =
    typeof window !== 'undefined' ? Math.max(480, window.innerHeight - 160) : 800;
  const [editorHeight, setEditorHeight] = useState<number>(EDITOR_DEFAULT_HEIGHT);
  const editorResizeRef = useRef<{ startY: number; baseH: number } | null>(null);
  const resizeHandleOverRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const MIN_THUMB_PX = 40;  // raised from 28 — visible even in tall boxes
  const THUMB_INSET = 3;
  // Thumb sync using only values we KNOW or can measure reliably:
  //   visibleHeight = editorHeight - 2 (border) — always correct from
  //     React state; never reads ta.clientHeight which is 0 until the
  //     drei <Html> portal settles its layout.
  //   textHeight = ta.scrollHeight — intrinsic content measurement;
  //     reliable once the textarea has its value (React sets it before
  //     any effect runs).
  //   scrollOffset = ta.scrollTop — current scroll position.
  const [debugInfo, setDebugInfo] = useState('');
  const syncThumb = useCallback((): void => {
    const ta = textareaRef.current;
    const thumb = thumbRef.current;
    if (!ta || !thumb) return;
    const visibleHeight = editorHeight - 2;
    const textHeight = ta.scrollHeight;
    const scrollOffset = ta.scrollTop;
    const usable = editorHeight - THUMB_INSET * 2;
    const ratio = Math.min(1, visibleHeight / Math.max(textHeight, 1));
    const thumbH = Math.max(MIN_THUMB_PX, ratio * usable);
    const maxTop = usable - thumbH;
    const maxScroll = Math.max(0, textHeight - visibleHeight);
    const scrollFrac = maxScroll > 0 ? scrollOffset / maxScroll : 0;
    thumb.style.display = 'block';
    thumb.style.top = `${THUMB_INSET + scrollFrac * maxTop}px`;
    thumb.style.height = `${thumbH}px`;
    setDebugInfo(`eH=${editorHeight} vis=${visibleHeight} txt=${textHeight} sT=${Math.round(scrollOffset)} h=${Math.round(thumbH)}`);
  }, [editorHeight]);
  useEffect(() => {
    if (!editing) return;
    const ta = textareaRef.current;
    if (!ta) return;
    // Reset scroll to top when edit opens. Without this, autoFocus
    // places the cursor at the end of the text, the browser auto-scrolls
    // the textarea to show the cursor, and the first syncThumb call sees
    // scrollTop = max → scrollFrac = 1 → thumb renders at the bottom as
    // a sliver (if clientHeight is also 0 at that moment).
    ta.scrollTop = 0;
    ta.addEventListener('scroll', syncThumb, { passive: true });
    // ResizeObserver fires once the browser has committed the textarea's
    // layout. Use RAF inside the callback so we read dimensions AFTER
    // the browser has also positioned the drei <Html> portal — without
    // the RAF, clientHeight can still be 0 on the very first RO firing.
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(syncThumb);
    });
    ro.observe(ta);
    // Direct call as belt-and-suspenders for the case where the element
    // already has its final size by the time this effect runs.
    syncThumb();
    return () => {
      ta.removeEventListener('scroll', syncThumb);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [editing, syncThumb]);
  // Also sync whenever content changes (resize or typing).
  useLayoutEffect(() => {
    if (editing) syncThumb();
  }, [editText, editing, syncThumb]);
  // Keep editText in sync with the incoming todo while NOT editing —
  // once edit opens, the user's in-flight draft owns the field.
  useEffect(() => {
    if (!editing) setEditText(todo.text);
  }, [todo.text, editing]);
  // Focus loss collapses edit mode (draft discarded).
  useEffect(() => {
    if (!focused && editing) {
      setEditing(false);
      setEditorHeight(EDITOR_DEFAULT_HEIGHT);
    }
  }, [focused, editing]);

  const handleWheel = useCallback((e: React.WheelEvent): void => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaZ: e.deltaZ,
        deltaMode: e.deltaMode,
        clientX: e.clientX,
        clientY: e.clientY,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        bubbles: true,
      }),
    );
  }, []);

  // Wheel over a scrollable region. If the element can consume the
  // gesture direction, stop propagation so the panel's handleWheel
  // (which re-fires onto the canvas for OrbitControls zoom) does NOT
  // run — text scrolls, camera stays put. Checks both:
  //   - NeonScrollbar inner (readonly text region)
  //   - textarea (edit-mode editor, scrolls natively via overflow-y:auto)
  const handleScrollableWheel = useCallback((e: React.WheelEvent<HTMLDivElement>): void => {
    const wantsUp = e.deltaY < 0;
    const wantsDown = e.deltaY > 0;
    // Readonly NeonScrollbar inner.
    const inner = e.currentTarget.querySelector('.neon-scrollbar-inner') as HTMLElement | null;
    if (inner) {
      const canScrollUp = inner.scrollTop > 0;
      const canScrollDown = inner.scrollTop < inner.scrollHeight - inner.clientHeight - 1;
      if ((wantsUp && canScrollUp) || (wantsDown && canScrollDown)) {
        e.stopPropagation();
      }
      return;
    }
    // Edit-mode textarea (scrolls its own content natively).
    const ta = e.currentTarget.querySelector('.info-popup__editor-textarea') as HTMLTextAreaElement | null;
    if (ta) {
      const canScrollUp = ta.scrollTop > 0;
      const canScrollDown = ta.scrollTop < ta.scrollHeight - ta.clientHeight - 1;
      if ((wantsUp && canScrollUp) || (wantsDown && canScrollDown)) {
        e.stopPropagation();
      }
    }
  }, []);

  const showUpdated = todo.updatedAt !== todo.createdAt;

  const statusBadges: React.ReactElement[] = [];
  if (todo.completed) {
    statusBadges.push(
      <StatusBadge key="completed" label="COMPLETED" color="var(--neon-green)" />,
    );
  }
  if (todo.deleted) {
    statusBadges.push(
      <StatusBadge key="deleted" label="DELETED" color="var(--neon-pink)" />,
    );
  }
  if (todo.archived) {
    statusBadges.push(
      <StatusBadge key="archived" label="ARCHIVED" color="var(--neon-gold)" />,
    );
  }
  if (statusBadges.length === 0) {
    statusBadges.push(
      <StatusBadge key="active" label="ACTIVE" color="var(--neon-green)" />,
    );
  }

  const embeddingColor =
    todo.embeddingStatus === 'failed' ? 'var(--neon-pink)' : 'var(--neon-orange)';

  const panelProps = focused
    ? {
        onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
        onPointerUp: (e: React.PointerEvent) => e.stopPropagation(),
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
        onWheel: handleWheel,
      }
    : {};

  const commitEdit = (): void => {
    const trimmed = editText.trim();
    if (trimmed.length > 0 && trimmed !== todo.text) {
      onCommitText?.(trimmed);
    }
    setEditing(false);
    setEditorHeight(EDITOR_DEFAULT_HEIGHT);
  };
  const cancelEdit = (): void => {
    setEditText(todo.text);
    setEditing(false);
    setEditorHeight(EDITOR_DEFAULT_HEIGHT);
  };

  // Neon thumb drag — scrolls the textarea on mousemove.
  const handleThumbDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    const ta = textareaRef.current;
    if (!ta) return;
    usePondStore.getState().setCursorMode('grabbing');
    document.body.style.userSelect = 'none';
    const startY = e.clientY;
    const startScroll = ta.scrollTop;
    const usable = editorHeight - THUMB_INSET * 2;
    const thumbH = Math.max(MIN_THUMB_PX, (ta.clientHeight / ta.scrollHeight) * usable);
    const maxScroll = ta.scrollHeight - ta.clientHeight;
    const onMove = (ev: MouseEvent): void => {
      const delta = ev.clientY - startY;
      // Map thumb travel range (usable − thumbH) to full scroll range.
      const fraction = delta / (usable - thumbH);
      ta.scrollTop = Math.max(0, Math.min(maxScroll, startScroll + fraction * maxScroll));
    };
    const onUp = (ev: MouseEvent): void => {
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const overDraggable = el?.closest('.info-popup__editor-resize') !== null
        || el?.closest('.info-popup__neon-thumb') !== null;
      usePondStore.getState().setCursorMode(overDraggable ? 'grab' : 'firefly');
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [editorHeight]);

  // Resize handle drag — matches NeonScrollbar's thumb-drag pattern
  // (document-level mousemove / mouseup). Pointer events proved
  // unreliable: some mouse drivers & browsers suppress the window
  // pointermove during a captured gesture, which left the custom
  // cursor overlay frozen mid-drag and sometimes swallowed the
  // pointerup so the drag never ended. Plain mouse events on
  // document work consistently.
  const handleEditorResizeStart = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    e.preventDefault();
    editorResizeRef.current = { startY: e.clientY, baseH: editorHeight };
    usePondStore.getState().setCursorMode('grabbing');
    // Block text selection while dragging so a rapid cursor sweep
    // doesn't highlight text across the popup (same guard
    // NeonScrollbar uses for its thumb drag).
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent): void => {
      const start = editorResizeRef.current;
      if (!start) return;
      const next = start.baseH + (ev.clientY - start.startY);
      setEditorHeight(Math.max(EDITOR_MIN_HEIGHT, Math.min(EDITOR_MAX_HEIGHT, next)));
    };
    const onUp = (ev: MouseEvent): void => {
      editorResizeRef.current = null;
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Resolve the element actually under the pointer at release.
      // If it's a draggable affordance (handle or scrollbar thumb),
      // stay on 'grab'; otherwise revert to 'firefly'.
      let overDraggable = false;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (el) {
        overDraggable =
          el.closest('.info-popup__editor-resize') !== null ||
          el.closest('.nsb-thumb') !== null;
      }
      usePondStore.getState().setCursorMode(overDraggable ? 'grab' : 'firefly');
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Shared cursor-mode helpers — used by both NeonScrollbar instances
  // (read-only and edit) so the firefly → frog-hand swap fires
  // consistently across every draggable affordance inside the popup.
  const onDragAffordanceHover = useCallback((hovered: boolean): void => {
    const store = usePondStore.getState();
    if (hovered) {
      if (store.cursorMode === 'firefly') store.setCursorMode('grab');
    } else {
      if (store.cursorMode === 'grab') store.setCursorMode('firefly');
    }
  }, []);
  // On drag release, resolve the element actually under the cursor
  // (from the MouseEvent coords when available) to decide whether to
  // stay on the 'grab' hover glyph or revert all the way to
  // 'firefly'. Without this, releasing over empty space would leave
  // the frog hand stuck on-screen until the user happened to hover
  // something draggable — because mouseenter / mouseleave transitions
  // don't fire on the thumb if the cursor never crosses it post-release.
  const onDragAffordanceDrag = useCallback((dragging: boolean, e?: MouseEvent): void => {
    const store = usePondStore.getState();
    if (dragging) {
      store.setCursorMode('grabbing');
      return;
    }
    let overDraggable = false;
    if (e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el) {
        overDraggable =
          el.closest('.nsb-thumb') !== null ||
          el.closest('.info-popup__editor-resize') !== null;
      }
    }
    store.setCursorMode(overDraggable ? 'grab' : 'firefly');
  }, []);
  // Resize-handle hover — same firefly↔grab swap as thumb hover, but
  // also updates resizeHandleOverRef so the drag-release handler
  // above can decide whether to revert to grab or firefly.
  const handleEditorResizeEnter = (): void => {
    resizeHandleOverRef.current = true;
    onDragAffordanceHover(true);
  };
  const handleEditorResizeLeave = (): void => {
    resizeHandleOverRef.current = false;
    onDragAffordanceHover(false);
  };

  return (
    <Html
      position={[popupX, 0.4, popupZ]}
      zIndexRange={[16777271, 0]}
      style={{ pointerEvents: 'none', zIndex: 9998 }}
    >
      <div className="info-popup">
        <svg
          className="info-popup__callout"
          width={INFO_PANEL_OFFSET_X}
          height={INFO_PANEL_OFFSET_Y}
          viewBox={`0 0 ${INFO_PANEL_OFFSET_X} ${INFO_PANEL_OFFSET_Y}`}
        >
          <line
            x1={INFO_PANEL_OFFSET_X}
            y1={INFO_PANEL_OFFSET_Y}
            x2="0"
            y2="0"
          />
        </svg>
        <div
          className={`info-popup__panel info-popup__panel--${focused ? 'focused' : 'hover'}`}
          style={{
            transform: `translate(-${INFO_PANEL_OFFSET_X}px, -${INFO_PANEL_OFFSET_Y}px)`,
          }}
          role={focused ? 'dialog' : 'tooltip'}
          aria-live="polite"
          {...panelProps}
        >
          {/* Text region. Readonly by default; clicking it in focused
              mode switches to an inline, resizable textarea — NeonScrollbar
              still owns the overflow chrome. The resize handle below the
              editor lets the user drag to grow/shrink the region. */}
          {editing ? (
            <div className="info-popup__editor-wrap" onWheel={handleScrollableWheel}>
              {/* Direct textarea + inline neon scrollbar overlay.
                  The textarea fills the box (height: editorHeight,
                  overflow-y: auto) and scrolls natively. A neon
                  track+thumb is absolutely positioned on the right,
                  synced via the textarea's own scrollTop /
                  scrollHeight — this avoids the NeonScrollbar
                  architecture mismatch (it scrolls its own inner,
                  not an external element). */}
              <div
                className="info-popup__editor-textbox"
                style={{ height: editorHeight }}
              >
                <textarea
                  ref={textareaRef}
                  className="info-popup__editor-textarea"
                  value={editText}
                  autoFocus
                  onChange={(e) => { setEditText(e.target.value); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { e.stopPropagation(); cancelEdit(); return; }
                    if (e.key !== 'Enter') return;
                    const wantsNewline = e.ctrlKey || e.metaKey || e.shiftKey;
                    if (!wantsNewline) { e.preventDefault(); commitEdit(); return; }
                    e.preventDefault();
                    const t = e.currentTarget;
                    const s = t.selectionStart; const en = t.selectionEnd;
                    setEditText(editText.slice(0, s) + '\n' + editText.slice(en));
                    requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 1; });
                  }}
                />
                {/* Neon scrollbar track — always rendered; thumb is
                    visible only when textarea overflows. */}
                {/* Track + thumb. Thumb is always in the DOM (no
                    conditional) so thumbRef is never null.
                    No `style` prop here — syncThumb owns display /
                    top / height via direct DOM writes. A style prop
                    would be re-applied by React on every re-render,
                    overwriting the JS-managed state. */}
                <div className="info-popup__neon-track">
                  <div
                    ref={thumbRef}
                    className="info-popup__neon-thumb"
                    onMouseDown={handleThumbDragStart}
                    onMouseEnter={() => onDragAffordanceHover(true)}
                    onMouseLeave={() => onDragAffordanceHover(false)}
                  />
                </div>
              </div>
              <div
                className="info-popup__editor-resize"
                onMouseDown={handleEditorResizeStart}
                onMouseEnter={handleEditorResizeEnter}
                onMouseLeave={handleEditorResizeLeave}
                aria-label="Resize editor"
                role="separator"
                aria-orientation="horizontal"
              >
                <span className="info-popup__editor-resize-grip" aria-hidden />
              </div>
            </div>
          ) : (
            <div onWheel={handleScrollableWheel}>
            <NeonScrollbar
              color="cyan"
              style={{ maxHeight: 180 }}
              onThumbHover={onDragAffordanceHover}
              onThumbDrag={onDragAffordanceDrag}
            >
              <div
                className={
                  'info-popup__text' +
                  (focused && onCommitText ? ' info-popup__text--clickable' : '')
                }
                onClick={
                  focused && onCommitText ? () => setEditing(true) : undefined
                }
                role={focused && onCommitText ? 'button' : undefined}
                tabIndex={focused && onCommitText ? 0 : undefined}
                onKeyDown={
                  focused && onCommitText
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setEditing(true);
                        }
                      }
                    : undefined
                }
              >
                {todo.text}
              </div>
            </NeonScrollbar>
            </div>
          )}
          {/* TEMP DEBUG — inside panel so it is not clipped */}
          {editing && debugInfo && (
            <div style={{ fontFamily: 'monospace', fontSize: '9px', color: '#ff0', background: '#000', padding: '2px 4px', lineHeight: 1.4, letterSpacing: 0 }}>
              {debugInfo}
            </div>
          )}
          <div className="info-popup__divider" />
          <div className="info-popup__meta">
            <MetaRow label="Created">
              {formatTimestamp(todo.createdAt)}{' '}
              <span style={{ opacity: 0.7 }}>{formatRelative(todo.createdAt)}</span>
            </MetaRow>
            {showUpdated && (
              <MetaRow label="Updated">
                {formatTimestamp(todo.updatedAt)}{' '}
                <span style={{ opacity: 0.7 }}>{formatRelative(todo.updatedAt)}</span>
              </MetaRow>
            )}
            <MetaRow label="Status">{statusBadges}</MetaRow>
            {todo.embeddingStatus !== 'complete' && (
              <MetaRow label="Embedding">
                <span style={{ color: embeddingColor, textTransform: 'uppercase' }}>
                  {todo.embeddingStatus}
                </span>
              </MetaRow>
            )}
            <MetaRow label="Position">
              ({popupX.toFixed(2)}, {popupZ.toFixed(2)})
            </MetaRow>
          </div>

          {/* Actions — focused mode only (merged from ActionPopup).
              Hidden while editing; the edit interaction is entirely
              keyboard-driven (Enter saves, Escape cancels, Ctrl/⌘/
              Shift + Enter inserts a newline). */}
          {focused && !editing && (
            <>
              <div className="info-popup__divider" />
              <div className="info-popup__actions">
                {onComplete && (
                  <button
                    type="button"
                    className="info-popup__button info-popup__button--complete"
                    onClick={onComplete}
                  >
                    {todo.completed ? 'Uncomplete' : 'Complete'}
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    className="info-popup__button info-popup__button--delete"
                    onClick={onDelete}
                  >
                    {todo.deleted ? 'Undelete' : 'Delete'}
                  </button>
                )}
                {onCommitColor && (
                  <button
                    type="button"
                    className="info-popup__button info-popup__button--set-color"
                    onClick={() => setSwatchOpen((open) => !open)}
                    aria-label="Set Color"
                    aria-expanded={swatchOpen}
                  >
                    {SET_COLOR_LETTERS.map(({ ch, hue }, i) =>
                      hue === null ? (
                        <span key={i} aria-hidden>
                          {' '}
                        </span>
                      ) : (
                        <span
                          key={i}
                          style={{ color: hue, textShadow: `0 0 4px ${hue}` }}
                          aria-hidden
                        >
                          {ch}
                        </span>
                      ),
                    )}
                  </button>
                )}
                {swatchOpen && onCommitColor && (
                  <PopupColorSwatch
                    committedColor={todo.color || '#00ff88'}
                    onHover={setPreviewColor}
                    onCommit={(color) => {
                      onCommitColor(color);
                      collapseSwatch();
                    }}
                    onCollapse={collapseSwatch}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Html>
  );
}
