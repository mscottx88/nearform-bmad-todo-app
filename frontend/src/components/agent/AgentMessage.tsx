/**
 * AgentMessage — speech-bubble for one chat row.
 *
 * Visual variants by role:
 *   - `user`: pink bubble, right-aligned, tail on bottom-right
 *   - `assistant`: cyan bubble, left-aligned, tail on bottom-left
 *   - `system` / `tool`: meta-row, no tail, dimmer glow, smaller font
 *
 * The tail uses a CSS pseudo-element with `clip-path: polygon(...)`,
 * NOT a `border` triangle hack — borders don't anti-alias well in
 * Chromium and won't pick up the bubble's neon glow continuously.
 *
 * The optional thinking indicator is drawn here (and not in
 * AgentMessageList) so the bubble shape "owns" its own empty/streaming
 * state — the list doesn't need to know whether a row is mid-stream.
 */

import type { ChatMessage } from '../../types/agent';

interface Props {
  message: ChatMessage;
  /** True when this is the assistant row currently receiving SSE chunks. */
  isStreaming: boolean;
}

export function AgentMessage({ message, isStreaming }: Props) {
  const isMeta = message.role === 'system' || message.role === 'tool';
  const variant = isMeta ? 'meta' : message.role;
  const showThinking =
    isStreaming &&
    message.role === 'assistant' &&
    message.content.length === 0;
  const failed = message.status === 'failed';
  const cancelled = message.status === 'cancelled';

  const className = [
    'agent-message',
    `agent-message--${variant}`,
    failed ? 'agent-message--failed' : null,
    cancelled ? 'agent-message--cancelled' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} data-role={message.role} data-status={message.status}>
      <div className="agent-message__bubble">
        {showThinking ? (
          <span className="agent-thinking" aria-label="agent is thinking">
            <span className="agent-thinking__dot" />
            <span className="agent-thinking__dot" />
            <span className="agent-thinking__dot" />
          </span>
        ) : (
          <span className="agent-message__text">{message.content}</span>
        )}
      </div>
    </div>
  );
}
