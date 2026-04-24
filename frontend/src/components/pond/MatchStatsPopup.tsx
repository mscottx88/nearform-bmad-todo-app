import { Html } from '@react-three/drei';
import type { SearchHit, SearchMatchType } from '../../types';
import './MatchStatsPopup.css';

// Pole-height envelope (world units). Score scales linearly between
// these two bounds — a ~0.0 match yields a short pole, a ~1.0 match
// yields a pole roughly 2.5x the pad diameter. Capped to keep the
// tallest sign inside the camera's typical framing.
const MIN_POLE_HEIGHT = 0.5;
const MAX_POLE_HEIGHT = 2.5;

// Inline SVG icons — render at currentColor so the popup's neon glow is
// inherited via text-shadow + drop-shadow. No external icon package
// dependency for a four-glyph set.
const ScoreIcon = () => (
  <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
    <circle
      cx="8"
      cy="8"
      r="6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <circle cx="8" cy="8" r="2" fill="currentColor" />
  </svg>
);

const KeywordIcon = () => (
  <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
    <text
      x="8"
      y="12"
      textAnchor="middle"
      fontFamily="'Share Tech Mono', monospace"
      fontWeight="700"
      fontSize="11"
      fill="currentColor"
    >
      Aa
    </text>
  </svg>
);

const SemanticIcon = () => (
  <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
    {/* four-point sparkle */}
    <path
      d="M8 1 L9.2 6.8 L15 8 L9.2 9.2 L8 15 L6.8 9.2 L1 8 L6.8 6.8 Z"
      fill="currentColor"
    />
  </svg>
);

const HybridIcon = () => (
  <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
    {/* lightning bolt */}
    <path
      d="M10 1 L3 9 L7 9 L6 15 L13 7 L9 7 L10 1 Z"
      fill="currentColor"
    />
  </svg>
);

const MATCH_ICON: Record<SearchMatchType, () => React.JSX.Element> = {
  keyword: KeywordIcon,
  semantic: SemanticIcon,
  hybrid: HybridIcon,
};

interface MatchStatsPopupProps {
  hit: SearchHit;
  // When true (the pad has an open popup AND it is a match), drop the
  // pole + sign to very low opacity so they don't compete with the
  // focused pad's action popup for attention.
  faded?: boolean;
}

// Non-interactive "sign on a pole" above the lily pad. The 3D pole
// (thin neon cylinder) scales in height with `hit.score` — stronger
// matches flag themselves higher. The HTML chip sits at the pole's
// crown and tracks world position via drei's `<Html>`.
//
// `pointer-events: none` on both the drei wrapper and the inner panel,
// so clicks pass through to the pad below.
export function MatchStatsPopup({ hit, faded = false }: MatchStatsPopupProps) {
  const MatchIcon = MATCH_ICON[hit.matchType];
  const clampedScore = Math.max(0, Math.min(1, hit.score));
  const poleHeight =
    MIN_POLE_HEIGHT + clampedScore * (MAX_POLE_HEIGHT - MIN_POLE_HEIGHT);

  // Pole colouring
  //
  // The scene uses a Bloom post-process with `luminanceThreshold ≈ 0.2` —
  // any pixel above that threshold blooms brightly. In the default state
  // we rely on that: the cyan #00eeff pole (luminance ≈ 0.68 linear) is
  // picked up by Bloom and glows like a neon tube.
  //
  // In the faded state, simply dropping `material.opacity` is NOT enough:
  // the Bloom pass samples the raw material colour, not the composited
  // alpha, so the pole keeps emitting a bright halo even at low opacity.
  // The only way to make it visually recede is to swap the COLOUR for a
  // dim cyan whose luminance sits below the Bloom threshold. `#003a40`
  // (luminance ≈ 0.05 linear) stays a perceptible dark-cyan line but
  // does not contribute to the bloom pass at all.
  const POLE_COLOUR_BRIGHT = '#00eeff';
  const POLE_COLOUR_FADED = '#003a40';

  return (
    <group>
      <mesh position={[0, poleHeight / 2, 0]}>
        <cylinderGeometry args={[0.018, 0.018, poleHeight, 8]} />
        <meshBasicMaterial
          color={faded ? POLE_COLOUR_FADED : POLE_COLOUR_BRIGHT}
          toneMapped={!faded}
        />
      </mesh>

      {/* Sign — HTML chip perched on top of the pole. The inner
          positioner shifts the chip fully above the anchor so its
          bottom edge sits right at the pole's crown. */}
      <Html
        position={[0, poleHeight, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div
          className={
            faded
              ? 'match-stats-popup__positioner match-stats-popup__positioner--faded'
              : 'match-stats-popup__positioner'
          }
        >
          <div
            className="match-stats-popup"
            role="status"
            aria-label={`match score ${hit.score.toFixed(2)}, ${hit.matchType}`}
          >
            <span className="match-stats-popup__row">
              <span className="match-stats-popup__icon">
                <ScoreIcon />
              </span>
              <span className="match-stats-popup__value">
                {hit.score.toFixed(2)}
              </span>
            </span>
            <span className="match-stats-popup__row">
              <span className="match-stats-popup__icon">
                <MatchIcon />
              </span>
              <span className="match-stats-popup__value">{hit.matchType}</span>
            </span>
          </div>
        </div>
      </Html>
    </group>
  );
}
