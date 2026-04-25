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

  // Story 6.2 Group C CR (post-feedback): ↑/↓ is composer-ONLY
  // affordance — the composer's own focus-only hint band announces
  // it. The global footer must NOT include it (would imply app-
  // wide history nav).
  it('does NOT render ↑/↓ in the global footer (composer-only)', () => {
    render(<KeyboardShortcutsHint />);
    const list = screen.getByRole('list', { name: 'keys' });
    expect(list).not.toHaveTextContent(/↑/);
    expect(list).not.toHaveTextContent(/↓/);
    expect(list).not.toHaveTextContent(/chat history/);
  });

  // Story 6.2 Group C CR P12: chord notation renders as separate
  // <kbd> elements with an aria-label on the wrapping <li>, so
  // screen readers don't announce "Esc dot Esc" verbatim.
  it('renders the Esc·Esc chord as separate <kbd> elements with aria-label', () => {
    render(<KeyboardShortcutsHint />);
    const escEscRow = screen.getByLabelText('Escape twice — reset camera');
    expect(escEscRow).toBeInTheDocument();
    // Two <kbd> elements inside (one per Esc).
    const kbds = escEscRow.querySelectorAll('kbd');
    expect(kbds).toHaveLength(2);
    expect(kbds[0]?.textContent).toBe('Esc');
    expect(kbds[1]?.textContent).toBe('Esc');
  });
});
