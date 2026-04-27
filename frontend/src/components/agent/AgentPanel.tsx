/**
 * Story 6.2: AgentPanel — right-side neon drawer that hosts the chat
 * thread, the Oracle-Frog placeholder, and the composer/controls strip.
 *
 * Layout (top → bottom, three sections):
 *   1. Oracle-Frog overlay (16:10 placeholder; 6.7 will swap in `<View>`)
 *   2. Chat thread (NeonScrollbar wrap mode + AgentMessageList)
 *   3. Composer + controls strip (textarea + button row)
 *
 * Open/close behaviour (AC 1):
 *   - F1 toggles via `useAgentStore.togglePanel()` (handler in
 *     useKeyboardShortcuts).
 *   - Escape:
 *       a) composer focused + has content → clear draft, do NOT close
 *       b) composer unfocused, OR focused but empty → close panel
 *
 * Effect on open: refresh the sessions list, hydrate the active session
 * if one is set, otherwise create a new session lazily on first send.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useAgentStore } from '../../stores/useAgentStore';
import { usePondStore } from '../../stores/usePondStore';
import { NeonScrollbar } from '../ui/NeonScrollbar';
import { AgentComposer } from './AgentComposer';
import { AgentControlsRow } from './AgentControlsRow';
import { AgentMessageList } from './AgentMessageList';
import { AgentPanelOracleView } from './AgentPanelOracleView';
import { AgentSessionsMenu } from './AgentSessionsMenu';
import './AgentPanel.css';

export function AgentPanel() {
  const panelOpen = useAgentStore((s) => s.panelOpen);
  const closePanel = useAgentStore((s) => s.closePanel);
  const messages = useAgentStore((s) => s.messages);
  const streamingMessageId = useAgentStore((s) => s.streamingMessageId);
  // P9: `draft` and `setDraft` are no longer pulled via selectors —
  // the Escape handler reads via `getState()` to avoid re-subscribing
  // on every keystroke; `handleSend` does the same. The render path
  // doesn't otherwise need to react to draft changes.
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const refreshSessions = useAgentStore((s) => s.refreshSessions);
  const newSession = useAgentStore((s) => s.newSession);
  const loadActiveMessages = useAgentStore((s) => s.loadActiveMessages);

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);

  // ── Story 6.9: drag-to-resize panel ───────────────────────────────
  const panelWidth = useAgentStore((s) => s.panelWidth);
  const setPanelWidth = useAgentStore((s) => s.setPanelWidth);
  // Mid-drag (or mid-keypress) width that hasn't been committed to the
  // persisted store yet. Visual feedback flows through this draft via
  // the CSS variable; the commit happens on pointerup / keyup. Avoids
  // localStorage thrash during a 60Hz pointermove stream.
  const [draftWidth, setDraftWidth] = useState<number | null>(null);
  // Tracks the live viewport width so aria-valuemin/max stay current
  // and the clamp helper reads a fresh value on each interaction.
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1024 : window.innerWidth,
  );
  const dragStartRef = useRef<{ pointerX: number; baseWidth: number } | null>(
    null,
  );

  const minWidth = Math.round(viewportWidth * 0.25);
  const maxWidth = Math.round(viewportWidth * 0.5);
  const clampWidth = useCallback(
    (w: number, vw = viewportWidth) => {
      const lo = Math.round(vw * 0.25);
      const hi = Math.round(vw * 0.5);
      return Math.min(hi, Math.max(lo, w));
    },
    [viewportWidth],
  );
  const effectiveWidth = clampWidth(draftWidth ?? panelWidth);

  // AC 4: re-clamp the persisted width whenever the viewport resizes.
  // Run once on mount too — if the user reloaded with a viewport that's
  // narrower than when they last dragged, the persisted value may
  // already violate the 50%-max rule.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      const vw = window.innerWidth;
      setViewportWidth(vw);
      const persisted = useAgentStore.getState().panelWidth;
      const clamped = clampWidth(persisted, vw);
      if (clamped !== persisted) {
        useAgentStore.getState().setPanelWidth(clamped);
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
    // clampWidth is stable across renders (depends on viewportWidth
    // which we update inside) — the effect only needs to bind once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Only respond to primary-button drags. Right-clicks / middle-
      // clicks shouldn't initiate resize.
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStartRef.current = {
        pointerX: e.clientX,
        baseWidth: useAgentStore.getState().panelWidth,
      };
      setDraftWidth(useAgentStore.getState().panelWidth);
      // Story 6.9: keep the resize-h cursor visible during the drag.
      // PointerEnter has typically already set this on hover, but if
      // the press happened during a fast in-flight enter, ensure it.
      const pondStore = usePondStore.getState();
      if (pondStore.cursorMode !== 'resize-h') {
        pondStore.setCursorMode('resize-h');
      }
    },
    [],
  );

  const handleResizePointerEnter = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Story 6.9: only swap from 'firefly'. If a higher-priority
      // cursor mode (`grabbing` mid-drag from elsewhere, `text` over
      // a focused composer, etc.) is active, leave it alone.
      const pondStore = usePondStore.getState();
      if (pondStore.cursorMode === 'firefly') {
        pondStore.setCursorMode('resize-h');
      }
      // Suppress unused-arg warning in strict TS configs.
      void e;
    },
    [],
  );

  const handleResizePointerLeave = useCallback(() => {
    // Story 6.9: don't drop the resize-h cursor while a drag is in
    // progress — the pointer has often left the 6px hit zone by the
    // time the user has dragged the panel several hundred pixels.
    if (dragStartRef.current !== null) return;
    const pondStore = usePondStore.getState();
    if (pondStore.cursorMode === 'resize-h') {
      pondStore.setCursorMode('firefly');
    }
  }, []);

  const handleResizePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      if (start === null) return;
      // Panel sits at the right of the viewport. Pointer moving left
      // (smaller clientX) widens the panel; right narrows it. Hence
      // `baseWidth - (pointerX - startX)`.
      const dx = e.clientX - start.pointerX;
      setDraftWidth(clampWidth(start.baseWidth - dx));
    },
    [clampWidth],
  );

  const commitDraft = useCallback(() => {
    if (draftWidth !== null) {
      // Calling the zustand setter from inside a `setDraftWidth`
      // functional updater triggers a same-tick re-render of any
      // component subscribed to `panelWidth` (us) — React 19 warns
      // about that as a cross-component state update during a render.
      // Reading `draftWidth` from state and committing both updates
      // separately keeps each setter outside the other's transaction.
      setPanelWidth(clampWidth(draftWidth));
    }
    setDraftWidth(null);
  }, [clampWidth, draftWidth, setPanelWidth]);

  const handleResizePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragStartRef.current === null) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      dragStartRef.current = null;
      commitDraft();
      // Story 6.9: if the pointer is no longer over the handle when
      // the drag ends (common — the panel has moved), drop back to
      // firefly. PointerLeave was suppressed during drag (above), so
      // this is the catch-up restore.
      const handleEl = e.currentTarget;
      const rect = handleEl.getBoundingClientRect();
      const stillOver =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!stillOver) {
        const pondStore = usePondStore.getState();
        if (pondStore.cursorMode === 'resize-h') {
          pondStore.setCursorMode('firefly');
        }
      }
    },
    [commitDraft],
  );

  const handleResizeKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      // Left-arrow widens (pulls handle left), right-arrow narrows.
      const delta = e.key === 'ArrowLeft' ? 20 : -20;
      const base =
        draftWidth !== null
          ? draftWidth
          : useAgentStore.getState().panelWidth;
      setDraftWidth(clampWidth(base + delta));
    },
    [clampWidth, draftWidth],
  );

  const handleResizeKeyUp = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      commitDraft();
    },
    [commitDraft],
  );

  // Refresh sessions + load active messages on open. The store's
  // `panelOpen` flips synchronously; we react to that here so the
  // network call only fires once per false→true transition.
  //
  // Story 6.2 Group B CR P6: previously these two calls fired in
  // parallel — `loadActiveMessages` could 404 on a persisted-but-
  // server-deleted session before `refreshSessions` got a chance to
  // clear `activeSessionId`. Sequence them so refresh validates the
  // persisted id first; loadActiveMessages then reads the post-
  // validation state via getState().
  //
  // Group C polish (user request 2026-04-25): focus the composer on
  // open so F1 → type-immediately works without an extra click. Done
  // synchronously in the same effect so the focus happens on the
  // first paint of the open panel; a `requestAnimationFrame` defer
  // handles the case where the textarea ref hasn't attached yet.
  useEffect(() => {
    if (!panelOpen) return;
    void (async () => {
      await refreshSessions();
      if (useAgentStore.getState().activeSessionId !== null) {
        await loadActiveMessages();
      }
    })();
    requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- panelOpen-only
  }, [panelOpen]);

  // Escape handling — see AC 1. Listen at the panel root so the panel
  // doesn't intercept Escape when it's closed (mounted-but-hidden via
  // the slide animation). The composer's own focused-empty branch is
  // kept here too so this single handler is the one source of truth.
  //
  // Story 6.2 Group B CR P9: read `inputDraft` via `getState()` inside
  // the handler instead of subscribing via the `draft` selector and
  // listing it in the deps array. The previous shape unbound and
  // rebound the global keydown listener on every keystroke (since
  // `draft` changes on every character), wasting work and creating a
  // brief window where Escape during the listener swap could be missed.
  useEffect(() => {
    if (!panelOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const composerFocused = document.activeElement === composerRef.current;
      const store = useAgentStore.getState();
      const hasDraft = store.inputDraft.trim().length > 0;
      if (composerFocused && hasDraft) {
        e.preventDefault();
        store.setDraft('');
        return;
      }
      e.preventDefault();
      closePanel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panelOpen, closePanel]);

  const handleSend = useCallback(() => {
    // P9: read latest draft at click-time via getState() so this
    // callback doesn't have to re-create on every keystroke (which
    // would cascade re-renders down to AgentControlsRow).
    const draft = useAgentStore.getState().inputDraft;
    if (draft.trim().length === 0) return;
    void sendMessage(draft);
  }, [sendMessage]);

  const handleNewChat = useCallback(() => {
    void newSession();
    setSessionsOpen(false);
  }, [newSession]);

  // Don't render the panel chrome at all when closed — keeps the F1
  // tab order clean and avoids stacking the neon canvas over the
  // pond when nothing's visible.
  if (!panelOpen) return null;

  return (
    <aside
      className="agent-panel"
      role="complementary"
      aria-label="Agent chat"
      style={{ '--agent-panel-width': `${effectiveWidth}px` } as CSSProperties}
    >
      {/*
       * Story 6.9: 6px-wide invisible hit zone overlapping the panel's
       * 1px left border. role="separator" + aria-orientation="vertical"
       * follows the WAI-ARIA window-splitter pattern. Pointer events
       * drive drag-resize; ArrowLeft / ArrowRight on the focused handle
       * resize by ±20px. Visual cyan glow lives in CSS via :hover /
       * :focus-visible — at rest, the existing 1px border is all the
       * user sees.
       */}
      <div
        className="agent-panel__resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
        aria-valuenow={effectiveWidth}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        tabIndex={0}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        onPointerCancel={handleResizePointerUp}
        onPointerEnter={handleResizePointerEnter}
        onPointerLeave={handleResizePointerLeave}
        onKeyDown={handleResizeKeyDown}
        onKeyUp={handleResizeKeyUp}
      />
      <section className="agent-panel__section agent-panel__section--oracle">
        <AgentPanelOracleView />
      </section>
      <div className="agent-panel__divider" role="separator" />
      <section className="agent-panel__section agent-panel__section--chat">
        <NeonScrollbar
          color="cyan"
          className="agent-panel__chat-scroll"
          innerStyle={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            // Asymmetric horizontal padding by design: the
            // NeonScrollbar's vertical track is 15px wide and sits
            // at `right: 0` of the outer wrapper, so a symmetric
            // 20/20 padding produces VISUALLY uneven gutters
            // (left bubble has 20px of empty space, right bubble
            // has ~5px before the track starts). 20px on the left,
            // 20+15=35px on the right makes the visible empty
            // space equal on both sides regardless of where the
            // bubble is anchored.
            //
            // Vertical padding stays at 12 — the bottom track only
            // appears for horizontal scroll which the chat list
            // never produces.
            paddingTop: 12,
            paddingBottom: 12,
            paddingLeft: 20,
            paddingRight: 35,
          }}
          scrollRef={chatScrollRef}
          // Cursor swaps:
          //   thumb hover → 'grab' (open frog hand)
          //   thumb drag  → 'grabbing' (closed frog hand)
          // Restore to 'firefly' on hover-leave / drag-end so the
          // default firefly returns when the cursor moves off.
          onThumbHover={(hovered) => {
            const store = usePondStore.getState();
            if (hovered) {
              if (store.cursorMode === 'firefly') {
                store.setCursorMode('grab');
              }
            } else if (store.cursorMode === 'grab') {
              store.setCursorMode('firefly');
            }
          }}
          onThumbDrag={(dragging) => {
            const store = usePondStore.getState();
            if (dragging) {
              store.setCursorMode('grabbing');
            } else if (store.cursorMode === 'grabbing') {
              // After drag-release, return to 'grab' if the cursor
              // is still over the thumb (the hover handler will be
              // the next event), otherwise back to 'firefly'.
              store.setCursorMode('firefly');
            }
          }}
        >
          <AgentMessageList
            messages={messages}
            streamingMessageId={streamingMessageId}
            scrollRef={chatScrollRef}
          />
        </NeonScrollbar>
        {sessionsOpen && (
          <AgentSessionsMenu onClose={() => setSessionsOpen(false)} />
        )}
      </section>
      <div className="agent-panel__divider" role="separator" />
      <section className="agent-panel__section agent-panel__section--composer">
        <AgentComposer ref={composerRef} onSubmit={() => handleSend()} />
        <AgentControlsRow
          onNewChat={handleNewChat}
          onToggleSessions={() => setSessionsOpen((v) => !v)}
          onSend={handleSend}
          onClose={closePanel}
          sessionsOpen={sessionsOpen}
        />
      </section>
    </aside>
  );
}
