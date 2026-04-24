import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import type { Todo } from '../../types';
import { NeonScrollbar } from './NeonScrollbar';
import { PopupColorSwatch } from './PopupColorSwatch';
import { usePondStore } from '../../stores/usePondStore';
import { useWorldStore } from '../../stores/useWorldStore';
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
  /**
   * PondScene-controlled fade-out flag. When true, the panel runs the
   * exit animation (opacity → 0). The parent keeps InfoPopup mounted
   * for the animation duration before unmounting it. Defaults to false.
   */
  dismissing?: boolean;
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
  dismissing = false,
  onComplete,
  onDelete,
  onCommitColor,
  onPreviewColor,
  onCommitText,
}: InfoPopupProps): React.ReactElement {
  // Story 3.4 (CR reversal 2026-04-23): popup does NOT follow the pad
  // during drag. LilyPad clears hoveredTodoId on drag-start; the popup
  // fades out via the `dismissing` prop (PondScene-controlled) and can
  // reappear only after release via a fresh pointerEnter.
  // Story 4.9: popup anchor tracks the world store, not the todo
  // prop. The prop lags the store between drag release and the React
  // Query refetch (~50–200 ms), which used to flash the popup's
  // callout line back to the pad's pre-drag position. Per-field
  // selectors keep the re-render scope minimal (a re-render fires
  // only when THIS todo's positionX or positionY changes).
  const popupX = useWorldStore(
    (s) => s.worldMetadata.get(todo.id)?.positionX ?? todo.positionX ?? 0,
  );
  const popupZ = useWorldStore(
    (s) => s.worldMetadata.get(todo.id)?.positionY ?? todo.positionY ?? 0,
  );

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
  // user-resizable via a neon resize handle at its bottom edge. The
  // neon scrollbar chrome comes from the shared NeonScrollbar component
  // in overlay mode (drives its thumb against the textarea's native
  // scrollTop), so there's no bespoke thumb math here.
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(todo.text);
  const EDITOR_DEFAULT_HEIGHT = 180;
  const EDITOR_MIN_HEIGHT = 80;
  // Max resize height is viewport-relative. Kept in state + refreshed
  // on window resize so stretching the window up (or down) while
  // editing immediately adjusts the bound. Fallback covers SSR / jsdom.
  const computeEditorMax = (): number =>
    typeof window !== 'undefined' ? Math.max(480, window.innerHeight - 160) : 800;
  const [editorMaxHeight, setEditorMaxHeight] = useState<number>(computeEditorMax);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = (): void => { setEditorMaxHeight(computeEditorMax()); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); };
  }, []);
  const [editorHeight, setEditorHeight] = useState<number>(EDITOR_DEFAULT_HEIGHT);
  const editorResizeRef = useRef<{ startY: number; baseH: number } | null>(null);
  // Callback ref backed by state so NeonScrollbar's effects fire AFTER
  // the textarea element has actually mounted. useRef.current appeared
  // null to effects when rendered inside a drei <Html> portal —
  // state-backed refs turn mount into a state transition that re-runs
  // consumer effects.
  const [textareaEl, setTextareaEl] = useState<HTMLTextAreaElement | null>(null);
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
  // Reset scroll to top on each edit-open so the user sees the start
  // of the text regardless of where the textarea was last scrolled.
  useEffect(() => {
    if (editing && textareaEl) textareaEl.scrollTop = 0;
  }, [editing, textareaEl]);

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

  // Wheel over a scrollable region. Stop propagation so the panel's
  // handleWheel (which re-fires onto the canvas for OrbitControls zoom)
  // does NOT run — text scrolls, camera stays put. Checks both:
  //   - NeonScrollbar inner (readonly text region)
  //   - textarea (edit-mode editor, scrolls natively via overflow-y:auto)
  //
  // In edit mode we ALWAYS stop — even once the textarea hits its
  // scroll limit — because users reaching the bottom/top of their own
  // text do not expect the camera to start zooming. Readonly mode
  // keeps bubble-at-boundary so the scene scrolls once the content is
  // exhausted (matches the rest-of-app wheel behaviour).
  const handleScrollableWheel = useCallback((e: React.WheelEvent<HTMLDivElement>): void => {
    const ta = e.currentTarget.querySelector('.info-popup__editor-textarea') as HTMLTextAreaElement | null;
    if (ta) {
      e.stopPropagation();
      return;
    }
    const inner = e.currentTarget.querySelector('.neon-scrollbar-inner') as HTMLElement | null;
    if (!inner) return;
    const wantsUp = e.deltaY < 0;
    const wantsDown = e.deltaY > 0;
    const canScrollUp = inner.scrollTop > 0;
    const canScrollDown = inner.scrollTop < inner.scrollHeight - inner.clientHeight - 1;
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

  // Measure the panel for the callout line endpoint. Line runs from
  // the pad centroid (SVG origin at the `.info-popup` zero-size
  // anchor) to the popup centroid. Centroid = panel top-left
  // (`-INFO_PANEL_OFFSET_X, -INFO_PANEL_OFFSET_Y`) + half the
  // measured panel size. ResizeObserver keeps the endpoint in sync
  // as the panel grows / shrinks (hover → focused transition adds
  // action buttons; edit mode + resize handle change height).
  const [panelRect, setPanelRect] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!panelEl) return;
    const measure = (): void => {
      setPanelRect({ w: panelEl.offsetWidth, h: panelEl.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(panelEl);
    return () => { ro.disconnect(); };
  }, [panelEl]);
  const calloutX2 = -INFO_PANEL_OFFSET_X + panelRect.w / 2;
  const calloutY2 = -INFO_PANEL_OFFSET_Y + panelRect.h / 2;

  // Cursor override: when the cursor is over the popup panel itself
  // (not a draggable child like the scrollbar thumb or resize handle),
  // force cursorMode back to 'firefly'. The pad mesh underneath is
  // still considered "hovered" by R3F (the canvas stopped getting
  // pointermove events once the panel started absorbing them, so
  // the pad's own onPointerLeave never fires), which leaves the
  // frog-hand 'grab' glyph stuck on the popup. Only draggable
  // children inside the popup should show the hand; the panel body
  // itself reverts to firefly.
  //
  // mouseenter / mouseleave don't bubble through child transitions,
  // so hovering the scrollbar thumb / resize handle leaves the
  // panel's own mouseleave dormant — their own hover handlers take
  // over. Leaving the popup back toward the pad restores 'grab'
  // since R3F's cached "pad is hovered" is (usually) still valid.
  const handlePanelMouseEnter = useCallback((): void => {
    const store = usePondStore.getState();
    if (store.cursorMode === 'grab') store.setCursorMode('firefly');
  }, []);
  const handlePanelMouseLeave = useCallback((): void => {
    const store = usePondStore.getState();
    if (store.cursorMode === 'firefly') store.setCursorMode('grab');
  }, []);

  const panelProps = focused
    ? {
        onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
        onPointerUp: (e: React.PointerEvent) => e.stopPropagation(),
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
        onWheel: handleWheel,
        onMouseEnter: handlePanelMouseEnter,
        onMouseLeave: handlePanelMouseLeave,
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

  // Resize handle drag — matches NeonScrollbar's thumb-drag pattern
  // (document-level mousemove / mouseup). Pointer events proved
  // unreliable: some mouse drivers & browsers suppress the window
  // pointermove during a captured gesture, which left the custom
  // cursor overlay frozen mid-drag and sometimes swallowed the
  // pointerup so the drag never ended. Plain mouse events on
  // document work consistently.
  //
  // Listener teardown is managed via a ref held by an unmount-cleanup
  // effect — if the component unmounts mid-drag (focused flips,
  // popup closes) the document listeners + body.userSelect + cursor
  // mode would otherwise leak.
  const resizeTeardownRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => { resizeTeardownRef.current?.(); };
  }, []);
  const handleEditorResizeStart = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    e.preventDefault();
    editorResizeRef.current = { startY: e.clientY, baseH: editorHeight };
    usePondStore.getState().setCursorMode('grabbing');
    // Block text selection while dragging so a rapid cursor sweep
    // doesn't highlight text across the popup.
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent): void => {
      const start = editorResizeRef.current;
      if (!start) return;
      const next = start.baseH + (ev.clientY - start.startY);
      setEditorHeight(Math.max(EDITOR_MIN_HEIGHT, Math.min(editorMaxHeight, next)));
    };
    const teardown = (ev?: MouseEvent): void => {
      editorResizeRef.current = null;
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      resizeTeardownRef.current = null;
      // Resolve the element actually under the pointer at release.
      // If it's a draggable affordance (handle or scrollbar thumb),
      // stay on 'grab'; otherwise revert to 'firefly'. Unmount-path
      // teardown (no event) falls straight back to 'firefly'.
      let overDraggable = false;
      if (ev) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        if (el) {
          overDraggable =
            el.closest('.info-popup__editor-resize') !== null ||
            el.closest('.nsb-thumb') !== null;
        }
      }
      usePondStore.getState().setCursorMode(overDraggable ? 'grab' : 'firefly');
    };
    const onUp = (ev: MouseEvent): void => { teardown(ev); };
    resizeTeardownRef.current = () => { teardown(); };
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
  // Resize-handle hover — same firefly↔grab swap as thumb hover.
  const handleEditorResizeEnter = (): void => { onDragAffordanceHover(true); };
  const handleEditorResizeLeave = (): void => { onDragAffordanceHover(false); };

  return (
    <Html
      position={[popupX, 0.4, popupZ]}
      zIndexRange={[16777271, 0]}
      style={{ pointerEvents: 'none', zIndex: 9998 }}
    >
      <div className="info-popup">
        {/* Callout: tiny 1×1 SVG anchored at the pad centroid (SVG
            origin = info-popup zero-size wrapper origin). The line
            runs from (0, 0) [pad centroid] to the popup centroid
            computed from the measured panel rect. overflow: visible
            lets the line render far outside the 1×1 viewport. */}
        <svg
          className="info-popup__callout"
          width={1}
          height={1}
        >
          <line x1={0} y1={0} x2={calloutX2} y2={calloutY2} />
        </svg>
        <div
          ref={setPanelEl}
          className={
            `info-popup__panel info-popup__panel--${focused ? 'focused' : 'hover'}` +
            (dismissing ? ' info-popup__panel--dismissing' : '')
          }
          style={
            {
              '--info-offset-x': `${INFO_PANEL_OFFSET_X}px`,
              '--info-offset-y': `${INFO_PANEL_OFFSET_Y}px`,
              transform: `translate(calc(-1 * var(--info-offset-x)), calc(-1 * var(--info-offset-y)))`,
            } as React.CSSProperties
          }
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
              {/* Textarea scrolls natively (overflow-y: auto). The
                  shared NeonScrollbar in overlay mode drives its thumb
                  against the textarea's scrollTop / scrollHeight — no
                  bespoke thumb math here. */}
              <div
                className="info-popup__editor-textbox"
                style={{ height: editorHeight }}
              >
                <textarea
                  ref={setTextareaEl}
                  className="info-popup__editor-textarea"
                  value={editText}
                  autoFocus
                  onChange={(e) => { setEditText(e.target.value); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      e.preventDefault();
                      cancelEdit();
                      return;
                    }
                    if (e.key !== 'Enter') return;
                    // IME composition: Enter confirms the pending
                    // glyph, it is not a commit. Skip.
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    const wantsNewline = e.ctrlKey || e.metaKey || e.shiftKey;
                    if (!wantsNewline) {
                      e.preventDefault();
                      e.stopPropagation();
                      commitEdit();
                      return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    const t = e.currentTarget;
                    const s = t.selectionStart;
                    const en = t.selectionEnd;
                    setEditText((prev) => prev.slice(0, s) + '\n' + prev.slice(en));
                    requestAnimationFrame(() => {
                      if (t.isConnected) { t.selectionStart = t.selectionEnd = s + 1; }
                    });
                  }}
                />
                <NeonScrollbar
                  color="cyan"
                  scrollElement={textareaEl}
                  onThumbHover={onDragAffordanceHover}
                  onThumbDrag={onDragAffordanceDrag}
                />
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
                <StatusBadge
                  label={todo.embeddingStatus.toUpperCase()}
                  color={embeddingColor}
                />
              </MetaRow>
            )}
            <MetaRow label="Position">
              ({Number.isFinite(popupX) ? popupX.toFixed(2) : '—'},{' '}
              {Number.isFinite(popupZ) ? popupZ.toFixed(2) : '—'})
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
