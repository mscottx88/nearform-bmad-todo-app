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
  // Tracks whether the cursor is currently over the resize handle.
  // Used by the drag-release path to decide whether to revert
  // cursorMode to 'grab' (cursor still over handle) or 'firefly'
  // (cursor elsewhere — without this, letting go of the handle
  // anywhere OTHER than over the handle would leave the frog-hand
  // cursor stuck on screen until the user happens to hover a pad).
  const resizeHandleOverRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // A <textarea> doesn't auto-grow with content — its height defaults
  // to `rows` (2) regardless of CSS `height: auto`. Without this sync,
  // the textarea stays at its min-height and NeonScrollbar never sees
  // overflow, so no scroll chrome appears even when text spills far
  // past the visible region. On every editText (and initial open) we
  // reset height to 'auto' (clears any prior explicit height) then set
  // it to scrollHeight — the intrinsic layout height of the content.
  // useLayoutEffect so the measurement happens before paint and
  // NeonScrollbar's ResizeObserver fires on the same frame.
  useLayoutEffect(() => {
    if (!editing) return;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
    // Belt-and-suspenders: ResizeObserver on the textarea SHOULD
    // already fire and trigger NeonScrollbar's updateThumbs, but
    // in practice React's controlled-component value update and
    // the style.height write can race the RAF-debounced observer.
    // Dispatching a scroll event on the NeonScrollbar inner forces
    // updateThumbs to run synchronously on this frame so the thumb
    // appears the moment content overflows.
    const inner = ta.closest('.neon-scrollbar-inner');
    if (inner instanceof HTMLElement) {
      inner.dispatchEvent(new Event('scroll'));
    }
  }, [editText, editing]);
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

  // Wheel over a NeonScrollbar-wrapped region. If the inner scrollable
  // element can consume the wheel in the gesture direction, stop
  // propagation so the panel's handleWheel above (which re-fires the
  // wheel onto the canvas for OrbitControls zoom) does NOT run — the
  // text scrolls, camera stays put. If the inner can't consume (no
  // overflow or already at an edge), let it bubble so zoom still
  // works for non-scrollable popups / short todos.
  const handleScrollableWheel = useCallback((e: React.WheelEvent<HTMLDivElement>): void => {
    const inner = e.currentTarget.querySelector(
      '.neon-scrollbar-inner',
    ) as HTMLElement | null;
    if (!inner) return;
    const canScrollUp = inner.scrollTop > 0;
    const canScrollDown =
      inner.scrollTop < inner.scrollHeight - inner.clientHeight - 1;
    const wantsUp = e.deltaY < 0;
    const wantsDown = e.deltaY > 0;
    if ((wantsUp && canScrollUp) || (wantsDown && canScrollDown)) {
      e.stopPropagation();
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

  // Resize handle on the bottom edge of the editor — user drags it
  // to grow/shrink the scrollable region. Window-level pointermove /
  // pointerup (not setPointerCapture) because the latter proved
  // unreliable across browsers in testing — the drag felt stuck or
  // didn't travel beyond the handle's initial rect. Window listeners
  // fire regardless of where the cursor ends up.
  const handleEditorResizeStart = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    e.preventDefault();
    editorResizeRef.current = { startY: e.clientY, baseH: editorHeight };
    usePondStore.getState().setCursorMode('grabbing');
    const onMove = (ev: PointerEvent): void => {
      const start = editorResizeRef.current;
      if (!start) return;
      const next = start.baseH + (ev.clientY - start.startY);
      setEditorHeight(Math.max(EDITOR_MIN_HEIGHT, Math.min(EDITOR_MAX_HEIGHT, next)));
    };
    const onUp = (ev: PointerEvent): void => {
      editorResizeRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      // Resolve the element actually under the pointer at release
      // time. If it's a draggable affordance (resize handle or
      // scrollbar thumb), stay on the hover 'grab' glyph; otherwise
      // revert to 'firefly'. The ref alone isn't reliable because
      // browsers suppress pointerenter/leave on elements other than
      // the one that captured the pointerdown, so the ref can drift
      // out of sync mid-drag.
      let overDraggable = false;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (el) {
        overDraggable =
          el.closest('.info-popup__editor-resize') !== null ||
          el.closest('.nsb-thumb') !== null;
      }
      usePondStore.getState().setCursorMode(overDraggable ? 'grab' : 'firefly');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
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
              {/* The text "box" is the NeonScrollbar outer wrapper —
                  its border stays stationary while the textarea (no
                  border) shifts vertically underneath as the user
                  scrolls. `className` threads our editor-box style
                  onto the scrollbar's outer wrapper. onThumbHover /
                  onThumbDrag swap the custom firefly cursor to the
                  frog-hand grab glyph while the user interacts with
                  the scrollbar thumb, matching the affordance
                  LilyPad uses on hover/drag. */}
              {/* Explicit `height` (not `max-height`) so the
                  NeonScrollbar inner's `height: 100%` resolves to a
                  definite value. With only max-height set, the inner
                  falls back to content-sized layout and its
                  scrollHeight never exceeds its clientHeight — no
                  overflow is detected, no thumb appears. Edit mode
                  uses editorHeight as a fixed viewport; overflow
                  above that size scrolls inside. */}
              <NeonScrollbar
                color="cyan"
                className="info-popup__editor-textbox"
                style={{ height: editorHeight }}
                onThumbHover={onDragAffordanceHover}
                onThumbDrag={onDragAffordanceDrag}
              >
                <textarea
                  ref={textareaRef}
                  className="info-popup__editor-textarea"
                  value={editText}
                  autoFocus
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    // Keymap (user spec 2026-04-23):
                    //   Escape        — cancel, discard draft
                    //   Enter (plain) — save (commit trimmed text)
                    //   Ctrl/⌘ + Enter — insert a newline at cursor
                    //   Shift + Enter — also insert a newline (idiomatic)
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      cancelEdit();
                      return;
                    }
                    if (e.key !== 'Enter') return;
                    const wantsNewline = e.ctrlKey || e.metaKey || e.shiftKey;
                    if (!wantsNewline) {
                      e.preventDefault();
                      commitEdit();
                      return;
                    }
                    // Ctrl / ⌘ + Enter — browsers default to a newline in
                    // some UAs but not all; insert it manually so the
                    // behaviour is consistent. Manual splice preserves
                    // the selection range on replace.
                    e.preventDefault();
                    const target = e.currentTarget;
                    const start = target.selectionStart;
                    const end = target.selectionEnd;
                    const next = editText.slice(0, start) + '\n' + editText.slice(end);
                    setEditText(next);
                    // Restore caret after React commits the controlled value.
                    requestAnimationFrame(() => {
                      target.selectionStart = start + 1;
                      target.selectionEnd = start + 1;
                    });
                  }}
                />
              </NeonScrollbar>
              <div
                className="info-popup__editor-resize"
                onPointerDown={handleEditorResizeStart}
                onPointerEnter={handleEditorResizeEnter}
                onPointerLeave={handleEditorResizeLeave}
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
