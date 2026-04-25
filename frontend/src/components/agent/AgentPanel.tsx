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
import { AgentPanelOraclePlaceholder } from './AgentPanelOraclePlaceholder';
import { AgentSessionsMenu } from './AgentSessionsMenu';
import './AgentPanel.css';

export function AgentPanel() {
  const panelOpen = useAgentStore((s) => s.panelOpen);
  const closePanel = useAgentStore((s) => s.closePanel);
  const messages = useAgentStore((s) => s.messages);
  const streamingMessageId = useAgentStore((s) => s.streamingMessageId);
  const draft = useAgentStore((s) => s.inputDraft);
  const setDraft = useAgentStore((s) => s.setDraft);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const refreshSessions = useAgentStore((s) => s.refreshSessions);
  const newSession = useAgentStore((s) => s.newSession);
  const loadActiveMessages = useAgentStore((s) => s.loadActiveMessages);
  const activeSessionId = useAgentStore((s) => s.activeSessionId);

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);

  // Refresh sessions + load active messages on open. The store's
  // `panelOpen` flips synchronously; we react to that here so the
  // network call only fires once per false→true transition.
  useEffect(() => {
    if (!panelOpen) return;
    void refreshSessions();
    if (activeSessionId !== null) {
      void loadActiveMessages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen]);

  // Escape handling — see AC 1. Listen at the panel root so the panel
  // doesn't intercept Escape when it's closed (mounted-but-hidden via
  // the slide animation). The composer's own focused-empty branch is
  // kept here too so this single handler is the one source of truth.
  useEffect(() => {
    if (!panelOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const composerFocused = document.activeElement === composerRef.current;
      const hasDraft = draft.trim().length > 0;
      if (composerFocused && hasDraft) {
        e.preventDefault();
        setDraft('');
        return;
      }
      e.preventDefault();
      closePanel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panelOpen, draft, closePanel, setDraft]);

  const handleSend = useCallback(() => {
    if (draft.trim().length === 0) return;
    void sendMessage(draft);
  }, [draft, sendMessage]);

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
        <AgentPanelOraclePlaceholder />
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
            padding: 12,
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
