/**
 * Story 6.3 — NeonDateTimePicker smoke tests.
 *
 * The picker is mostly visual; these tests cover the behavioural
 * surface: month navigation, day selection, time inputs, save/clear
 * dispatch, Escape-to-cancel.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { NeonDateTimePicker } from './NeonDateTimePicker';

describe('NeonDateTimePicker', () => {
  it('renders the seeded month and selected day', () => {
    render(
      <NeonDateTimePicker
        value="2026-05-15T10:30:00+00:00"
        onSave={vi.fn()}
        onClear={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/May 2026/)).toBeDefined();
    // Selected cell exposes aria-pressed=true.
    const selected = screen.getAllByRole('button', { pressed: true });
    expect(selected.length).toBeGreaterThan(0);
  });

  it('next/prev month buttons navigate the header', () => {
    render(
      <NeonDateTimePicker
        value="2026-05-15T10:30:00+00:00"
        onSave={vi.fn()}
        onClear={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Next month'));
    expect(screen.getByText(/June 2026/)).toBeDefined();
    fireEvent.click(screen.getByLabelText('Previous month'));
    expect(screen.getByText(/May 2026/)).toBeDefined();
  });

  it('Save dispatches the picked datetime as ISO string', () => {
    const onSave = vi.fn();
    render(
      <NeonDateTimePicker
        value="2026-05-15T10:30:00+00:00"
        onSave={onSave}
        onClear={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledTimes(1);
    const iso = onSave.mock.calls[0][0] as string;
    // Should look like an ISO datetime with timezone offset.
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it('Clear dispatches onClear', () => {
    const onClear = vi.fn();
    render(
      <NeonDateTimePicker
        value="2026-05-15T10:30:00+00:00"
        onSave={vi.fn()}
        onClear={onClear}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Clear'));
    expect(onClear).toHaveBeenCalled();
  });

  it('Escape key fires onCancel', () => {
    const onCancel = vi.fn();
    render(
      <NeonDateTimePicker
        value={null}
        onSave={vi.fn()}
        onClear={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('null seed value defaults to a sensible upcoming date', () => {
    // Null seeds to "next hour, on the hour" — the header should
    // render whatever month that resolves to. The picker portals into
    // document.body, so we query the document instead of the
    // test-rendered container.
    render(
      <NeonDateTimePicker
        value={null}
        onSave={vi.fn()}
        onClear={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      document.body.querySelector('.neon-dtp__month-label'),
    ).not.toBeNull();
  });

  it('clicking the backdrop fires onCancel', () => {
    const onCancel = vi.fn();
    render(
      <NeonDateTimePicker
        value={null}
        onSave={vi.fn()}
        onClear={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const backdrop = document.body.querySelector(
      '.neon-dtp-backdrop',
    ) as HTMLElement | null;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onCancel).toHaveBeenCalled();
  });

  it('clicking inside the panel does NOT fire onCancel', () => {
    const onCancel = vi.fn();
    render(
      <NeonDateTimePicker
        value={null}
        onSave={vi.fn()}
        onClear={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByLabelText('Next month'));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
