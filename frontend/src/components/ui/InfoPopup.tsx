import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  const EDITOR_MAX_HEIGHT = 480;
  const [editorHeight, setEditorHeight] = useState<number>(EDITOR_DEFAULT_HEIGHT);
  const editorResizeRef = useRef<{ startY: number; baseH: number } | null>(null);
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
  // to grow/shrink the scrollable region. Uses setPointerCapture so
  // the drag stays locked to the handle even when the cursor (and
  // the handle itself, which moves as the panel reflows) can't
  // perfectly track each other — gets rid of the "clunky" feel of
  // window-level listeners lagging a fast drag.
  const handleEditorResizeStart = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    e.preventDefault();
    const handle = e.currentTarget;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // jsdom / older browsers may not support setPointerCapture; the
      // listeners below still fire via standard event propagation.
    }
    editorResizeRef.current = { startY: e.clientY, baseH: editorHeight };
    const onMove = (ev: PointerEvent): void => {
      const start = editorResizeRef.current;
      if (!start) return;
      const next = start.baseH + (ev.clientY - start.startY);
      setEditorHeight(Math.max(EDITOR_MIN_HEIGHT, Math.min(EDITOR_MAX_HEIGHT, next)));
    };
    const onUp = (ev: PointerEvent): void => {
      editorResizeRef.current = null;
      try {
        handle.releasePointerCapture(ev.pointerId);
      } catch {
        // Ignore — releasePointerCapture may throw if never captured.
      }
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
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
            <div className="info-popup__editor-wrap">
              <NeonScrollbar color="cyan" style={{ maxHeight: editorHeight }}>
                <textarea
                  className="info-popup__editor-textarea"
                  value={editText}
                  autoFocus
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      cancelEdit();
                    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      commitEdit();
                    }
                  }}
                />
              </NeonScrollbar>
              <div
                className="info-popup__editor-resize"
                onPointerDown={handleEditorResizeStart}
                aria-label="Resize editor"
                role="separator"
                aria-orientation="horizontal"
              >
                <span className="info-popup__editor-resize-grip" aria-hidden />
              </div>
            </div>
          ) : (
            <NeonScrollbar color="cyan" style={{ maxHeight: 180 }}>
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
              While editing the text, the action row shows Save / Cancel
              instead of Complete / Delete / Set Color so the whole
              edit interaction stays inside the same popup. */}
          {focused && (
            <>
              <div className="info-popup__divider" />
              <div className="info-popup__actions">
                {editing ? (
                  <>
                    <button
                      type="button"
                      className="info-popup__button info-popup__button--complete"
                      onClick={commitEdit}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="info-popup__button info-popup__button--delete"
                      onClick={cancelEdit}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Html>
  );
}
