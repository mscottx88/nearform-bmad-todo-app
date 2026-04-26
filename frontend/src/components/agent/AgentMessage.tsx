/**
 * AgentMessage — speech-bubble for one chat row.
 *
 * Visual variants by role:
 *   - `user`: pink bubble, right-aligned, tail on bottom-right
 *   - `assistant`: cyan bubble, left-aligned, tail on bottom-left
 *   - `system` / `tool`: meta-row, no tail, dimmer glow, smaller font
 *
 * Story 6.2 Group B CR P13 — single-path SVG outline.
 *
 * Earlier shipping shape used a CSS-bordered `<div>` for the body and
 * an inline `<svg>` for the tail glued onto the bottom edge. The two
 * pieces had separate strokes and separate glow filters
 * (`box-shadow` on the div, `drop-shadow` on the SVG), so the seam
 * where they met read as two distinct shapes — clunky.
 *
 * The bubble is now drawn as ONE closed path inside ONE absolutely-
 * positioned `<svg>`. The path traces:
 *
 *   (rounded rect outline) + (triangular tail notch off the bottom)
 *
 * as a single continuous outline. One stroke + one fill + one
 * `drop-shadow` filter on the SVG → unified neon glow that wraps the
 * combined silhouette without seams. The bubble container `<div>`
 * sets only padding + content layout; all visual chrome lives in the
 * SVG.
 *
 * The SVG is sized via a ResizeObserver on the bubble container so
 * the path scales with text content. Initial mount paints with
 * size={0,0} (path returns null) and the first ResizeObserver tick
 * re-renders with the correct outline; the visual flicker is one
 * frame.
 *
 * The optional thinking indicator is drawn here (and not in
 * AgentMessageList) so the bubble shape "owns" its own empty/streaming
 * state — the list doesn't need to know whether a row is mid-stream.
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../types/agent';
import { parseAgentMessage } from '../../utils/parseAgentMessage';
import { RephraseProposal } from './RephraseProposal';
import { TodoLink } from './TodoLink';

interface Props {
  message: ChatMessage;
  /** True when this is the assistant row currently receiving SSE chunks. */
  isStreaming: boolean;
}

const BUBBLE_RADIUS = 16;
const TAIL_WIDTH = 14;
const TAIL_HEIGHT = 12;

/**
 * Render the assistant's text with `[label](todo://<uuid>)` references
 * promoted to clickable + hover-aware `<TodoLink>` components, and
 * basic inline markdown (`**bold**`, `*italic*`, `` `code` ``)
 * rendered with semantic HTML. User and meta-row content is rendered
 * as plain text — only the LLM's assistant turns carry markdown and
 * link references.
 */
function MessageBody({ message }: { message: ChatMessage }) {
  if (message.role !== 'assistant') {
    return <>{message.content}</>;
  }
  const segments = parseAgentMessage(message.content);
  return (
    <>
      {segments.map((segment, idx) => {
        switch (segment.kind) {
          case 'text':
            return <Fragment key={idx}>{segment.text}</Fragment>;
          case 'bold':
            return <strong key={idx}>{segment.text}</strong>;
          case 'italic':
            return <em key={idx}>{segment.text}</em>;
          case 'code':
            return (
              <code key={idx} className="agent-message__inline-code">
                {segment.text}
              </code>
            );
          case 'heading':
            if (segment.level === 1) {
              return <h1 key={idx} className="agent-message__h1">{segment.text}</h1>;
            }
            if (segment.level === 2) {
              return <h2 key={idx} className="agent-message__h2">{segment.text}</h2>;
            }
            return <h3 key={idx} className="agent-message__h3">{segment.text}</h3>;
          case 'hr':
            return <hr key={idx} className="agent-message__hr" />;
          case 'todo-link':
            return (
              <TodoLink
                key={idx}
                label={segment.label}
                todoId={segment.todoId}
              />
            );
        }
      })}
    </>
  );
}

/**
 * Build a single closed SVG path tracing the bubble's rounded
 * rectangle outline + a triangular tail extending below the bottom
 * edge. Vertices clockwise from top-left corner.
 *
 *   assistant (tail at bottom-LEFT):     user (tail at bottom-RIGHT):
 *
 *     ┌─────────────────┐                  ┌─────────────────┐
 *     │                 │                  │                 │
 *     │                 │                  │                 │
 *     └ ──┐─────────────┘                  └─────────────┐── ┘
 *         \                                              /
 *          v                                            v
 *
 * The tail's outer vertical edge is collinear with the bubble's
 * left/right edge, so the tail and corner blend smoothly. The
 * bottom-left (assistant) / bottom-right (user) rounded corner is
 * preserved on the OPPOSITE side from the tail.
 */
function buildBubblePath(role: 'user' | 'assistant', w: number, h: number): string {
  // Cap the corner radius at half the smaller dimension so very
  // narrow bubbles (single-character rows during the empty-state
  // phase) don't end up with negative arc lengths.
  const r = Math.max(0, Math.min(BUBBLE_RADIUS, Math.floor(w / 2), Math.floor(h / 2)));
  const tw = TAIL_WIDTH;
  const th = TAIL_HEIGHT;
  if (r === 0) return '';

  if (role === 'assistant') {
    return [
      `M ${r} 0`,
      `L ${w - r} 0`,
      `A ${r} ${r} 0 0 1 ${w} ${r}`,
      `L ${w} ${h - r}`,
      `A ${r} ${r} 0 0 1 ${w - r} ${h}`,
      // Bottom edge from right corner back across to where the tail
      // base begins, then dip down-left to the apex, then up the
      // tail's left edge (collinear with the bubble's left side).
      `L ${r + tw} ${h}`,
      `L ${r} ${h + th}`,
      `L ${r} ${h}`,
      `A ${r} ${r} 0 0 1 0 ${h - r}`,
      `L 0 ${r}`,
      `A ${r} ${r} 0 0 1 ${r} 0`,
      'Z',
    ].join(' ');
  }
  // user: mirror — tail at bottom-RIGHT, apex below the right corner end.
  return [
    `M ${r} 0`,
    `L ${w - r} 0`,
    `A ${r} ${r} 0 0 1 ${w} ${r}`,
    `L ${w} ${h - r}`,
    `A ${r} ${r} 0 0 1 ${w - r} ${h}`,
    `L ${w - r} ${h + th}`,
    `L ${w - r - tw} ${h}`,
    `L ${r} ${h}`,
    `A ${r} ${r} 0 0 1 0 ${h - r}`,
    `L 0 ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    'Z',
  ].join(' ');
}

interface BubbleOutlineProps {
  role: 'user' | 'assistant';
  width: number;
  height: number;
}

function BubbleOutline({ role, width, height }: BubbleOutlineProps) {
  if (width <= 0 || height <= 0) return null;
  const d = buildBubblePath(role, width, height);
  if (d === '') return null;
  return (
    <svg
      className="agent-message__outline"
      width={width}
      height={height + TAIL_HEIGHT}
      viewBox={`0 0 ${width} ${height + TAIL_HEIGHT}`}
      aria-hidden="true"
    >
      <path d={d} />
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

  const bubbleRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Track the bubble container's BORDER-box size so the SVG outline
  // can scale with text content on every wrap, font swap, or
  // streaming-chunk paint. `getBoundingClientRect()` is cheap and
  // returns subpixel-accurate dimensions; rounding up to the nearest
  // pixel keeps the path crisp on integer-strict raster paths.
  useEffect(() => {
    const el = bubbleRef.current;
    if (el === null) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.ceil(rect.width);
      const h = Math.ceil(rect.height);
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [message.content]);

  const className = [
    'agent-message',
    `agent-message--${variant}`,
    failed ? 'agent-message--failed' : null,
    cancelled ? 'agent-message--cancelled' : null,
  ]
    .filter(Boolean)
    .join(' ');

  if (isMeta) {
    return (
      <div className={className} data-role={message.role} data-status={message.status}>
        <div className="agent-message__meta-content">
          <MessageBody message={message} />
        </div>
      </div>
    );
  }

  // Story 6.3: per-kind proposal renderer slot. Switch keeps the
  // dispatch site simple — a future `position_deltas` /
  // `visual_cues` kind adds a new arm without a refactor.
  const proposal = readProposalMetadata(message);

  return (
    <div className={className} data-role={message.role} data-status={message.status}>
      {/*
        `.agent-message` is `display: flex` row, with `justify-content`
        controlling horizontal alignment by role. A direct
        `RephraseProposal` sibling would be a flex item alongside the
        bubble — long candidate-chip text would squeeze the bubble's
        flex basis to near-zero and wrap each character on its own
        line. Wrap bubble + proposal in a column-direction stack so the
        proposal sits BELOW the bubble (sibling visually, but flex-
        column nested) and the bubble retains its full width.
      */}
      <div className="agent-message__stack">
        <div className="agent-message__bubble" ref={bubbleRef}>
          <BubbleOutline role={message.role as 'user' | 'assistant'} width={size.w} height={size.h} />
          <div className="agent-message__content">
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
        </div>
        {/* CR: gate the proposal renderer on `status === 'complete'` so a
            cancelled / failed bubble doesn't show clickable Accept/Dismiss
            on a half-finished suggestion. The proposal envelope arrives
            BEFORE the chunk stream, so cancel/error mid-stream can leave
            metadata.proposal set on a non-complete row. */}
        {proposal !== null &&
          proposal.kind === 'text_rewrite' &&
          message.status === 'complete' && (
            <RephraseProposal
              payload={proposal.payload as unknown as RephraseProposalPayload}
              targets={proposal.targets}
            />
          )}
      </div>
    </div>
  );
}

interface ProposalMetadata {
  kind: string;
  payload: Record<string, unknown>;
  targets: string[];
}

interface RephraseProposalPayload {
  suggestions?: {
    field: string;
    original: string;
    revised: string;
    reason: string;
  }[];
  missing_fields?: string[];
  candidates?: { id: string; text: string }[];
}

function readProposalMetadata(message: ChatMessage): ProposalMetadata | null {
  // CR: tolerate `null` / `undefined` metadata — older rows persisted
  // before the JSONB default landed, or rows where the column was
  // explicitly nulled, would otherwise crash on `(... as ...).proposal`.
  if (
    message.metadata === null ||
    message.metadata === undefined ||
    typeof message.metadata !== 'object'
  ) {
    return null;
  }
  const candidate = (message.metadata as { proposal?: unknown }).proposal;
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    candidate === undefined
  ) {
    return null;
  }
  const obj = candidate as Record<string, unknown>;
  if (
    typeof obj.kind === 'string' &&
    typeof obj.payload === 'object' &&
    obj.payload !== null &&
    Array.isArray(obj.targets)
  ) {
    return {
      kind: obj.kind,
      payload: obj.payload as Record<string, unknown>,
      targets: obj.targets as string[],
    };
  }
  return null;
}
