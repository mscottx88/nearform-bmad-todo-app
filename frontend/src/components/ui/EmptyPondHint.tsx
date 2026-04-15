import { Html } from '@react-three/drei';
import './EmptyPondHint.css';

const HINT_TEXT = 'just start typing...';

export function EmptyPondHint() {
  return (
    <Html
      position={[0, 0.1, 0]}
      center
      style={{ pointerEvents: 'none' }}
    >
      <div className="empty-hint" aria-label={HINT_TEXT}>
        {HINT_TEXT.split('').map((char, i) => (
          <span
            key={i}
            className="empty-hint__char"
            style={{ animationDelay: `${i * 0.08}s` }}
          >
            {char === ' ' ? '\u00A0' : char}
          </span>
        ))}
      </div>
    </Html>
  );
}
