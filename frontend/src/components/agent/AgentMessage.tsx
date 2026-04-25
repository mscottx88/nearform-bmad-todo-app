/**
 * AgentMessage — speech-bubble for one chat row.
 *
 * Visual variants by role:
 *   - `user`: pink bubble, right-aligned, tail on bottom-right
 *   - `assistant`: cyan bubble, left-aligned, tail on bottom-left
 *   - `system` / `tool`: meta-row, no tail, dimmer glow, smaller font
 *
 * The tail is an inline `<svg>` rather than a CSS clip-path pseudo-
 * element. The clip-path approach worked for the SHAPE but broke the
 * stroke: borders are drawn on the rectangle's edges, then clipped, so
 * the diagonal hypotenuse — the most visible edge of the tail — picked
 * up no neon stroke at all. SVG lets us stroke only the two visible
 * edges (hypotenuse + outer edge), leaving the third edge unstroked
 * where it tucks under the bubble's bottom border so the tail reads as
 * a continuous protrusion of the bubble.
 *
 * The optional thinking indicator is drawn here (and not in
 * AgentMessageList) so the bubble shape "owns" its own empty/streaming
 * state — the list doesn't need to know whether a row is mid-stream.
 */

import { Fragment } from 'react';
import type { ChatMessage } from '../../types/agent';
import { parseAgentMessage } from '../../utils/parseAgentMessage';
import { TodoLink } from './TodoLink';

interface Props {
  message: ChatMessage;
  /** True when this is the assistant row currently receiving SSE chunks. */
  isStreaming: boolean;
}

/**
 * Render the assistant's text with `[label](todo://<uuid>)` references
 * promoted to clickable + hover-aware `<TodoLink>` components.
 * User and meta-row content is rendered as plain text (the LLM only
 * emits the link form on its own assistant turns).
 */
function MessageBody({ message }: { message: ChatMessage }) {
  if (message.role !== 'assistant') {
    return <>{message.content}</>;
  }
  const segments = parseAgentMessage(message.content);
  return (
    <>
      {segments.map((segment, idx) =>
        segment.kind === 'text' ? (
          <Fragment key={idx}>{segment.text}</Fragment>
        ) : (
          <TodoLink
            key={idx}
            label={segment.label}
            todoId={segment.todoId}
          />
        ),
      )}
    </>
  );
}

/**
 * SVG tail for an assistant or user bubble. Shape:
 *
 *   user (right-aligned):           assistant (left-aligned):
 *
 *      ┌─────── bubble ──── ┐         ┌ ──── bubble ────────┐
 *      │                    │         │                     │
 *      └────────────────┐ ──┘         └ ──┌─────────────────┘
 *                        \                /
 *                         \              /
 *                          v            v
 *
 * The TOP edge of the tail's bounding box overlaps the bubble's bottom
 * border by 1px so the bubble's own border + glow paint over the
 * tail's top — no visible seam. The SVG strokes only the hypotenuse
 * and the outer-vertical edge; both meet at the tail's apex.
 */
function BubbleTail({ role }: { role: 'user' | 'assistant' }) {
  const isUser = role === 'user';
  // Triangle vertices in the SVG's 14×12 viewBox:
  //   user:      apex at bottom-LEFT  (point leans toward the speaker, off-screen right)
  //   assistant: apex at bottom-RIGHT (mirror)
  //
  // Fill path closes the triangle (Z); stroke path only draws the two
  // OUTER edges — never the top edge, which sits beneath the bubble's
  // own border.
  const fillPath = isUser
    ? 'M 0 0 L 14 0 L 14 12 Z'
    : 'M 0 0 L 14 0 L 0 12 Z';
  const strokePath = isUser
    ? 'M 14 0 L 14 12 L 0 0'
    : 'M 0 0 L 0 12 L 14 0';
  return (
    <svg
      className="agent-message__tail"
      width="14"
      height="12"
      viewBox="0 0 14 12"
      aria-hidden="true"
    >
      <path d={fillPath} className="agent-message__tail-fill" />
      <path d={strokePath} className="agent-message__tail-stroke" />
    </svg>
  );
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
      <div className="agent-message__bubble-wrap">
        <div className="agent-message__bubble">
          {showThinking ? (
            <span className="agent-thinking" aria-label="agent is thinking">
              <span className="agent-thinking__dot" />
              <span className="agent-thinking__dot" />
              <span className="agent-thinking__dot" />
            </span>
          ) : (
            <span className="agent-message__text">
              <MessageBody message={message} />
            </span>
          )}
        </div>
        {!isMeta && (message.role === 'user' || message.role === 'assistant') && (
          <BubbleTail role={message.role} />
        )}
      </div>
    </div>
  );
}
