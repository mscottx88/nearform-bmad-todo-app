/**
 * Always-visible affordance footer in the bottom-left corner. Shows
 * the top-level keyboard + mouse shortcuts so users can discover
 * what's interactive without reading a manual:
 *
 *   Keyboard:
 *     Enter     → open TodoInput to add a new task
 *     /         → open TodoInput pre-filled with `/` for slash commands
 *     F1        → toggle the agent chat panel
 *     Esc       → close popup / cancel current action
 *     Esc · Esc → reset the camera (double-tap within 600ms)
 *     ↑ / ↓     → recall prior chat messages in the agent composer
 *
 *   Mouse:
 *     Click pad     → open the task's info popup
 *     Drag pad      → reposition the task on the pond
 *     Right-drag    → pan the camera across the pond
 *     Wheel         → zoom in / out
 *
 * Was previously the bottom of `EmptyPondHint`, which only mounted
 * with zero todos — users with existing tasks couldn't see the
 * shortcuts and didn't know F1 opened the agent panel. Now mounted
 * once at the App level so the affordances are always discoverable.
 *
 * Pure DOM (not inside the R3F canvas) so it renders even when the
 * 3D scene is loading. Low-opacity neon styling keeps it
 * unobtrusive.
 */

import './KeyboardShortcutsHint.css';

/**
 * One affordance row. `keys` is an array so a chord (e.g. Esc·Esc)
 * can be rendered as multiple `<kbd>` elements separated by a small
 * delimiter — Story 6.2 Group C CR P12: a single `<kbd>Esc · Esc</kbd>`
 * is announced by screen readers as the literal string "Esc dot Esc",
 * which mis-reads the chord. Two `<kbd>` chips with `aria-label` on
 * the wrapping `<li>` reads correctly.
 */
interface Hint {
  /** Sequence of key labels. Single-key shortcuts pass an array of
   *  one; chords pass two or more. */
  keys: ReadonlyArray<string>;
  /** Lower-cased description rendered after the chip(s). */
  desc: string;
  /** Optional accessible name for the whole row, used when the
   *  visual chord notation reads weird verbatim. */
  ariaLabel?: string;
}

const KEYBOARD_HINTS: ReadonlyArray<Hint> = [
  { keys: ['Enter'], desc: 'new task' },
  { keys: ['/'], desc: 'slash command' },
  { keys: ['F1'], desc: 'agent help' },
  { keys: ['Esc'], desc: 'close · cancel' },
  {
    keys: ['Esc', 'Esc'],
    desc: 'reset camera',
    ariaLabel: 'Escape twice — reset camera',
  },
  // ↑/↓ chat-history navigation is INTENTIONALLY not in this global
  // footer — it's a composer-only affordance, and the composer's own
  // focus-only hint band already announces it
  // (`↑/↓ history` text in `AgentComposer.tsx`'s
  // `.agent-composer-hint` strip). Showing it globally would imply
  // app-wide history navigation, which doesn't exist.
];

const MOUSE_HINTS: ReadonlyArray<Hint> = [
  { keys: ['click'], desc: 'open task' },
  { keys: ['drag'], desc: 'move task' },
  { keys: ['right-drag'], desc: 'pan camera' },
  // Both Ctrl+RMB (OrbitControls' built-in modifier swap) and
  // Shift+RMB (the swap in PondCamera.tsx) trigger camera rotate;
  // we surface only the Shift form in the hint because Ctrl
  // conflicts with the right-click menu on some Mac configs.
  { keys: ['shift + right-drag'], desc: 'rotate camera' },
  { keys: ['wheel'], desc: 'zoom' },
];

function HintGroup({
  label,
  hints,
}: {
  label: string;
  hints: ReadonlyArray<Hint>;
}) {
  return (
    <div className="kbd-hints__group">
      <span className="kbd-hints__group-label">{label}</span>
      <ul className="kbd-hints__list" aria-label={label}>
        {hints.map((h) => {
          const liKey = `${label}-${h.keys.join('+')}-${h.desc}`;
          return (
            <li key={liKey} aria-label={h.ariaLabel}>
              {h.keys.map((k, idx) => (
                <span key={idx} className="kbd-hints__key-group">
                  {idx > 0 && (
                    <span className="kbd-hints__chord-sep" aria-hidden="true">
                      ·
                    </span>
                  )}
                  <kbd className="kbd-hints__key">{k}</kbd>
                </span>
              ))}
              <span className="kbd-hints__desc">{h.desc}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function KeyboardShortcutsHint() {
  return (
    <aside className="kbd-hints" aria-label="Shortcuts">
      <HintGroup label="keys" hints={KEYBOARD_HINTS} />
      <HintGroup label="mouse" hints={MOUSE_HINTS} />
    </aside>
  );
}
