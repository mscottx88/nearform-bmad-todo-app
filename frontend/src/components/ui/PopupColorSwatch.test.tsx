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

  it('swatches are native <button> elements (AC #8 keyboard Enter/Space activation)', () => {
    // Real browsers synthesize a `click` event when Enter or Space is
    // pressed on a focused <button type="button"> — this is spec
    // behavior of `HTMLButtonElement`, not something the component
    // implements explicitly. happy-dom does not synthesize the click
    // in its keyboard path, so the cleanest proof that keyboard
    // activation works is two assertions together:
    //   (a) the swatches render as HTMLButtonElement with type="button"
    //       (this test);
    //   (b) click → onCommit with the right hex (the test below).
    // Together they guarantee Enter/Space → click → onCommit in a
    // real browser. If either falls over (swatch rewritten as a
    // <div>, onClick changed to mouse-only), one of these fails.
    render(
      <PopupColorSwatch
        committedColor="#00ff88"
        onHover={() => {}}
        onCommit={() => {}}
        onCollapse={() => {}}
      />,
    );
    for (const { name } of NEON_SWATCHES) {
      const swatch = screen.getByLabelText(`Set color to ${name}`);
      expect(swatch.tagName).toBe('BUTTON');
      expect(swatch.getAttribute('type')).toBe('button');
    }
  });

  it('click on a swatch fires onCommit with the correct hex (AC #8 activation payload)', () => {
    const onCommit = vi.fn();
    render(
      <PopupColorSwatch
        committedColor="#00ff88"
        onHover={() => {}}
        onCommit={onCommit}
        onCollapse={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('Set color to neon cyan'));
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

  it('NEON_SWATCHES is the 12-hue rainbow-ordered palette (pink immediately after red, wraps backward through the cool side)', () => {
    expect(NEON_SWATCHES.map((s) => s.color)).toEqual([
      // Warm start, pink adjacent to red per the 2026-04-23 reorder.
      '#ff0040', // neon red
      '#ff1493', // neon hot pink
      '#ff00ff', // neon magenta
      '#aa00ff', // neon violet
      '#00aaff', // neon electric blue
      '#00eeff', // neon cyan
      '#00ff88', // neon lily — pond's default lily-pad green
      '#39ff14', // neon green
      '#aaff00', // neon chartreuse
      '#ffff00', // neon yellow
      '#ffd700', // neon gold
      '#ff6600', // neon orange
    ]);
  });
});
