/**
 * NeonTooltip — drop-in replacement for the browser's native `title=`
 * attribute, styled with the project's neon-cyan chrome.
 *
 * Usage:
 *
 *   <NeonTooltip text="jump to this pad">
 *     <button>...</button>
 *   </NeonTooltip>
 *
 * The wrapper renders an extra `<span>` around the trigger; the
 * tooltip itself is portalled to `document.body` so it isn't clipped
 * by any `overflow: hidden` ancestor (e.g. the InfoPopup container)
 * and isn't trapped in a stacking context (e.g. a parent with its
 * own `z-index`). Position is computed at show-time from the
 * trigger's `getBoundingClientRect()` and clamped to the viewport so
 * tooltips near the edge don't overflow off-screen.
 *
 * Show/hide is opacity-driven so the transition stays consistent
 * with the rest of the neon UI.
 *
 * Falls back gracefully on touch devices: pointer events that never
 * land in `pointerenter`/`pointerleave` (e.g. tap-and-release on iOS)
 * leave the tooltip hidden but the click still fires normally.
 */

import {
  Children,
  cloneElement,
  isValidElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import './NeonTooltip.css';

export type NeonTooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

interface Props {
  text: string;
  /** Single React element. Receives `aria-describedby` + pointer/focus
   *  handlers via cloneElement so the existing handlers on the trigger
   *  still run. */
  children: ReactNode;
  placement?: NeonTooltipPlacement;
  /** Suppress the tooltip without removing the wrapper (useful for
   *  the disabled case where we don't want a hint that nothing will
   *  happen). */
  disabled?: boolean;
  /** Extra classes for the outer `<span>` wrapper. Use this when the
   *  trigger relied on flex sizing or other layout from its parent —
   *  e.g. a `flex: 1` button now needs the wrapper to grow, not the
   *  button (which sizes to its intrinsic width inside the wrapper). */
  wrapperClassName?: string;
}

interface ChildHandlers {
  onPointerEnter?: (e: React.PointerEvent) => void;
  onPointerLeave?: (e: React.PointerEvent) => void;
  onFocus?: (e: React.FocusEvent) => void;
  onBlur?: (e: React.FocusEvent) => void;
  'aria-describedby'?: string;
}

const VIEWPORT_MARGIN = 4; // px breathing room from window edges
const TRIGGER_GAP = 6; // px gap between the trigger and the tooltip

interface ComputedPosition {
  top: number;
  left: number;
  /** The placement actually used after edge-clamping — may differ
   *  from the requested placement if the tooltip would have
   *  overflowed. */
  resolvedPlacement: NeonTooltipPlacement;
}

function computePosition(
  triggerRect: DOMRect,
  tooltipRect: DOMRect,
  preferred: NeonTooltipPlacement,
): ComputedPosition {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tw = tooltipRect.width;
  const th = tooltipRect.height;

  // Default coords by placement.
  let top = 0;
  let left = 0;
  let resolvedPlacement = preferred;

  const placeTop = () => {
    top = triggerRect.top - th - TRIGGER_GAP;
    left = triggerRect.left + triggerRect.width / 2 - tw / 2;
    resolvedPlacement = 'top';
  };
  const placeBottom = () => {
    top = triggerRect.bottom + TRIGGER_GAP;
    left = triggerRect.left + triggerRect.width / 2 - tw / 2;
    resolvedPlacement = 'bottom';
  };
  const placeLeft = () => {
    top = triggerRect.top + triggerRect.height / 2 - th / 2;
    left = triggerRect.left - tw - TRIGGER_GAP;
    resolvedPlacement = 'left';
  };
  const placeRight = () => {
    top = triggerRect.top + triggerRect.height / 2 - th / 2;
    left = triggerRect.right + TRIGGER_GAP;
    resolvedPlacement = 'right';
  };

  if (preferred === 'top') placeTop();
  else if (preferred === 'bottom') placeBottom();
  else if (preferred === 'left') placeLeft();
  else placeRight();

  // Flip if the chosen placement overflows the opposite axis.
  if (resolvedPlacement === 'top' && top < VIEWPORT_MARGIN) placeBottom();
  else if (
    resolvedPlacement === 'bottom' &&
    top + th > vh - VIEWPORT_MARGIN
  )
    placeTop();
  else if (resolvedPlacement === 'left' && left < VIEWPORT_MARGIN) placeRight();
  else if (
    resolvedPlacement === 'right' &&
    left + tw > vw - VIEWPORT_MARGIN
  )
    placeLeft();

  // Clamp horizontally / vertically into the viewport so the tooltip
  // never reads as cut off, even if both placements would overflow
  // (very narrow viewports).
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - tw - VIEWPORT_MARGIN));
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - th - VIEWPORT_MARGIN));

  return { top, left, resolvedPlacement };
}

export function NeonTooltip({
  text,
  children,
  placement = 'top',
  disabled = false,
  wrapperClassName,
}: Props) {
  // Story 6.2 Group C CR P1: ALL hooks must run before any
  // conditional return. The previous shape called `useState` /
  // `useId` / `useRef` BEFORE the validity early-return but
  // `useCallback` / `useLayoutEffect` / `useEffect` AFTER it — a
  // child swapping from a valid element to a non-element on a
  // re-render would mismatch React's hook count and crash with
  // "Rendered fewer hooks than expected".
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const triggerWrapRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<ComputedPosition | null>(null);

  const show = useCallback(() => {
    if (disabled) return;
    setOpen(true);
  }, [disabled]);
  const hide = useCallback(() => setOpen(false), []);

  // Group C CR P11: equality-guarded setPosition. The recompute
  // effect fires on every scroll / resize event and previously
  // called `setPosition(newPos)` unconditionally. With a
  // capture-phase scroll listener firing on every nested scroll
  // container — and inertial scroll producing many sub-pixel
  // updates per frame — that would push React into a tight render
  // loop. Skip the update if the new position is identical.
  const updatePosition = useCallback(
    (next: ComputedPosition) => {
      setPosition((prev) => {
        if (
          prev &&
          prev.top === next.top &&
          prev.left === next.left &&
          prev.resolvedPlacement === next.resolvedPlacement
        ) {
          return prev;
        }
        return next;
      });
    },
    [],
  );

  // Compute position whenever the tooltip is shown. useLayoutEffect so
  // the first paint already has the correct `top`/`left` — otherwise
  // the tooltip would flash at 0,0 for one frame before snapping into
  // place.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerWrapRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;
    updatePosition(
      computePosition(
        trigger.getBoundingClientRect(),
        tooltip.getBoundingClientRect(),
        placement,
      ),
    );
  }, [open, placement, text, updatePosition]);

  // Recompute on viewport changes while open.
  useEffect(() => {
    if (!open) return;
    const recompute = () => {
      const trigger = triggerWrapRef.current;
      const tooltip = tooltipRef.current;
      if (!trigger || !tooltip) return;
      // Group C CR P9: bail to closed if the trigger has been
      // removed from the DOM mid-show. Without this, conditionally
      // rendering the trigger while `open=true` leaves an orphan
      // tooltip pinned to the last computed position with no
      // pointerLeave to dismiss it.
      if (!trigger.isConnected) {
        setOpen(false);
        return;
      }
      updatePosition(
        computePosition(
          trigger.getBoundingClientRect(),
          tooltip.getBoundingClientRect(),
          placement,
        ),
      );
    };
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
    };
  }, [open, placement, updatePosition]);

  const child = Children.only(children);
  if (!isValidElement<ChildHandlers>(child)) {
    // Not a valid element — render the children verbatim, no tooltip.
    return <>{children}</>;
  }

  const childProps = child.props as ChildHandlers;
  const enhanced = cloneElement<ChildHandlers>(child as ReactElement<ChildHandlers>, {
    'aria-describedby': open ? tooltipId : undefined,
    onPointerEnter: (e: React.PointerEvent) => {
      childProps.onPointerEnter?.(e);
      show();
    },
    onPointerLeave: (e: React.PointerEvent) => {
      childProps.onPointerLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      childProps.onFocus?.(e);
      show();
    },
    onBlur: (e: React.FocusEvent) => {
      childProps.onBlur?.(e);
      hide();
    },
  });

  const wrapClass = ['neon-tooltip-wrap', wrapperClassName]
    .filter(Boolean)
    .join(' ');

  // Tooltip lives in a portal at document.body so an `overflow:
  // hidden` ancestor (e.g. the InfoPopup container) can't clip it,
  // and so it sits in its own stacking context above everything else
  // (the inline z-index defeats the cursor canvas's
  // `--z-cursor: 2147483647` only when fully opaque — we keep it
  // below the cursor by setting z-index to a high but lower value).
  const tooltipStyle: CSSProperties = position
    ? { top: position.top, left: position.left }
    : {
        // Pre-position render: place at top-left out of view but
        // measurable so getBoundingClientRect returns real
        // dimensions on the first useLayoutEffect.
        top: 0,
        left: 0,
        visibility: 'hidden',
      };

  const resolvedPlacement = position?.resolvedPlacement ?? placement;

  return (
    <>
      <span ref={triggerWrapRef} className={wrapClass}>
        {enhanced}
      </span>
      {createPortal(
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className={[
            'neon-tooltip',
            `neon-tooltip--${resolvedPlacement}`,
            open ? 'neon-tooltip--open' : null,
          ]
            .filter(Boolean)
            .join(' ')}
          style={tooltipStyle}
          aria-hidden={!open}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
