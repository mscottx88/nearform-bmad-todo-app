import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EmptyPondHint } from './EmptyPondHint';

vi.mock('@react-three/drei', () => ({
  Html: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div data-testid="drei-html" style={style}>{children}</div>
  ),
}));

describe('EmptyPondHint', () => {
  it('renders the hero hint text', () => {
    render(<EmptyPondHint />);
    expect(screen.getByLabelText('just start typing...')).toBeInTheDocument();
  });

  it('does NOT render the keyboard shortcuts (those moved to KeyboardShortcutsHint)', () => {
    render(<EmptyPondHint />);
    // The shortcut list used to live here under aria-label="keyboard shortcuts".
    // It moved to the always-visible KeyboardShortcutsHint component so
    // users with existing todos can see them too.
    expect(screen.queryByLabelText(/keyboard shortcuts/i)).toBeNull();
  });
});
