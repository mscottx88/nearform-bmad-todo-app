import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { NeonTooltip } from './NeonTooltip';

describe('NeonTooltip', () => {
  it('renders the tooltip text in the DOM (hidden by default)', () => {
    render(
      <NeonTooltip text="jump to this pad">
        <button type="button">link</button>
      </NeonTooltip>,
    );
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip.textContent).toBe('jump to this pad');
    // Default state has no `--open` modifier — opacity 0 / pointer-
    // events: none keep it from being visible or clickable.
    expect(tooltip.className).not.toContain('neon-tooltip--open');
  });

  it('opens the tooltip on pointerEnter and closes on pointerLeave', () => {
    render(
      <NeonTooltip text="hello">
        <button type="button">trigger</button>
      </NeonTooltip>,
    );
    const trigger = screen.getByRole('button');
    fireEvent.pointerEnter(trigger);
    expect(screen.getByRole('tooltip').className).toContain('neon-tooltip--open');
    fireEvent.pointerLeave(trigger);
    expect(screen.getByRole('tooltip', { hidden: true }).className).not.toContain(
      'neon-tooltip--open',
    );
  });

  it('opens on focus and closes on blur (keyboard accessibility)', () => {
    render(
      <NeonTooltip text="hello">
        <button type="button">trigger</button>
      </NeonTooltip>,
    );
    const trigger = screen.getByRole('button');
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip').className).toContain('neon-tooltip--open');
    fireEvent.blur(trigger);
    expect(screen.getByRole('tooltip', { hidden: true }).className).not.toContain(
      'neon-tooltip--open',
    );
  });

  it('does NOT open while disabled is true', () => {
    render(
      <NeonTooltip text="hidden" disabled>
        <button type="button">trigger</button>
      </NeonTooltip>,
    );
    const trigger = screen.getByRole('button');
    fireEvent.pointerEnter(trigger);
    expect(screen.getByRole('tooltip', { hidden: true }).className).not.toContain(
      'neon-tooltip--open',
    );
  });

  it('preserves the trigger\'s own pointer/focus handlers', () => {
    const onEnter = vi.fn();
    const onLeave = vi.fn();
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    render(
      <NeonTooltip text="hello">
        <button
          type="button"
          onPointerEnter={onEnter}
          onPointerLeave={onLeave}
          onFocus={onFocus}
          onBlur={onBlur}
        >
          trigger
        </button>
      </NeonTooltip>,
    );
    const trigger = screen.getByRole('button');
    fireEvent.pointerEnter(trigger);
    fireEvent.pointerLeave(trigger);
    fireEvent.focus(trigger);
    fireEvent.blur(trigger);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('honours the placement prop on the tooltip className', () => {
    const { rerender } = render(
      <NeonTooltip text="hi" placement="bottom">
        <button type="button">trigger</button>
      </NeonTooltip>,
    );
    expect(screen.getByRole('tooltip', { hidden: true }).className).toContain(
      'neon-tooltip--bottom',
    );
    rerender(
      <NeonTooltip text="hi" placement="left">
        <button type="button">trigger</button>
      </NeonTooltip>,
    );
    expect(screen.getByRole('tooltip', { hidden: true }).className).toContain(
      'neon-tooltip--left',
    );
  });

  // 2026-04-26 fix: when the trigger sits inside an `overflow: auto`
  // ancestor (e.g. NeonScrollbar) and the user scrolls the trigger
  // out of the visible window, the tooltip's positioning math used
  // the trigger's full bounding rect — including the scrolled-away
  // portion — which placed the tooltip far from the cursor. The
  // visible-rect intersection now collapses to zero in that case
  // and the tooltip closes itself rather than floating in the wrong
  // place.
  it('closes itself when the trigger has been scrolled out of a clipping ancestor', () => {
    const { container } = render(
      <div
        data-testid="scroll-parent"
        style={{ overflow: 'auto', height: 100 }}
      >
        <NeonTooltip text="hello">
          <button type="button">trigger</button>
        </NeonTooltip>
      </div>,
    );

    // The tooltip uses the wrapping `<span class="neon-tooltip-wrap">`
    // for positioning, NOT the inner button — clone overrides for
    // both so the visible-rect intersection has consistent inputs.
    const wrap = container.querySelector('.neon-tooltip-wrap')!;
    const scrollParent = container.querySelector(
      '[data-testid="scroll-parent"]',
    )!;
    // Trigger wrap geometry: positioned at y=-200..-170 — i.e. fully
    // above the scroll-parent's visible 0..100 window. Real geometry
    // (width/height > 0) so the bail-on-zero-area branch fires for
    // the right reason.
    vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(50, -200, 100, 30),
    );
    vi.spyOn(scrollParent, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 200, 100),
    );

    const trigger = screen.getByRole('button');
    fireEvent.pointerEnter(trigger);
    // Tooltip should NOT be in the open state — the visible portion
    // of the trigger collapses to zero (trigger bottom -170 < parent
    // top 0), so we suppress.
    expect(
      screen.getByRole('tooltip', { hidden: true }).className,
    ).not.toContain('neon-tooltip--open');
  });
});
