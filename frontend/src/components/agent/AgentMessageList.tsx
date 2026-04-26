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
  // Story 6.2 Group E polish (user report 2026-04-25): the auto-
  // scroll effect's "trust live DOM" guard correctly prevents
  // snap-back during streaming-mid-drag, but it also blocks the
  // initial-load snap-to-bottom: when messages first arrive,
  // `scrollTop` is still 0 and `distanceFromBottom > threshold`,
  // so the synchronous read says "not pinned" and the chat opens
  // showing the OLDEST messages. This flag forces the FIRST
  // grew/streamed tick to scroll to bottom unconditionally;
  // subsequent ticks rely on the synchronous distance check.
  const initialSnapDoneRef = useRef(false);

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

  // One-shot scroll-to-bottom on mount. Without this, opening the
  // panel via F1 with prior history shows the OLDEST messages at the
  // top — chat conventions expect the LATEST. The "messages grew"
  // effect below only fires when the array length CHANGES after
  // mount, so it doesn't cover the initial render. Runs once with an
  // empty deps array; subsequent visibility toggles and message
  // arrivals are handled by the other effects.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, []);

  // On message-list change OR streaming-buffer change, scroll to
  // bottom if pinned; otherwise show the pill.
  //
  // Story 6.2 Group C polish (user report 2026-04-25): re-check pin
  // status synchronously before snapping. The 'scroll' event fires
  // asynchronously after a programmatic `inner.scrollTop` mutation
  // (which is what NeonScrollbar's thumb drag does on every
  // mousemove). If a chunk arrives mid-drag, this effect can run
  // BEFORE the scroll event handler updates `isPinnedRef.current`,
  // reading a stale `true` from the pre-drag state and snapping the
  // user's hard-won scroll position back to the bottom. Recompute
  // distance-from-bottom here so we trust the live DOM layout, not
  // the cached ref.
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

    // First non-empty tick after mount: always snap to bottom,
    // regardless of synchronous distance — the user just opened
    // the panel and expects the LATEST messages, not history from
    // the top of the scroll buffer.
    const isInitialSnap = !initialSnapDoneRef.current && messages.length > 0;
    if (isInitialSnap) {
      initialSnapDoneRef.current = true;
      el.scrollTop = el.scrollHeight;
      isPinnedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowNewMessagesPill(false);
      return;
    }

    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    const pinnedNow = distanceFromBottom <= PIN_THRESHOLD_PX;
    // Sync the ref with our synchronous read so subsequent paths
    // (and the next scroll-event recompute) start from the truth.
    if (isPinnedRef.current !== pinnedNow) {
      isPinnedRef.current = pinnedNow;
    }

    if (pinnedNow) {
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
