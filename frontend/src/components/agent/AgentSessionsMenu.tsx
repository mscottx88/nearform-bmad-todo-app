/**
 * Sessions overlay — slides down from below the Oracle-Frog placeholder
 * to cover the chat region (NOT a separate sidebar). Lists every chat
 * session ordered by `updatedAt DESC` (the order the backend returns
 * after Story 6.1 CR P14 + the post-CR id tiebreaker).
 *
 * Per-row hover: a small red-neon × icon appears at the right edge.
 * Clicking × promotes the row to confirm-delete state inline (NOT a
 * `window.confirm` modal). Confirming fires DELETE; the active session
 * falls back to the most-recently-updated remaining session, or a new
 * one is created if none remain.
 */

import { useState } from 'react';
import { useAgentStore } from '../../stores/useAgentStore';
import { formatRelative } from '../../utils/formatTodoMeta';

interface Props {
  onClose: () => void;
}

export function AgentSessionsMenu({ onClose }: Props) {
  const sessions = useAgentStore((s) => s.sessions);
  const activeSessionId = useAgentStore((s) => s.activeSessionId);
  const switchSession = useAgentStore((s) => s.switchSession);
  const deleteSession = useAgentStore((s) => s.deleteSession);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const onRowClick = (id: string) => {
    if (id === pendingDeleteId) return; // confirm row absorbs clicks
    void switchSession(id);
    onClose();
  };

  const onDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setPendingDeleteId((current) => (current === id ? null : id));
  };

  const onConfirmDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setPendingDeleteId(null);
    void deleteSession(id);
  };

  const onCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDeleteId(null);
  };

  return (
    <div className="agent-sessions-menu" role="dialog" aria-label="Chat sessions">
      <div className="agent-sessions-menu__header">
        <span>conversations</span>
        <button
          type="button"
          className="agent-btn agent-btn--close"
          onClick={onClose}
          aria-label="Close sessions menu"
        >
          ✕
        </button>
      </div>
      <ul className="agent-sessions-menu__list">
        {sessions.length === 0 ? (
          <li className="agent-sessions-menu__empty">no conversations yet</li>
        ) : (
          sessions.map((s) => {
            const title = s.title ?? '(untitled)';
            const isActive = s.id === activeSessionId;
            const isPendingDelete = s.id === pendingDeleteId;
            return (
              <li
                key={s.id}
                className={`agent-sessions-menu__row${
                  isActive ? ' agent-sessions-menu__row--active' : ''
                }`}
                onClick={() => onRowClick(s.id)}
              >
                <span className="agent-sessions-menu__title">{title}</span>
                <span className="agent-sessions-menu__time">
                  {formatRelative(s.updatedAt)}
                </span>
                {isPendingDelete ? (
                  <span className="agent-sessions-menu__confirm">
                    <button
                      type="button"
                      className="agent-btn agent-btn--confirm-delete"
                      onClick={(e) => onConfirmDelete(e, s.id)}
                    >
                      Delete this conversation?
                    </button>
                    <button
                      type="button"
                      className="agent-btn agent-btn--cancel"
                      onClick={onCancelDelete}
                    >
                      cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="agent-sessions-menu__delete"
                    onClick={(e) => onDeleteClick(e, s.id)}
                    aria-label={`Delete session ${title}`}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
