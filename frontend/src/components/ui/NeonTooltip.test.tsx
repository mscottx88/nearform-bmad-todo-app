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
});
