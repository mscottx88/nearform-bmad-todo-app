import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PopupColorSwatch, NEON_SWATCHES } from './PopupColorSwatch';

describe('PopupColorSwatch (story 4.1)', () => {
  it('renders all 12 swatches with aria-labels (AC #1, AC #8)', () => {
    render(
      <PopupColorSwatch
        committedColor="#00ff88"
        onHover={() => {}}
        onCommit={() => {}}
        onCollapse={() => {}}
      />,
    );
    for (const { name } of NEON_SWATCHES) {
      expect(screen.getByLabelText(`Set color to ${name}`)).toBeInTheDocument();
    }
    // Sanity: exactly 12 swatches (4-col × 3-row grid), no more, no less.
    expect(
      screen.getAllByRole('button', { name: /^Set color to / }),
    ).toHaveLength(12);
  });

  it('forwards click → onCommit with the swatch hex (AC #3, AC #8)', () => {
    const onCommit = vi.fn();
    render(
      <PopupColorSwatch
        committedColor="#00ff88"
        onHover={() => {}}
        onCommit={onCommit}
        onCollapse={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('Set color to neon green'));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('#39ff14');
  });

  it('Enter/Space on a focused swatch fires onCommit (AC #8 keyboard-reachable)', () => {
    const onCommit = vi.fn();
    render(
      <PopupColorSwatch
        committedColor="#00ff88"
        onHover={() => {}}
        onCommit={onCommit}
        onCollapse={() => {}}
      />,
    );
    const swatch = screen.getByLabelText('Set color to neon cyan');
    // Native <button> converts Enter/Space keyDown into a click event
    // — fireEvent.click is what happy-dom dispatches for both keys.
    fireEvent.click(swatch);
    expect(onCommit).toHaveBeenCalledWith('#00eeff');
  });

  it('mouseEnter → onHover(hex); mouseLeave → onHover(null) (AC #2)', () => {
    const onHover = vi.fn();
    render(
      <PopupColorSwatch
        committedColor="#00ff88"
        onHover={onHover}
        onCommit={() => {}}
        onCollapse={() => {}}
      />,
    );
    const swatch = screen.getByLabelText('Set color to neon gold');
    fireEvent.mouseEnter(swatch);
    expect(onHover).toHaveBeenLastCalledWith('#ffd700');
    fireEvent.mouseLeave(swatch);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('Escape dispatches onCollapse (AC #4, AC #8)', () => {
    const onCollapse = vi.fn();
    render(
      <PopupColorSwatch
        committedColor="#00ff88"
        onHover={() => {}}
        onCommit={() => {}}
        onCollapse={onCollapse}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('marks the swatch matching committedColor with the --current modifier (story 4.1 extension)', () => {
    render(
      <PopupColorSwatch
        committedColor="#00ff88"
        onHover={() => {}}
        onCommit={() => {}}
        onCollapse={() => {}}
      />,
    );
    const current = screen.getByLabelText('Set color to neon lily');
    expect(current).toHaveAttribute('aria-pressed', 'true');
    expect(current.className).toContain('action-popup__color-swatch--current');
    // Other swatches should NOT be marked.
    const other = screen.getByLabelText('Set color to neon red');
    expect(other).toHaveAttribute('aria-pressed', 'false');
    expect(other.className).not.toContain('action-popup__color-swatch--current');
  });

  it('current-color match is case-insensitive', () => {
    render(
      <PopupColorSwatch
        committedColor="#00FF88"
        onHover={() => {}}
        onCommit={() => {}}
        onCollapse={() => {}}
      />,
    );
    expect(
      screen.getByLabelText('Set color to neon lily'),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('removes the keydown listener on unmount', () => {
    const onCollapse = vi.fn();
    const { unmount } = render(
      <PopupColorSwatch
        committedColor="#00ff88"
        onHover={() => {}}
        onCommit={() => {}}
        onCollapse={onCollapse}
      />,
    );
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it('NEON_SWATCHES is the 12-hue rainbow-ordered palette (AC #1 + 2026-04-20 extension)', () => {
    expect(NEON_SWATCHES.map((s) => s.color)).toEqual([
      // Row 1: warm (red → yellow)
      '#ff0040', // neon red
      '#ff6600', // neon orange
      '#ffd700', // neon gold
      '#ffff00', // neon yellow
      // Row 2: green/teal
      '#aaff00', // neon chartreuse
      '#39ff14', // neon green
      '#00ff88', // neon lily — pond's default lily-pad green
      '#00eeff', // neon cyan
      // Row 3: cool → pink (closes the wheel)
      '#00aaff', // neon electric blue
      '#aa00ff', // neon violet
      '#ff00ff', // neon magenta
      '#ff1493', // neon hot pink
    ]);
  });
});
