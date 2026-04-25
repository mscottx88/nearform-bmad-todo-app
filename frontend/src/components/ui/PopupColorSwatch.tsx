import { useEffect } from 'react';
import { NeonTooltip } from './NeonTooltip';
import './PopupColorSwatch.css';

// Locked neon palette (12 hues). Arbitrary hex picks would produce
// muddy pads that break the pond's visual coherence; we trade off
// free-form color for the "neon aquarium" aesthetic. All 12 hues are
// maximally saturated in sRGB — the EffectComposer's Bloom pass at
// luminanceThreshold 0.2 picks them up into a bright feathered glow.
//
// Ordered as ROYGBIV + line-of-purples. Pink is a non-spectral
// colour — it has no natural position inside the rainbow — but on
// a closed colour wheel the non-spectral arc runs from violet back
// to red via magenta and pink. So the full forward sweep is:
//   red → orange → gold → yellow → chartreuse → green → lily →
//   cyan → electric blue → violet → magenta → hot pink (closes
//   back toward red).
// Adjacent swatches read as adjacent hues rather than a random
// scatter.
export const NEON_SWATCHES: ReadonlyArray<{ color: string; name: string }> = [
  { color: '#ff0040', name: 'neon red' },
  { color: '#ff6600', name: 'neon orange' },
  { color: '#ffd700', name: 'neon gold' },
  { color: '#ffff00', name: 'neon yellow' },
  { color: '#aaff00', name: 'neon chartreuse' },
  { color: '#39ff14', name: 'neon green' },
  // Original lily-pad default color — kept in the palette under its
  // own name so users can restore "the default" from the swatch grid
  // without having to remember its hex.
  { color: '#00ff88', name: 'neon lily' },
  { color: '#00eeff', name: 'neon cyan' },
  { color: '#00aaff', name: 'neon electric blue' },
  { color: '#aa00ff', name: 'neon violet' },
  { color: '#ff00ff', name: 'neon magenta' },
  { color: '#ff1493', name: 'neon hot pink' },
];

interface PopupColorSwatchProps {
  /** The pad's currently-committed color. Swatches matching this hex
   *  are visually marked with an extra ring so the user can see at a
   *  glance "this is my current choice." Case-insensitive comparison. */
  committedColor: string;
  onHover: (color: string | null) => void;
  onCommit: (color: string) => void;
  onCollapse: () => void;
}

export function PopupColorSwatch({
  committedColor,
  onHover,
  onCommit,
  onCollapse,
}: PopupColorSwatchProps) {
  const committedLower = committedColor.toLowerCase();
  // Escape dismisses the sub-panel (AC #4, AC #8). Mounted in the
  // CAPTURE phase with `stopImmediatePropagation` because the app-
  // level `useClosePopupOnEscape` also listens window-scope for
  // Escape and would otherwise close the whole popup on the same
  // keypress. Capture-phase listeners fire before bubble-phase ones
  // on the same target, so ours runs first and suppresses the
  // App-level handler — sub-panel collapses, popup stays open.
  // Cleanup removes the listener on unmount.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onCollapse();
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () =>
      window.removeEventListener('keydown', handler, { capture: true });
  }, [onCollapse]);

  return (
    <div className="action-popup__color-swatches">
      {NEON_SWATCHES.map(({ color, name }) => {
        const isCurrent = color.toLowerCase() === committedLower;
        const label = isCurrent ? `${name} · current` : name;
        return (
          <NeonTooltip key={color} text={label} placement="top">
            <button
              type="button"
              // `--current` modifier draws an extra white ring so the
              // user sees their committed choice at a glance. Screen
              // readers get the same cue via aria-pressed.
              className={
                isCurrent
                  ? 'action-popup__color-swatch action-popup__color-swatch--current'
                  : 'action-popup__color-swatch'
              }
              aria-label={`Set color to ${name}`}
              aria-pressed={isCurrent}
              // Per-swatch inline style: background fills the circle,
              // `color` (= currentColor) drives the CSS border, glow, and
              // focus-visible outline accents — matches the popup button
              // language.
              style={{ backgroundColor: color, color }}
              onMouseEnter={() => onHover(color)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onCommit(color)}
            />
          </NeonTooltip>
        );
      })}
    </div>
  );
}
