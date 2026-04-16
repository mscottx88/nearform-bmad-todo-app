import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PopupActionButton } from './PopupActionButton';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children: React.ReactNode }) => <div data-testid="html">{children}</div>,
  Line: () => <div data-testid="line" />,
}));

describe('PopupActionButton', () => {
  it('renders the label', () => {
    const { getByText } = render(<PopupActionButton label="Complete" onClick={() => {}} />);
    expect(getByText('Complete')).toBeInTheDocument();
  });

  it('applies the color to the label text-shadow', () => {
    const { getByText } = render(
      <PopupActionButton label="Group" onClick={() => {}} color="#ffd700" />,
    );
    const span = getByText('Group');
    expect(span.getAttribute('style')).toContain('#ffd700');
  });

  it('fires onClick when the group is clicked', () => {
    const onClick = vi.fn();
    const { container } = render(<PopupActionButton label="Go" onClick={onClick} />);
    const group = container.querySelector('group');
    expect(group).toBeTruthy();
    if (group) fireEvent.click(group);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('uses cyan as the default color', () => {
    const { getByText } = render(<PopupActionButton label="Default" onClick={() => {}} />);
    const span = getByText('Default');
    expect(span.getAttribute('style')).toContain('#00eeff');
  });
});
