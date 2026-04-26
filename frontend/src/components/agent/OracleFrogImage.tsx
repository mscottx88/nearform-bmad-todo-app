/**
 * Story 6.7: Oracle Frog as a bitmap image with subtle glitch FX.
 *
 * The frog itself is a static image — drop a Budgett's-frog PNG
 * into `frontend/public/oracle-frog.png` and it'll be served at
 * the `/oracle-frog.png` URL Vite resolves automatically.
 *
 * The "techie" feel is layered on via CSS:
 *   - a subtle constant scanline overlay (the panel's CRT vibe);
 *   - a faint hue-rotate cycle on the image itself so the colour
 *     palette breathes;
 *   - an occasional RGB-channel tear / shift, driven by stacking
 *     three tinted copies of the image with `mix-blend-mode:
 *     screen` and a keyframe that nudges them apart for a few
 *     frames every ~3-5 seconds;
 *   - state-driven intensity bumps on `error` (heavy glitch), and
 *     on each `chunk` arrival during 'speaking' (a one-shot
 *     glitch flash via React `key` remount on the FX layer).
 *
 * The state-machine animations from earlier iterations (idle
 * breathe / listening lean / thinking transform / success hop /
 * error shake) all still apply — they're keyed off the
 * `data-state` attribute on the wrapper.
 */

import { useEffect, useState } from 'react';
import { useAgentStore } from '../../stores/useAgentStore';
import './OracleFrogImage.css';

// Resolved at build/serve time — Vite re-writes `/oracle-frog.png`
// to a fingerprinted asset URL. If you swap the file, just put
// the new PNG at `frontend/public/oracle-frog.png` (no code
// change needed).
const FROG_IMAGE_SRC = '/oracle-frog.png';

export function OracleFrogImage() {
  const agentState = useAgentStore((s) => s.agentState);
  // Each chunk arrival bumps `chunkTick` so the FX layer's
  // single-shot keyframe re-runs (via React `key` remount). Same
  // pattern the earlier SVG used for the throat-sac pulse.
  const [chunkTick, setChunkTick] = useState(0);

  useEffect(() => {
    let lastLen = useAgentStore.getState().streamingBuffer.length;
    const unsub = useAgentStore.subscribe((state) => {
      const len = state.streamingBuffer.length;
      if (len > lastLen) setChunkTick((n) => n + 1);
      lastLen = len;
    });
    return unsub;
  }, []);

  return (
    <div className="oracle-frog" data-state={agentState}>
      {/* Three stacked image copies for the RGB-split glitch
          effect. Each is the SAME bitmap, but coloured via
          `filter: ...` to a single channel and offset by a few
          px during a glitch event. The base copy renders fully
          coloured; the red / blue copies sit on top with
          mix-blend-mode so they only "show" their channel. */}
      <img
        className="oracle-frog__layer oracle-frog__layer--base"
        src={FROG_IMAGE_SRC}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
      <img
        className="oracle-frog__layer oracle-frog__layer--red"
        src={FROG_IMAGE_SRC}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
      <img
        className="oracle-frog__layer oracle-frog__layer--cyan"
        src={FROG_IMAGE_SRC}
        alt=""
        aria-hidden="true"
        draggable={false}
      />

      {/* Scanline overlay — repeating-linear-gradient via CSS so
          this is a free single layer. */}
      <div className="oracle-frog__scanlines" aria-hidden="true" />

      {/* Per-chunk one-shot glitch flash — re-mounted on each
          chunk so the keyframe restarts cleanly. */}
      <div
        key={`chunk-fx-${chunkTick}`}
        className="oracle-frog__chunk-fx"
        aria-hidden="true"
      />

      {/* Tear-bar — occasional horizontal "scan tear" that slides
          across the frog. Pure CSS keyframe on infinite loop. */}
      <div className="oracle-frog__tear" aria-hidden="true" />
    </div>
  );
}
