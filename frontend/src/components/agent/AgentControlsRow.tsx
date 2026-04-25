/**
 * Bottom-section bottom row of the agent panel — the button strip.
 * New chat, sessions hamburger, send/stop, close. Each button uses
 * the neon button styling from Story 4.1's PopupColorSwatch
 * (`box-shadow: 0 0 8px <neon-color>`, `1px solid var(--neon-cyan)`,
 * `--font-mono`).
 */

import { useAgentStore } from '../../stores/useAgentStore';
import { NeonTooltip } from '../ui/NeonTooltip';

interface Props {
  onNewChat: () => void;
  onToggleSessions: () => void;
  onSend: () => void;
  onClose: () => void;
  sessionsOpen: boolean;
}

export function AgentControlsRow({
  onNewChat,
  onToggleSessions,
  onSend,
  onClose,
  sessionsOpen,
}: Props) {
  const streamingMessageId = useAgentStore((s) => s.streamingMessageId);
  const cancelStreaming = useAgentStore((s) => s.cancelStreaming);
  const draft = useAgentStore((s) => s.inputDraft);
  const isStreaming = streamingMessageId !== null;
  const sendDisabled = !isStreaming && draft.trim().length === 0;

  const onSendOrStop = () => {
    if (isStreaming) {
      void cancelStreaming();
      return;
    }
    onSend();
  };

  return (
    <div className="agent-controls-row">
      <NeonTooltip
        text="Start a new chat"
        placement="top"
        wrapperClassName="agent-controls-row__new-chat-wrap"
      >
        <button
          type="button"
          className="agent-btn agent-btn--new"
          onClick={onNewChat}
        >
          + New chat
        </button>
      </NeonTooltip>
      <NeonTooltip text="Show sessions" placement="top">
        <button
          type="button"
          className={`agent-btn agent-btn--sessions${
            sessionsOpen ? ' agent-btn--active' : ''
          }`}
          onClick={onToggleSessions}
          aria-pressed={sessionsOpen}
        >
          ☰
        </button>
      </NeonTooltip>
      <NeonTooltip text={isStreaming ? 'Stop' : 'Send'} placement="top">
        <button
          type="button"
          className={`agent-btn agent-btn--send${
            isStreaming ? ' agent-btn--stop' : ''
          }`}
          onClick={onSendOrStop}
          disabled={sendDisabled}
        >
          {isStreaming ? '■' : '➤'}
        </button>
      </NeonTooltip>
      <NeonTooltip text="Close panel" placement="top">
        <button
          type="button"
          className="agent-btn agent-btn--close"
          onClick={onClose}
        >
          ✕
        </button>
      </NeonTooltip>
    </div>
  );
}
