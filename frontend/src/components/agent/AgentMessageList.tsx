/**
 * Middle section of the agent panel — the scrolling chat thread.
 *
 * Auto-scroll behaviour (AC 6): on each new chunk, scroll to the bottom
 * ONLY if the user is already pinned to the bottom (within ~32px). If
 * the user has scrolled up to read history, an incoming chunk does NOT
 * yank the view down — instead, a "↓ new messages" pill appears that
 * scrolls to bottom on click.
 *
 * The pin tracking is "sticky": once the user reaches the bottom (by
 * scrolling there themselves, by clicking the pill, or by being there
 * on a fresh open), the chat stays pinned across:
 *   - new messages arriving
 *   - the streaming buffer growing
 *   - the chat REGION shrinking (composer auto-grew, panel resized)
 * The user breaks out of pinned mode by scrolling up manually.
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
  // True when the user is "stuck to the bottom" — the conventional chat
  // app behaviour where new content auto-scrolls into view. Flips false
  // the moment the user manually scrolls up; flips true again when
  // they scroll back to the bottom (within PIN_THRESHOLD_PX).
  //
  // Stored as a ref AND state. The ref is read inside scroll/resize
  // handlers without forcing those effects to re-attach, while the
  // state hook lets the pill re-render correctly when the value
  // changes.
  const isPinnedRef = useRef(true);
  const [, forcePinTick] = useState(0);
  const setPinned = (value: boolean) => {
    if (isPinnedRef.current === value) return;
    isPinnedRef.current = value;
    forcePinTick((t) => t + 1);
  };

  const lastMessageCountRef = useRef(messages.length);
  const lastStreamingContentRef = useRef('');

  // Keep `isPinnedRef` in sync with the actual scroll position. Fires
  // on user-initiated scroll and on programmatic scrolls.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const recompute = () => {
      const distanceFromBottom =
        el.scrollHeight - el.clientHeight - el.scrollTop;
      const pinned = distanceFromBottom <= PIN_THRESHOLD_PX;
      setPinned(pinned);
      if (pinned) setShowNewMessagesPill(false);
    };
    el.addEventListener('scroll', recompute, { passive: true });
    // Initial compute after mount so a freshly-opened panel with
    // existing history starts pinned.
    recompute();
    return () => el.removeEventListener('scroll', recompute);
  }, [scrollRef]);

  // On message-list change OR streaming-buffer change, scroll to
  // bottom if pinned; otherwise show the pill.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;

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

    if (isPinnedRef.current) {
      el.scrollTop = el.scrollHeight;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowNewMessagesPill(false);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowNewMessagesPill(true);
    }
  }, [messages, streamingMessageId, scrollRef]);

  // Re-pin when the SCROLL CONTAINER itself shrinks (the composer grew
  // from 1 line to N, or the panel was resized). Without this, typing
  // in the composer pushes the chat content upward as the chat region
  // shrinks — the user was at the bottom but suddenly sees old content
  // because scrollTop didn't follow.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const ro = new ResizeObserver(() => {
      if (isPinnedRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);

  const onPillClick = () => {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
    setShowNewMessagesPill(false);
    // The scroll handler will flip isPinnedRef to true on the next
    // scroll event the browser fires from this jump.
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
