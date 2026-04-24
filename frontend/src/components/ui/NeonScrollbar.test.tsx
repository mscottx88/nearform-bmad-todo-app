import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useState } from 'react';
import { NeonScrollbar } from './NeonScrollbar';

// jsdom lacks ResizeObserver / MutationObserver by default in some
// environments — stub just enough to let the useLayoutEffect body run.
class MockObserver {
  observe(): void { /* no-op */ }
  disconnect(): void { /* no-op */ }
}
(global as unknown as { ResizeObserver: typeof MockObserver }).ResizeObserver = MockObserver;
(global as unknown as { MutationObserver: typeof MockObserver }).MutationObserver = MockObserver;

describe('NeonScrollbar', () => {
  describe('mode selection', () => {
    it('wrap mode: renders an inner scrollable div containing children', () => {
      const { container, getByText } = render(
        <NeonScrollbar color="cyan">
          <div>wrapped content</div>
        </NeonScrollbar>,
      );
      expect(container.querySelector('.neon-scrollbar')).not.toBeNull();
      expect(container.querySelector('.neon-scrollbar-inner')).not.toBeNull();
      expect(container.querySelector('.neon-scrollbar--overlay')).toBeNull();
      expect(getByText('wrapped content')).toBeInTheDocument();
    });

    it('overlay mode: no inner wrapping div, adds --overlay modifier, still renders tracks + thumbs', () => {
      const { container } = render(<NeonScrollbar color="cyan" scrollElement={null} />);
      expect(container.querySelector('.neon-scrollbar')).not.toBeNull();
      expect(container.querySelector('.neon-scrollbar--overlay')).not.toBeNull();
      expect(container.querySelector('.neon-scrollbar-inner')).toBeNull();
      expect(container.querySelector('.nsb-track.nsb-track-y')).not.toBeNull();
      expect(container.querySelector('.nsb-track.nsb-track-x')).not.toBeNull();
      expect(container.querySelector('.nsb-thumb.nsb-thumb-y')).not.toBeNull();
      expect(container.querySelector('.nsb-thumb.nsb-thumb-x')).not.toBeNull();
      expect(container.querySelector('.nsb-corner')).not.toBeNull();
    });

    it('overlay mode: scrollElement={null} is the expected initial state (state-backed callback-ref pattern)', () => {
      // Consumer pattern: textareaEl starts as null via useState, then
      // flips to an HTMLTextAreaElement after the callback ref fires.
      // The component should handle the null state gracefully
      // (tracks rendered, effects early-return, no crash).
      const { container } = render(<NeonScrollbar scrollElement={null} />);
      expect(container.querySelector('.neon-scrollbar--overlay')).not.toBeNull();
    });

    it('overlay mode: ignores children (logs a dev-mode warning)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { container, queryByText } = render(
        <NeonScrollbar scrollElement={null}>
          <div>should not render</div>
        </NeonScrollbar>,
      );
      expect(queryByText('should not render')).toBeNull();
      expect(container.querySelector('.neon-scrollbar-inner')).toBeNull();
      // The `useEffect` invariant check warns on mount when both
      // `children` and `scrollElement` are provided.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/scrollElement.*children/),
      );
      warnSpy.mockRestore();
    });
  });

  describe('color variant', () => {
    it.each(['cyan', 'orange', 'gold', 'green', 'pink'] as const)(
      'sets data-color to %s so the CSS custom properties swap',
      (color) => {
        const { container } = render(
          <NeonScrollbar color={color}>
            <div>x</div>
          </NeonScrollbar>,
        );
        const outer = container.querySelector('.neon-scrollbar');
        expect(outer?.getAttribute('data-color')).toBe(color);
      },
    );

    it('defaults to cyan when color is omitted', () => {
      const { container } = render(
        <NeonScrollbar>
          <div>x</div>
        </NeonScrollbar>,
      );
      const outer = container.querySelector('.neon-scrollbar');
      expect(outer?.getAttribute('data-color')).toBe('cyan');
    });
  });

  describe('scrollRef forwarding', () => {
    it('wrap mode: scrollRef is populated with the inner div', () => {
      const scrollRef: { current: HTMLDivElement | null } = { current: null };
      render(
        <NeonScrollbar scrollRef={scrollRef}>
          <div>x</div>
        </NeonScrollbar>,
      );
      expect(scrollRef.current).not.toBeNull();
      expect(scrollRef.current?.classList.contains('neon-scrollbar-inner')).toBe(true);
    });

    it('overlay mode: scrollRef stays null (the consumer owns scrollElement)', () => {
      const scrollRef: { current: HTMLDivElement | null } = { current: null };
      render(<NeonScrollbar scrollRef={scrollRef} scrollElement={null} />);
      expect(scrollRef.current).toBeNull();
    });
  });

  describe('dev-mode invariant checks', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('warns when virtualYTotal is combined with scrollElement (mutually exclusive)', () => {
      render(
        <NeonScrollbar scrollElement={null} virtualYTotal={100} virtualYLoadedCount={20} />,
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/virtualYTotal.*scrollElement|scrollElement.*virtualYTotal/),
      );
    });

    it('does NOT warn when virtualYTotal is used in wrap mode (the intended combo)', () => {
      render(
        <NeonScrollbar virtualYTotal={100} virtualYLoadedCount={20}>
          <div>x</div>
        </NeonScrollbar>,
      );
      // May fire OTHER warnings for unrelated reasons, but not the
      // scrollElement+virtualYTotal one.
      const calls = warnSpy.mock.calls.flat();
      expect(
        calls.some((msg) => typeof msg === 'string' && /scrollElement/.test(msg)),
      ).toBe(false);
    });
  });

  describe('overlay mode with external element', () => {
    it('accepts a live HTMLElement via scrollElement and attaches scroll listener', () => {
      // State-backed pattern: parent wraps the scrollable in its own
      // layout + passes it as state to NeonScrollbar. The component
      // should re-run its effects when scrollElement transitions
      // null → element.
      function Host(): React.ReactElement {
        const [el, setEl] = useState<HTMLTextAreaElement | null>(null);
        return (
          <div style={{ position: 'relative', height: 100 }}>
            <textarea ref={setEl} data-testid="ta" defaultValue="abc" />
            <NeonScrollbar scrollElement={el} />
          </div>
        );
      }
      const { container, getByTestId } = render(<Host />);
      const ta = getByTestId('ta') as HTMLTextAreaElement;
      expect(ta).not.toBeNull();
      expect(container.querySelector('.neon-scrollbar--overlay')).not.toBeNull();
      // Scrolling the target shouldn't throw — listeners should be
      // attached against the textarea, not the (absent) inner div.
      expect(() => fireEvent.scroll(ta)).not.toThrow();
    });
  });

  describe('className / style pass-through', () => {
    it('appends caller className to the outer wrapper', () => {
      const { container } = render(
        <NeonScrollbar className="my-custom-class">
          <div>x</div>
        </NeonScrollbar>,
      );
      const outer = container.querySelector('.neon-scrollbar');
      expect(outer?.classList.contains('my-custom-class')).toBe(true);
    });

    it('applies inline style to the outer wrapper', () => {
      const { container } = render(
        <NeonScrollbar style={{ maxHeight: 200, zIndex: 5 }}>
          <div>x</div>
        </NeonScrollbar>,
      );
      const outer = container.querySelector<HTMLDivElement>('.neon-scrollbar');
      expect(outer?.style.maxHeight).toBe('200px');
      expect(outer?.style.zIndex).toBe('5');
    });
  });
});
