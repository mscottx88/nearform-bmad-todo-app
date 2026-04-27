import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useCreateTodo } from '../../api/todoApi';
import { useAgentStore } from '../../stores/useAgentStore';
import { usePondStore } from '../../stores/usePondStore';
import { parseHelpCommand } from '../../utils/helpCommand';
import {
  availableCommands,
  parseSlashCommands,
  walkState,
  worldFromVisibility,
  type SlashCommand,
} from '../../utils/slashCommands';
import './TodoInput.css';

interface TodoInputProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Story 3.3 AC #10: seed the controlled input `value` on open so
   * the global `/` shortcut can open the input pre-filled with `/`.
   * Re-seeded every time `isOpen` flips false → true; idle resets
   * back to empty on close.
   */
  initialValue?: string;
}

function generatePosition(): { positionX: number; positionY: number } {
  const angle = Math.random() * Math.PI * 2;
  const radius = 3 + Math.random() * 12;
  return {
    positionX: Math.cos(angle) * radius,
    positionY: Math.sin(angle) * radius,
  };
}

export function TodoInput({ isOpen, onClose, initialValue = '' }: TodoInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dissolving, setDissolving] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const createTodo = useCreateTodo();

  // Visibility slice — drives the slash-command world snapshot.
  // `useShallow` prevents the selector's fresh-object identity from
  // triggering a re-render loop.
  const visibility = usePondStore(
    useShallow((s) => ({
      showActive: s.showActive,
      showCompleted: s.showCompleted,
      showDeleted: s.showDeleted,
    })),
  );

  // Re-seed `value` + reset highlight when the input opens. The
  // effect runs on isOpen transitions so consecutive Enter vs '/'
  // shortcuts land with the right text.
  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
      setHighlightIdx(0);
      // Place caret at end of seeded text — for '/' that's position 1.
      // setTimeout(0) defers past the same-frame focus() call below.
      const el = inputRef.current;
      if (el) {
        el.focus();
        // setSelectionRange only works after value has flushed to DOM.
        queueMicrotask(() => {
          el.setSelectionRange(initialValue.length, initialValue.length);
        });
      }
    }
  }, [isOpen, initialValue]);

  // Compute virtual world + fragment (AC #9) — each keystroke walks
  // every complete token forward and the dropdown filters on the
  // accumulated virtual state.
  const world = useMemo(() => worldFromVisibility(visibility), [visibility]);
  const walk = useMemo(() => walkState(value, world), [value, world]);

  const commandsForDropdown = useMemo<SlashCommand[]>(() => {
    if (walk.invalid) return [];
    const all = availableCommands(walk.world);
    const frag = walk.fragment;
    if (frag === '' || frag === '/') return all;
    const fragLc = frag.toLowerCase();
    return all.filter((c) => c.token.startsWith(fragLc));
  }, [walk]);

  // AC #3: dropdown is DOM-hidden when the input is neither empty
  // nor slash-prefixed.
  const showDropdown = isOpen && (value === '' || value.startsWith('/'));

  // Clamp highlight into bounds whenever the filtered list changes.
  useEffect(() => {
    if (highlightIdx >= commandsForDropdown.length) {
      setHighlightIdx(0);
    }
  }, [commandsForDropdown.length, highlightIdx]);

  if (!isOpen && !dissolving) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }

    if (e.key === 'ArrowDown' && commandsForDropdown.length > 0) {
      e.preventDefault();
      setHighlightIdx((i) => (i + 1) % commandsForDropdown.length);
      return;
    }

    if (e.key === 'ArrowUp' && commandsForDropdown.length > 0) {
      e.preventDefault();
      setHighlightIdx(
        (i) => (i - 1 + commandsForDropdown.length) % commandsForDropdown.length,
      );
      return;
    }

    if (e.key === 'Tab' && commandsForDropdown.length > 0 && value.startsWith('/')) {
      e.preventDefault();
      const highlighted = commandsForDropdown[highlightIdx];
      if (!highlighted) return;
      // Replace the trailing fragment (if any) with the full token
      // plus a trailing space to enable chaining (AC #9).
      const completedPrefix = walk.fragment
        ? value.slice(0, value.length - walk.fragment.length)
        : value.endsWith(' ') ? value : `${value} `;
      const nextValue = `${completedPrefix}${highlighted.token} `;
      setValue(nextValue);
      setHighlightIdx(0);
      return;
    }

    if (e.key === 'Enter') {
      const trimmed = value.trim();
      if (!trimmed) return;

      // Story 6.2 AC 2: `/help` and `/help <text>` carve-out. Runs BEFORE
      // the registry walker so the help branch never falls into the
      // toggle-command framework. On match, open the agent panel with
      // the prefill (if any), reset the composer, and close TodoInput.
      //
      // Story 6.2 Group D CR P2: only seed the agent draft when the
      // user actually supplied a prefill — bare `/help` should NOT
      // wipe an in-progress agent-composer draft. Mirrors the same
      // guard `activateAgentHelp` (the source-of-truth helper) uses.
      const help = parseHelpCommand(trimmed);
      if (help !== null) {
        const agent = useAgentStore.getState();
        agent.openPanel();
        if (help.prefill) {
          agent.setDraft(help.prefill);
        }
        setValue('');
        onClose();
        return;
      }

      // Slash-command chain (AC #4). Parse against the *real* world
      // (not the virtual walk) — `parseSlashCommands` does its own
      // walk internally and validates consumability.
      if (trimmed.startsWith('/')) {
        const commands = parseSlashCommands(trimmed, world);
        if (commands) {
          for (const cmd of commands) cmd.execute();
          setValue('');
          onClose();
          return;
        }
        // Fall-through: invalid command chain becomes todo text.
      }

      // Todo-create path — unchanged from pre-3.3.
      setDissolving(true);
      const pos = generatePosition();
      createTodo.mutate({ text: trimmed, ...pos });
      usePondStore.getState().focusCamera(pos.positionX, pos.positionY);
      setTimeout(() => {
        setDissolving(false);
        setValue('');
        onClose();
      }, 100);
    }
  };

  return createPortal(
    <div className="todo-input-overlay">
      <div className="todo-input-shell">
        <input
          ref={inputRef}
          className={`todo-input ${dissolving ? 'todo-input--dissolving' : ''}`}
          type="text"
          // Story 1.5 review patch: stable hook for Playwright. The
          // placeholder copy is user-facing and may change; the
          // testid won't.
          data-testid="todo-input"
          placeholder="what's on your mind..."
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={onClose}
        />
        <span className="todo-input-hint" aria-hidden="true">
          enter to save · esc to dismiss
        </span>
        {showDropdown && (
          <ul
            className={`todo-input-dropdown ${
              value.startsWith('/')
                ? 'todo-input-dropdown--active'
                : 'todo-input-dropdown--dim'
            }`}
            role="listbox"
          >
            {commandsForDropdown.map((cmd, i) => (
              <li
                key={cmd.token}
                role="option"
                aria-selected={i === highlightIdx}
                className={
                  i === highlightIdx
                    ? 'todo-input-dropdown__item--highlighted'
                    : 'todo-input-dropdown__item'
                }
              >
                <span className="todo-input-dropdown__token">{cmd.token}</span>
                <span className="todo-input-dropdown__desc">{cmd.description}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
