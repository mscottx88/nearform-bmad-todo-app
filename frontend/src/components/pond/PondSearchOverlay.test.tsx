import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PondSearchOverlay } from './PondSearchOverlay';
import { usePondStore } from '../../stores/usePondStore';

describe('PondSearchOverlay', () => {
  beforeEach(() => {
    usePondStore.setState({
      searchQuery: '',
      searchActive: false,
      searchResults: new Map(),
      searchAllMatches: false,
      vectorSearchUnavailable: false,
      activePopupTodoId: null,
    });
  });

  it('renders the typed query when search is active', () => {
    usePondStore.setState({ searchQuery: 'hello', searchActive: true });
    render(<PondSearchOverlay hasVisiblePads={true} />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('applies the --active class when search is active (opacity=1 via CSS)', () => {
    usePondStore.setState({ searchQuery: 'hello', searchActive: true });
    const { container } = render(<PondSearchOverlay hasVisiblePads={true} />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('pond-search-overlay--active');
  });

  it('omits the --active class when search is inactive (opacity=0 via CSS transition)', () => {
    const { container } = render(<PondSearchOverlay hasVisiblePads={true} />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).not.toContain('pond-search-overlay--active');
    expect(root.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders the "semantic search offline" badge only when vectorSearchUnavailable is true', () => {
    usePondStore.setState({
      searchQuery: 'hello',
      searchActive: true,
      vectorSearchUnavailable: true,
    });
    const { rerender } = render(<PondSearchOverlay hasVisiblePads={true} />);
    expect(screen.getByText('semantic search offline')).toBeInTheDocument();

    // Flip the flag and verify the badge disappears.
    usePondStore.setState({ vectorSearchUnavailable: false });
    rerender(<PondSearchOverlay hasVisiblePads={true} />);
    expect(screen.queryByText('semantic search offline')).not.toBeInTheDocument();
  });

  it('does not render the badge when search is inactive, even if the flag is set', () => {
    usePondStore.setState({
      searchQuery: '',
      searchActive: false,
      vectorSearchUnavailable: true,
    });
    render(<PondSearchOverlay hasVisiblePads={true} />);
    expect(screen.queryByText('semantic search offline')).not.toBeInTheDocument();
  });

  it('shows "nothing to search" feedback when search is active but no pads are visible', () => {
    usePondStore.setState({ searchQuery: 'foo', searchActive: true });
    render(<PondSearchOverlay hasVisiblePads={false} />);
    expect(screen.getByText(/nothing to search/i)).toBeInTheDocument();
  });

  it('does NOT show "nothing to search" when pads are visible', () => {
    usePondStore.setState({ searchQuery: 'foo', searchActive: true });
    render(<PondSearchOverlay hasVisiblePads={true} />);
    expect(screen.queryByText(/nothing to search/i)).not.toBeInTheDocument();
  });

  it('does NOT show "nothing to search" when search is inactive', () => {
    usePondStore.setState({ searchQuery: '', searchActive: false });
    render(<PondSearchOverlay hasVisiblePads={false} />);
    expect(screen.queryByText(/nothing to search/i)).not.toBeInTheDocument();
  });

  it('applies --faded when a popup is open on a pad that is a search match', () => {
    const matchedId = 'todo-abc';
    usePondStore.setState({
      searchQuery: 'foo',
      searchActive: true,
      activePopupTodoId: matchedId,
      searchResults: new Map([
        [matchedId, { score: 0.9, matchType: 'hybrid' }],
      ]),
    });
    const { container } = render(<PondSearchOverlay hasVisiblePads={true} />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('pond-search-overlay--faded');
  });

  it('does NOT apply --faded when the focused pad has no search hit', () => {
    usePondStore.setState({
      searchQuery: 'foo',
      searchActive: true,
      activePopupTodoId: 'todo-xyz',
      searchResults: new Map([
        ['todo-other', { score: 0.5, matchType: 'keyword' }],
      ]),
    });
    const { container } = render(<PondSearchOverlay hasVisiblePads={true} />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).not.toContain('pond-search-overlay--faded');
  });

  it('does NOT apply --faded when no popup is open, even if the query matches pads', () => {
    usePondStore.setState({
      searchQuery: 'foo',
      searchActive: true,
      activePopupTodoId: null,
      searchResults: new Map([
        ['todo-abc', { score: 0.9, matchType: 'hybrid' }],
      ]),
    });
    const { container } = render(<PondSearchOverlay hasVisiblePads={true} />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).not.toContain('pond-search-overlay--faded');
  });
});
