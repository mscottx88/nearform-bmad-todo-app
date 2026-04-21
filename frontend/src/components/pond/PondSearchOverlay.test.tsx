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
    });
  });

  it('renders the typed query when search is active', () => {
    usePondStore.setState({ searchQuery: 'hello', searchActive: true });
    render(<PondSearchOverlay />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('applies the --active class when search is active (opacity=1 via CSS)', () => {
    usePondStore.setState({ searchQuery: 'hello', searchActive: true });
    const { container } = render(<PondSearchOverlay />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('pond-search-overlay--active');
  });

  it('omits the --active class when search is inactive (opacity=0 via CSS transition)', () => {
    const { container } = render(<PondSearchOverlay />);
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
    const { rerender } = render(<PondSearchOverlay />);
    expect(screen.getByText('semantic search offline')).toBeInTheDocument();

    // Flip the flag and verify the badge disappears.
    usePondStore.setState({ vectorSearchUnavailable: false });
    rerender(<PondSearchOverlay />);
    expect(screen.queryByText('semantic search offline')).not.toBeInTheDocument();
  });

  it('does not render the badge when search is inactive, even if the flag is set', () => {
    usePondStore.setState({
      searchQuery: '',
      searchActive: false,
      vectorSearchUnavailable: true,
    });
    render(<PondSearchOverlay />);
    expect(screen.queryByText('semantic search offline')).not.toBeInTheDocument();
  });
});
