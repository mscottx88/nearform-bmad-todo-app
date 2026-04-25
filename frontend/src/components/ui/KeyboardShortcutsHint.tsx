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

interface Hint {
  /** Visible label inside the `<kbd>` chip. May be a chord like
   *  "Esc · Esc" — the chip styles handle the punctuation cleanly. */
  key: string;
  /** Lower-cased description rendered after the chip. */
  desc: string;
}

const KEYBOARD_HINTS: ReadonlyArray<Hint> = [
  { key: 'Enter', desc: 'new task' },
  { key: '/', desc: 'slash command' },
  { key: 'F1', desc: 'agent help' },
  { key: 'Esc', desc: 'close · cancel' },
  { key: 'Esc · Esc', desc: 'reset camera' },
];

const MOUSE_HINTS: ReadonlyArray<Hint> = [
  { key: 'click', desc: 'open task' },
  { key: 'drag', desc: 'move task' },
  { key: 'right-drag', desc: 'pan camera' },
  // Both Ctrl+RMB (OrbitControls' built-in modifier swap) and
  // Shift+RMB (the swap in PondCamera.tsx) trigger camera rotate;
  // we surface only the Shift form in the hint because Ctrl
  // conflicts with the right-click menu on some Mac configs.
  { key: 'shift + right-drag', desc: 'rotate camera' },
  { key: 'wheel', desc: 'zoom' },
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
        {hints.map((h) => (
          <li key={`${label}-${h.key}`}>
            <kbd className="kbd-hints__key">{h.key}</kbd>
            <span className="kbd-hints__desc">{h.desc}</span>
          </li>
        ))}
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
