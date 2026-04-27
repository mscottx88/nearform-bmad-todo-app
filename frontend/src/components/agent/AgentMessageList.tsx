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
  // subsequent ticks rely on the snapshot-based pin check.
  const initialSnapDoneRef = useRef(false);
  // Story 6.7 user report (2026-04-25): "when sending a chat
  // message and scrolled to the bottom, the chat should always
  // auto scroll to the bottom as new content arrives".
  //
  // The previous logic recomputed `distanceFromBottom` LIVE on
  // each grow/stream tick, but by the time the effect runs the
  // new bubble has ALREADY been added to the DOM, pushing the
  // bottom further away than the threshold — so even when the
  // user was at the bottom right before sending, the live read
  // says "not pinned" and we suppress the snap. Track the
  // PREVIOUS scroll snapshot from the last scroll event (which
  // reflects pre-new-content DOM) and base the pin decision on
  // THAT instead.
  const lastObservedRef = useRef<{
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  } | null>(null);

  // Keep `isPinnedRef` in sync with the actual scroll position. Fires
  // on user-initiated scroll and on programmatic scrolls. Also
  // refreshes `lastObservedRef` so the next grow/stream tick has a
  // pre-new-content snapshot to read pinned-state from.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const recompute = () => {
      const distanceFromBottom =
        el.scrollHeight - el.clientHeight - el.scrollTop;
      const pinned = distanceFromBottom <= PIN_THRESHOLD_PX;
      setPinned(pinned);
      if (pinned) setShowNewMessagesPill(false);
      lastObservedRef.current = {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      };
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
  // bottom if the user was pinned BEFORE the new content arrived.
  //
  // We base "was-pinned-before" on `lastObservedRef` (snapshot from
  // the most recent scroll event) — NOT on a live recompute against
  // the just-mutated DOM. The live recompute is what broke the
  // common case "user at bottom, sends a message": after the
  // grow, the new bubble has already pushed `scrollHeight` past
  // threshold, so a live read says "not pinned" even though the
  // user WAS at the bottom. Reading the snapshot avoids that.
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

    // 2026-04-26 fix (user report: "New Messages indicator
    // appearing when it should not"): if the chat content fits
    // inside the visible scroll area (no overflow), there's no
    // "below the fold" for the pill to point at. Suppress it
    // unconditionally — independent of any snapshot stale-state
    // shenanigans. Threshold-aware so a one-pixel overflow at the
    // edge of the bubble's box isn't mistaken for "scrollable".
    const noOverflow =
      el.scrollHeight <= el.clientHeight + PIN_THRESHOLD_PX;
    if (noOverflow) {
      el.scrollTop = el.scrollHeight;
      isPinnedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowNewMessagesPill(false);
      return;
    }

    // First non-empty tick after mount: always snap to bottom.
    const isInitialSnap = !initialSnapDoneRef.current && messages.length > 0;
    if (isInitialSnap) {
      initialSnapDoneRef.current = true;
      el.scrollTop = el.scrollHeight;
      isPinnedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowNewMessagesPill(false);
      return;
    }

    // Was the user pinned BEFORE this new content? Use the
    // snapshot from the last scroll event, falling back to the
    // ref if no snapshot exists yet.
    const snap = lastObservedRef.current;
    let wasPinned = isPinnedRef.current;
    if (snap !== null) {
      const oldDistance = snap.scrollHeight - snap.clientHeight - snap.scrollTop;
      wasPinned = oldDistance <= PIN_THRESHOLD_PX;
    }
    // 2026-04-26 defence in depth: if the LIVE state currently
    // shows the user at the bottom, hide the pill regardless of
    // snapshot. Catches cases where `lastObservedRef` is stale
    // (e.g. a session-switch that didn't fire a scroll event, or
    // a programmatic scroll write that didn't yield a scroll
    // event because the position was already maximised). The
    // snapshot's "wasn't pinned" can be a false negative; live
    // "is currently pinned" is a more authoritative positive
    // signal in that direction.
    const liveDistance =
      el.scrollHeight - el.clientHeight - el.scrollTop;
    const liveAtBottom = liveDistance <= PIN_THRESHOLD_PX;

    if (wasPinned || liveAtBottom) {
      el.scrollTop = el.scrollHeight;
      isPinnedRef.current = true;
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
  //
  // 2026-04-26: also reconcile the pill on resize. If the new layout
  // means content no longer overflows (e.g. panel got wider, fewer
  // lines wrap), there's nothing below the fold and the pill — if
  // showing — must hide.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const ro = new ResizeObserver(() => {
      if (isPinnedRef.current) {
        el.scrollTop = el.scrollHeight;
      }
      if (el.scrollHeight <= el.clientHeight + PIN_THRESHOLD_PX) {
        setShowNewMessagesPill(false);
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
