/**
 * Middle section of the agent panel — the scrolling chat thread.
 *
 * Auto-scroll behaviour (AC 6): on each new chunk, scroll to the bottom
 * ONLY if the user is already pinned to the bottom (within ~32px). If
 * the user has scrolled up to read history, an incoming chunk does NOT
 * yank the view down — instead, a "↓ new messages" pill appears that
 * scrolls to bottom on click.
 *
 * The scroll container is provided by the parent (the inner div managed
 * by NeonScrollbar). This component receives a ref to that container
 * and controls its `scrollTop` directly.
 */

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../types/agent';
import { AgentMessage } from './AgentMessage';

interface Props {
  messages: ChatMessage[];
  streamingMessageId: string | null;
  /** The scrollable container managed by NeonScrollbar. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

const PIN_THRESHOLD_PX = 32;

export function AgentMessageList({ messages, streamingMessageId, scrollRef }: Props) {
  const [showNewMessagesPill, setShowNewMessagesPill] = useState(false);
  const lastMessageCountRef = useRef(messages.length);
  const lastStreamingContentRef = useRef('');

  // On any messages-array change OR streaming-buffer change, decide
  // whether to auto-scroll. We compare the previous message count and
  // the last streaming-message content so a chunk-induced re-render
  // updates the pin state correctly even when `messages` is the same
  // length.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;

    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    const isPinned = distanceFromBottom <= PIN_THRESHOLD_PX;

    const grew = messages.length !== lastMessageCountRef.current;
    let streamingContent = '';
    if (streamingMessageId !== null) {
      const streaming = messages.find((m) => m.id === streamingMessageId);
      streamingContent = streaming?.content ?? '';
    }
    const streamed = streamingContent !== lastStreamingContentRef.current;

    lastMessageCountRef.current = messages.length;
    lastStreamingContentRef.current = streamingContent;

    if (!grew && !streamed) return;

    if (isPinned) {
      el.scrollTop = el.scrollHeight;
      // The state set here is a UI flag derived from a DOM measurement
      // (the scroll position vs. the bottom edge). This is the
      // "synchronise React with an external system" case the rule
      // explicitly tolerates — there is no derived-state alternative
      // because the trigger is a DOM mutation, not a render input.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowNewMessagesPill(false);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowNewMessagesPill(true);
    }
  }, [messages, streamingMessageId, scrollRef]);

  // Hide the pill if the user manually scrolls back to the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
      if (distanceFromBottom <= PIN_THRESHOLD_PX) {
        setShowNewMessagesPill(false);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef]);

  const onPillClick = () => {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
    setShowNewMessagesPill(false);
  };

  return (
    <>
      {messages.map((m) => (
        <AgentMessage
          key={m.id}
          message={m}
          isStreaming={m.id === streamingMessageId}
        />
      ))}
      {showNewMessagesPill && (
        <button
          type="button"
          className="agent-panel__new-messages-pill"
          onClick={onPillClick}
        >
          ↓ new messages
        </button>
      )}
    </>
  );
}
