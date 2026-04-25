/**
 * `<TodoLink>` renders one `[label](todo://<uuid>)` reference inside an
 * assistant chat message.
 *
 * Behaviour:
 *   - Hovering a link mirrors the same hover state the pond uses for
 *     pad-under-cursor (`usePondStore.setHoveredTodoId`). LilyPad
 *     subscribes to that field, so the corresponding pad lights up
 *     while the cursor is over the link.
 *   - Clicking a link is the equivalent of clicking the lily pad in
 *     the scene: opens the InfoPopup and pans/zooms the camera to the
 *     pad. The position is read from `useWorldStore` (the canonical
 *     in-memory world-metadata source from Story 4.9).
 *   - The custom firefly-cursor swaps to the neon "frog pointing
 *     finger" glyph for the duration of the hover (mode='point'),
 *     keeping the design consistent with the rest of the cursor
 *     system instead of falling back to the browser's stock pointer.
 *   - If the referenced todo is not loaded (filtered out by visibility
 *     or just deleted), the link renders in a "missing" visual state,
 *     the click is a no-op, and the cursor stays on its current mode.
 */

import { useEffect, useRef } from 'react';
import { useWorldStore } from '../../stores/useWorldStore';
import { usePondStore } from '../../stores/usePondStore';
import { NeonTooltip } from '../ui/NeonTooltip';

interface Props {
  label: string;
  todoId: string;
}

export function TodoLink({ label, todoId }: Props) {
  // Subscribe to the world entry so the link's "missing" visual flips
  // automatically if the referenced todo loads in or falls out of the
  // store (e.g. visibility-flag toggle, refetch).
  const worldEntry = useWorldStore((s) => s.worldMetadata.get(todoId));
  const isMissing = worldEntry === undefined;

  // Story 6.2 Group B CR P8: track whether THIS link currently owns
  // the `point` cursor mode + hovered-todo-id, so unmount cleanup
  // only fires if the cleanup is actually ours to do (vs. a sibling
  // link having taken over the mode in the meantime).
  const ownsHoverRef = useRef(false);

  const onPointerEnter = () => {
    if (isMissing) return;
    const store = usePondStore.getState();
    store.setHoveredTodoId(todoId);
    store.setCursorMode('point');
    ownsHoverRef.current = true;
  };

  const onPointerLeave = () => {
    ownsHoverRef.current = false;
    const store = usePondStore.getState();
    // Only clear hover if WE'RE the one who set it — defensive
    // against a racing pointerEnter on a real pad in the scene.
    if (!isMissing && store.hoveredTodoId === todoId) {
      store.setHoveredTodoId(null);
    }
    // Always restore cursor on leave. If we're not the current owner
    // of `point` mode (e.g. another link had taken over), this is a
    // no-op via setCursorMode's identity guard.
    if (store.cursorMode === 'point') {
      store.setCursorMode('firefly');
    }
  };

  // Story 6.2 Group B CR P8: the panel can close (Escape) or the
  // session can switch while the cursor is still over a link —
  // pointerLeave never fires, so without this cleanup `cursorMode`
  // stays `'point'` indefinitely (the firefly cursor disappears,
  // showing the frog-finger glyph over an empty pond). Run the same
  // pointerLeave logic on unmount, but only if THIS link owned the
  // hover at the time.
  useEffect(() => {
    return () => {
      if (!ownsHoverRef.current) return;
      const store = usePondStore.getState();
      if (store.hoveredTodoId === todoId) {
        store.setHoveredTodoId(null);
      }
      if (store.cursorMode === 'point') {
        store.setCursorMode('firefly');
      }
    };
  }, [todoId]);

  const onClick = () => {
    if (isMissing) return;
    const store = usePondStore.getState();
    // Same guard LilyPad uses before opening the popup — don't fire
    // while the pad is mid-completion / mid-deletion animation.
    if (store.completingTodos.has(todoId) || store.deletingTodos.has(todoId)) {
      return;
    }
    store.openPopup(todoId, worldEntry.positionX, worldEntry.positionY);
  };

  const className = [
    'todo-link',
    isMissing ? 'todo-link--missing' : null,
  ]
    .filter(Boolean)
    .join(' ');

  const tooltipText = isMissing
    ? "this todo isn't loaded — check your visibility filters"
    : 'jump to this pad';

  return (
    <NeonTooltip text={tooltipText} placement="top" disabled={isMissing}>
      <button
        type="button"
        className={className}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onClick={onClick}
        disabled={isMissing}
      >
        {label}
      </button>
    </NeonTooltip>
  );
}
