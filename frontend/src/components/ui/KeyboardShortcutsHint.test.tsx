import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeyboardShortcutsHint } from './KeyboardShortcutsHint';

describe('KeyboardShortcutsHint', () => {
  it('renders the F1 → agent help affordance (Story 6.2)', () => {
    render(<KeyboardShortcutsHint />);
    const list = screen.getByRole('list', { name: 'keys' });
    expect(list).toHaveTextContent(/F1/);
    expect(list).toHaveTextContent(/agent help/);
  });

  it('renders the Enter and / shortcuts inherited from Story 3.3', () => {
    render(<KeyboardShortcutsHint />);
    const list = screen.getByRole('list', { name: 'keys' });
    expect(list).toHaveTextContent(/Enter/);
    expect(list).toHaveTextContent(/new task/);
    expect(list).toHaveTextContent(/slash command/);
  });

  it('renders the Escape and double-Escape camera-reset hints', () => {
    render(<KeyboardShortcutsHint />);
    const list = screen.getByRole('list', { name: 'keys' });
    expect(list).toHaveTextContent(/Esc/);
    expect(list).toHaveTextContent(/reset camera/);
  });

  it('renders mouse-affordance hints (click, drag, right-drag, wheel)', () => {
    render(<KeyboardShortcutsHint />);
    const mouseList = screen.getByRole('list', { name: 'mouse' });
    expect(mouseList).toHaveTextContent(/click/);
    expect(mouseList).toHaveTextContent(/drag/);
    expect(mouseList).toHaveTextContent(/right-drag/);
    expect(mouseList).toHaveTextContent(/wheel/);
  });

  it('groups hints under labelled sections so screen readers announce context', () => {
    render(<KeyboardShortcutsHint />);
    expect(screen.getByText('keys')).toBeInTheDocument();
    expect(screen.getByText('mouse')).toBeInTheDocument();
  });
});
