import React, { useEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import type { Todo } from '../../types';
import { NeonScrollbar } from './NeonScrollbar';
import { usePondStore } from '../../stores/usePondStore';
import { formatTimestamp, formatRelative } from '../../utils/formatTodoMeta';
import './InfoPopup.css';

const INFO_PANEL_OFFSET_X = 280;
const INFO_PANEL_OFFSET_Y = 120;

interface InfoPopupProps {
  todo: Todo;
  focused: boolean;
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

export function InfoPopup({ todo, focused }: InfoPopupProps): React.ReactElement {
  // Story 3.4 (user correction 2026-04-23): during a drag of THIS pad,
  // the popup must visually follow the cursor. The drag pipeline
  // publishes live (x, z) on every pointermove via activeDragAnchor;
  // we override the drei <Html> `position` while this pad owns the
  // anchor. Falls back to persisted positionX/positionY at rest.
  const dragAnchor = usePondStore((s) =>
    s.activeDragAnchor?.padId === todo.id ? s.activeDragAnchor : null,
  );
  // Story 3.4 (user correction 2026-04-23): on drag-release,
  // activeDragAnchor clears synchronously but the batch PATCH +
  // refetch takes ~50-200ms to land new todo.positionX/Y. Between
  // those two, the popup would flash back to the OLD persisted
  // position for a frame. Hold the last-known drag position in
  // state and keep using it until the persisted position catches up.
  const [stickyPos, setStickyPos] = useState<{ x: number; z: number } | null>(null);
  // Track the previous dragAnchor presence to detect release edge.
  const wasDraggingRef = useRef(false);
  useEffect(() => {
    if (dragAnchor) {
      wasDraggingRef.current = true;
      setStickyPos({ x: dragAnchor.x, z: dragAnchor.z });
      return;
    }
    if (wasDraggingRef.current && stickyPos) {
      // Drag just released OR refetch landed. Clear sticky once the
      // persisted position agrees with it (within sub-unit epsilon).
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

  const handleWheel = (e: React.WheelEvent): void => {
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
  };

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
          <NeonScrollbar color="cyan" style={{ maxHeight: 180 }}>
            <div className="info-popup__text">{todo.text}</div>
          </NeonScrollbar>
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
        </div>
      </div>
    </Html>
  );
}
