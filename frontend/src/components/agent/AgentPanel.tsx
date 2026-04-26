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

import { useCallback, useEffect, useRef, useState } from 'react';
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
    <aside className="agent-panel" role="complementary" aria-label="Agent chat">
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
