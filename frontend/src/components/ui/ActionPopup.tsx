import { useEffect, useState } from 'react';
import { Html } from '@react-three/drei';
import type { Todo } from '../../types';
import { PopupColorSwatch } from './PopupColorSwatch';
import './ActionPopup.css';

// ROYGBIV — 7 stops. Letters past index 6 wrap via `% 7`.
const RAINBOW_HUES = [
  '#ff1744', // R
  '#ff9100', // O
  '#ffea00', // Y
  '#00e676', // G
  '#00b0ff', // B
  '#3d5afe', // I
  '#d500f9', // V
];

// Precompute the "Set Color" letter → hue mapping at module load so
// there is no mutable counter running during component render (which
// React flags as `Cannot reassign variable after render completes`).
// Spaces carry `hue = null` and render as a non-breaking space without
// consuming a palette slot.
const SET_COLOR_LETTERS: ReadonlyArray<{ ch: string; hue: string | null }> = (() => {
  const chars = 'Set Color'.split('');
  let hueIdx = 0;
  return chars.map((ch) => {
    if (ch === ' ') return { ch, hue: null };
    const hue = RAINBOW_HUES[hueIdx % RAINBOW_HUES.length];
    hueIdx += 1;
    return { ch, hue };
  });
})();

interface ActionPopupProps {
  todo: Todo;
  onComplete: () => void;
  onDelete: () => void;
  /**
   * Story 4.1: called when the user commits a color from the swatch
   * sub-panel. Receives the selected hex (one of the NEON_SWATCHES).
   * PondScene wires this to `useUpdateTodo.mutate({ id, color })` +
   * `triggerRipple` + `closePopup` (same pattern as Complete/Delete).
   */
  onCommitColor: (color: string) => void;
  /**
   * Story 4.1 (optional): called on hover/unhover of a swatch with
   * the hex (or null). PondScene wires this to
   * `usePondStore.setColorPreview(todoId, color)` so LilyPad can
   * live-preview the pad body / rim color while the user considers
   * a pick.
   */
  onPreviewColor?: (color: string | null) => void;
  onGroup: () => void;
}

// Horizontal/vertical offset from the pad's projected screen position to the
// top-left of the menu panel. SVG callout spans this same offset.
const PANEL_OFFSET_X = 80;
const PANEL_OFFSET_Y = 120;

export function ActionPopup({
  todo,
  onComplete,
  onDelete,
  onCommitColor,
  onPreviewColor,
  onGroup,
}: ActionPopupProps) {
  // Story 4.1: Set Color toggles an inline swatch sub-panel.
  const [swatchOpen, setSwatchOpen] = useState(false);
  const [previewColor, setPreviewColor] = useState<string | null>(null);

  // Notify the parent whenever the hover preview changes. PondScene
  // uses this to push the preview into usePondStore so LilyPad can
  // lerp body + rim color in real time. Runs on mount too — fires
  // `onPreviewColor(null)` once, harmless.
  useEffect(() => {
    onPreviewColor?.(previewColor);
  }, [previewColor, onPreviewColor]);

  // Story 4.1 CR-patch: whenever the sub-panel closes (via toggle,
  // Escape, or commit), clear any lingering hover preview in local
  // state. The preview-notify effect above then writes null into
  // the store so the pad reverts to its committed color. Without
  // this, a keyboard- or touch-driven close path (where the mouse
  // never fires a `mouseLeave` event on the swatch) would leave
  // the store preview entry stuck on the last-hovered hex.
  useEffect(() => {
    if (!swatchOpen && previewColor !== null) {
      setPreviewColor(null);
    }
  }, [swatchOpen, previewColor]);

  // When the sub-panel collapses (Escape, commit, or second click on
  // Set Color), drop any in-flight hover preview so LilyPad reverts
  // to the committed color within one frame (AC #4).
  const collapse = () => {
    setSwatchOpen(false);
    setPreviewColor(null);
  };
  // Drei <Html> with no `transform` renders a DOM overlay, positioning its
  // top-left at the projection of the given 3D point. The panel and callout
  // inside use absolute positioning relative to that anchor.
  return (
    <Html
      position={[todo.positionX ?? 0, 0.4, todo.positionY ?? 0]}
      zIndexRange={[100, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <div className="action-popup">
        <svg
          className="action-popup__callout"
          width={PANEL_OFFSET_X}
          height={PANEL_OFFSET_Y}
          viewBox={`0 0 ${PANEL_OFFSET_X} ${PANEL_OFFSET_Y}`}
        >
          <line
            x1="0"
            y1={PANEL_OFFSET_Y}
            x2={PANEL_OFFSET_X}
            y2="0"
          />
        </svg>
        <div
          className="action-popup__panel"
          style={{
            transform: `translate(${PANEL_OFFSET_X}px, -${PANEL_OFFSET_Y}px)`,
          }}
          // Absorb ALL pointer events at the panel root so popup clicks
          // never reach the water-surface raycaster underneath (which
          // would fire its own ripple via the `onClick={handleWaterClick}`
          // handler on the water mesh). stopPropagation on
          // onPointerDown/onPointerUp is the R3F-compatible way to do this
          // — it prevents the drei <Html> from forwarding the event to
          // the canvas event system. onClick stop is defensive for any
          // library that listens on click instead of pointerdown.
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          // Wheel events over the panel normally get swallowed (panel
          // is `pointer-events: auto`, the drei <Html> portal is a
          // sibling of the canvas in the DOM so wheel doesn't bubble
          // there). Forward the wheel to the canvas so OrbitControls
          // zoom still works when the mouse is hovering the popup.
          onWheel={(e) => {
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
                // Let the synthesized event bubble so OrbitControls
                // listeners at document / window scope (or any parent
                // that may attach in the future) see it — the direct
                // canvas listener still receives it either way.
                bubbles: true,
              }),
            );
          }}
        >
          {/* Story 3.3: the Complete / Delete buttons swap to
              Uncomplete / Undelete when the popup opens on a
              completed / deleted pad. The parent passes the same
              onComplete / onDelete callback for both polarities —
              PondScene branches on todo.completed / todo.deleted to
              decide which mutation to fire. */}
          <button
            type="button"
            className="action-popup__button action-popup__button--complete"
            onClick={onComplete}
          >
            {todo.completed ? 'Uncomplete' : 'Complete'}
          </button>
          <button
            type="button"
            className="action-popup__button action-popup__button--delete"
            onClick={onDelete}
          >
            {todo.deleted ? 'Undelete' : 'Delete'}
          </button>
          <button
            type="button"
            className="action-popup__button action-popup__button--set-color"
            // Story 4.1: toggle — click once to open, again to close.
            // Escape (handled by PopupColorSwatch) also closes.
            onClick={() => setSwatchOpen((open) => !open)}
            aria-label="Set Color"
            aria-expanded={swatchOpen}
          >
            {/* Per-letter ROYGBIV — color + glow set inline from the
                precomputed SET_COLOR_LETTERS table (module scope). */}
            {SET_COLOR_LETTERS.map(({ ch, hue }, i) =>
              hue === null ? (
                <span key={i} aria-hidden>
                  {'\u00a0'}
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
          <button
            type="button"
            className="action-popup__button action-popup__button--group"
            onClick={onGroup}
          >
            Group
          </button>
          {/* Story 4.1: inline swatch sub-panel. Rendered as a child of
              the panel root so it inherits the pointer-event absorption
              (AC #9). Conditional render so the keyboard Escape handler
              inside PopupColorSwatch is only mounted when the panel is
              actually open. */}
          {swatchOpen && (
            <PopupColorSwatch
              committedColor={todo.color || '#00ff88'}
              onHover={setPreviewColor}
              onCommit={(color) => {
                onCommitColor(color);
                collapse();
              }}
              onCollapse={collapse}
            />
          )}
        </div>
      </div>
    </Html>
  );
}
