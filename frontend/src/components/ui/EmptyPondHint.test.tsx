import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EmptyPondHint } from './EmptyPondHint';

vi.mock('@react-three/drei', () => ({
  Html: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div data-testid="drei-html" style={style}>{children}</div>
  ),
}));

describe('EmptyPondHint', () => {
  it('renders the hint text', () => {
    render(<EmptyPondHint />);
    expect(screen.getByLabelText('just start typing...')).toBeInTheDocument();
  });
});
