import { Html } from '@react-three/drei';
import './EmptyPondHint.css';

const HINT_TEXT = 'just start typing...';

/**
 * Centered hero-typewriter hint that appears in the middle of the
 * pond when there are no todos. The shortcut list that used to live
 * here was extracted into the always-visible
 * [`KeyboardShortcutsHint`](./KeyboardShortcutsHint.tsx) — users
 * with existing todos couldn't see the shortcuts before, so they're
 * now a global affordance.
 */
export function EmptyPondHint() {
  return (
    <Html
      position={[0, 0.1, 0]}
      center
      style={{ pointerEvents: 'none' }}
    >
      <div className="empty-hint-wrap">
        <div className="empty-hint" role="img" aria-label={HINT_TEXT}>
          {HINT_TEXT.split('').map((char, i) => (
            <span
              key={i}
              className="empty-hint__char"
              style={{ animationDelay: `${i * 0.08}s` }}
              aria-hidden="true"
            >
              {/*
                Each char becomes a flex item (parent is `display:
                flex`). A regular `' '` flex item has zero rendered
                width — the spaces in "just start typing" collapsed
                and rendered as "juststarttyping". ` ` (NBSP)
                forces the space to be a real glyph with width. The
                previous code attempted this with a ternary but both
                branches returned the same character.
              */}
              {char === ' ' ? ' ' : char}
            </span>
          ))}
        </div>
      </div>
    </Html>
  );
}
