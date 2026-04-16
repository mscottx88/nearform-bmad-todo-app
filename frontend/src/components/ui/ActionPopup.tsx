import { Html } from '@react-three/drei';
import type { Todo } from '../../types';
import './ActionPopup.css';

interface ActionPopupProps {
  todo: Todo;
  onComplete: () => void;
  onDelete: () => void;
  onSetColor: () => void;
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
  onSetColor,
  onGroup,
}: ActionPopupProps) {
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
        >
          <button
            type="button"
            className="action-popup__button action-popup__button--complete"
            onClick={onComplete}
          >
            Complete
          </button>
          <button
            type="button"
            className="action-popup__button action-popup__button--delete"
            onClick={onDelete}
          >
            Delete
          </button>
          <button
            type="button"
            className="action-popup__button action-popup__button--set-color"
            onClick={onSetColor}
          >
            Set Color
          </button>
          <button
            type="button"
            className="action-popup__button action-popup__button--group"
            onClick={onGroup}
          >
            Group
          </button>
        </div>
      </div>
    </Html>
  );
}
