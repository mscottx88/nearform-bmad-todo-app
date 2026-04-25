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
 * The wrapper renders an extra `<span>` around the trigger and a
 * positioned tooltip element that's only mounted while the trigger is
 * hovered or focus-visible. Show/hide are pure CSS (`opacity` +
 * `pointer-events`) so the timing is consistent with the rest of the
 * neon UI's transitions.
 *
 * Falls back gracefully on touch devices: pointer events that never
 * land in `pointerenter`/`pointerleave` (e.g. tap-and-release on iOS)
 * leave the tooltip hidden but the click still fires normally.
 */

import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useId,
  useState,
} from 'react';
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

export function NeonTooltip({
  text,
  children,
  placement = 'top',
  disabled = false,
  wrapperClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  const child = Children.only(children);
  if (!isValidElement<ChildHandlers>(child)) {
    // Not a valid element — render the children verbatim, no tooltip.
    return <>{children}</>;
  }

  const show = useCallback(() => {
    if (disabled) return;
    setOpen(true);
  }, [disabled]);
  const hide = useCallback(() => setOpen(false), []);

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

  return (
    <span className={wrapClass}>
      {enhanced}
      <span
        id={tooltipId}
        role="tooltip"
        className={[
          'neon-tooltip',
          `neon-tooltip--${placement}`,
          open ? 'neon-tooltip--open' : null,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {text}
      </span>
    </span>
  );
}
