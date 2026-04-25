/**
 * Composer textarea — multi-line, auto-grow up to 6 lines, then scrolls
 * internally. Enter sends, Shift+Enter inserts a newline. Escape
 * handling lives in the parent panel because the close-vs-clear-draft
 * decision depends on whether the composer is focused AND empty.
 *
 * Story 6.2 enhancement: Up arrow at the first character of the
 * composer recalls previous user messages (terminal / Claude Code-
 * style history navigation). Down arrow walks back forward; clearing
 * the index restores the in-progress draft the user had typed before
 * starting to navigate history.
 */

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useAgentStore } from '../../stores/useAgentStore';

interface Props {
  onSubmit: (content: string) => void;
}

const MAX_LINES = 6;
const LINE_HEIGHT_PX = 20;
const MAX_HEIGHT_PX = MAX_LINES * LINE_HEIGHT_PX + 16; /* + vertical padding */

export const AgentComposer = forwardRef<HTMLTextAreaElement, Props>(
  function AgentComposer({ onSubmit }, ref) {
    const draft = useAgentStore((s) => s.inputDraft);
    const setDraft = useAgentStore((s) => s.setDraft);
    const messages = useAgentStore((s) => s.messages);
    const internalRef = useRef<HTMLTextAreaElement>(null);
    // Tick state used solely to force a re-render after focus / blur
    // so the keyboard-hint visibility tracks the textarea's actual
    // focus state. (`document.activeElement` reads can't drive a
    // re-render on their own.)
    const [, forceHintTick] = useState(0);
    // -1 = no history navigation in progress (composer holds the
    // user's in-progress draft). 0 = the most recent prior user
    // message; 1 = the next-most-recent, etc.
    const [historyIndex, setHistoryIndex] = useState(-1);
    // Snapshot of whatever the user had typed before they started
    // navigating history, so Down-arrowing back past index 0 restores
    // it instead of clearing the composer.
    const stashedDraftRef = useRef<string>('');

    // The list of recallable user messages, oldest → newest order
    // reversed so index 0 is the most recent (terminal-history
    // semantics — Up reaches FURTHER back).
    const userMessageHistory = useMemo(
      () =>
        messages
          .filter((m) => m.role === 'user')
          .map((m) => m.content)
          .reverse(),
      [messages],
    );

    // Auto-grow: reset to auto then read scrollHeight to fit content
    // up to the cap. The cap engages internal scroll past 6 lines.
    useEffect(() => {
      const el = internalRef.current;
      if (el === null) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
    }, [draft]);

    // Reset history navigation whenever the user types (changes the
    // draft outside the recall path). The simplest signal: a fresh
    // user keystroke that's NOT an arrow-key recall.
    const resetHistory = () => {
      if (historyIndex !== -1) setHistoryIndex(-1);
    };

    const setRefs = (el: HTMLTextAreaElement | null) => {
      internalRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref !== null) ref.current = el;
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const trimmed = draft.trim();
        if (!trimmed) return;
        // Reset history pointer on send so the next Up starts from
        // the message we just submitted.
        setHistoryIndex(-1);
        stashedDraftRef.current = '';
        onSubmit(trimmed);
        return;
      }

      const el = internalRef.current;
      const cursorAtStart = el !== null && el.selectionStart === 0 && el.selectionEnd === 0;

      // Up arrow at the very start of the composer walks BACK through
      // user-message history. If the cursor is anywhere else in the
      // textarea, fall through to native caret movement.
      if (e.key === 'ArrowUp' && cursorAtStart) {
        if (userMessageHistory.length === 0) return;
        const nextIndex = Math.min(historyIndex + 1, userMessageHistory.length - 1);
        if (nextIndex === historyIndex) return; // already at oldest
        if (historyIndex === -1) {
          // Stash the in-progress draft before we overwrite it.
          stashedDraftRef.current = draft;
        }
        e.preventDefault();
        setHistoryIndex(nextIndex);
        setDraft(userMessageHistory[nextIndex]);
        return;
      }

      // Down arrow walks FORWARD through history. At index 0,
      // pressing Down exits history mode and restores the stashed
      // draft.
      if (e.key === 'ArrowDown' && historyIndex !== -1) {
        e.preventDefault();
        const nextIndex = historyIndex - 1;
        if (nextIndex < 0) {
          setHistoryIndex(-1);
          setDraft(stashedDraftRef.current);
          stashedDraftRef.current = '';
          return;
        }
        setHistoryIndex(nextIndex);
        setDraft(userMessageHistory[nextIndex]);
        return;
      }
    };

    // Show the keyboard hint only while the composer is focused — an
    // always-on hint clutters the chrome for users who already know
    // the shortcut. The hint sits just under the textarea and uses
    // the neon-mono micro-text style we use elsewhere for keyboard
    // affordances.
    const hasFocus =
      typeof document !== 'undefined' &&
      document.activeElement === internalRef.current;

    return (
      <div className="agent-composer-wrap">
        <textarea
          ref={setRefs}
          className="agent-composer"
          placeholder="ask anything…"
          value={draft}
          onChange={(e) => {
            resetHistory();
            setDraft(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => forceHintTick((t) => t + 1)}
          onBlur={() => forceHintTick((t) => t + 1)}
          rows={1}
          style={{ maxHeight: MAX_HEIGHT_PX }}
        />
        <span
          className={[
            'agent-composer-hint',
            hasFocus ? 'agent-composer-hint--visible' : null,
          ]
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
        >
          enter to send · shift+enter for new line · ↑/↓ history
        </span>
      </div>
    );
  },
);
