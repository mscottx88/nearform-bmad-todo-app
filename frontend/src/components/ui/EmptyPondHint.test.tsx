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

  it('renders shortcut instructions for Enter and /', () => {
    render(<EmptyPondHint />);
    const shortcuts = screen.getByLabelText('keyboard shortcuts');
    expect(shortcuts).toHaveTextContent(/Press\s*Enter\s*to create your first task/i);
    expect(shortcuts).toHaveTextContent(/Press\s*\/\s*to use a slash command/i);
  });
});
