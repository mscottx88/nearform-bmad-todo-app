/**
 * Story 6.3 — RephraseProposal renderer tests.
 *
 * Mocks `useTodos` + `useUpdateTodo` from `../../api/todoApi` so the
 * tests don't need a real React Query client. Empty-render branch,
 * suggestion blocks, accept/dismiss interactions, missing-field copy,
 * and the staleness check are all covered.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mutate = vi.fn();
const useUpdateTodoMock = vi.fn(() => ({
  mutate,
}));

const useTodosMock = vi.fn(() => ({
  data: [] as { id: string; text: string }[],
}));

vi.mock('../../api/todoApi', () => ({
  useUpdateTodo: () => useUpdateTodoMock(),
  useTodos: () => useTodosMock(),
}));

const sendMessage = vi.fn();
vi.mock('../../stores/useAgentStore', () => ({
  useAgentStore: {
    getState: () => ({ sendMessage }),
  },
}));

import { RephraseProposal } from './RephraseProposal';

describe('RephraseProposal', () => {
  beforeEach(() => {
    mutate.mockReset();
    useUpdateTodoMock.mockReset();
    useUpdateTodoMock.mockReturnValue({ mutate });
    useTodosMock.mockReset();
    useTodosMock.mockReturnValue({ data: [] });
    sendMessage.mockReset();
  });

  it('renders nothing when both suggestions and missing_fields are empty', () => {
    const { container } = render(
      <RephraseProposal
        payload={{ suggestions: [], missing_fields: [] }}
        targets={['todo-1']}
      />,
    );
    expect(container.firstElementChild).toBeNull();
  });

  it('renders one block per suggestion with original / arrow / revised / reason', () => {
    render(
      <RephraseProposal
        payload={{
          suggestions: [
            {
              field: 'text',
              original: 'buy bread',
              revised: 'Buy bread before Friday',
              reason: 'Adds a deadline',
            },
            {
              field: 'text',
              original: 'fix bug',
              revised: 'Fix login bug in QA env',
              reason: 'Specifies scope',
            },
          ],
          missing_fields: [],
        }}
        targets={['todo-1']}
      />,
    );
    expect(screen.getAllByText(/Buy bread before Friday/)).toHaveLength(1);
    expect(screen.getAllByText(/Fix login bug in QA env/)).toHaveLength(1);
    expect(screen.getAllByText(/Adds a deadline/)).toHaveLength(1);
    expect(screen.getAllByText(/Specifies scope/)).toHaveLength(1);
    // Both blocks render an arrow glyph.
    expect(screen.getAllByText('→')).toHaveLength(2);
  });

  it('clicking Accept fires useUpdateTodo().mutate({ id, [field]: revised })', () => {
    render(
      <RephraseProposal
        payload={{
          suggestions: [
            {
              field: 'text',
              original: 'old',
              revised: 'new',
              reason: 'better',
            },
          ],
          missing_fields: [],
        }}
        targets={['todo-1']}
      />,
    );
    fireEvent.click(screen.getByLabelText('Accept rewrite'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(
      { id: 'todo-1', text: 'new' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('clicking Dismiss does NOT fire mutate; both buttons disable after dismiss', () => {
    render(
      <RephraseProposal
        payload={{
          suggestions: [
            {
              field: 'text',
              original: 'old',
              revised: 'new',
              reason: 'better',
            },
          ],
          missing_fields: [],
        }}
        targets={['todo-1']}
      />,
    );
    fireEvent.click(screen.getByLabelText('Dismiss rewrite'));
    expect(mutate).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Accept rewrite') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Dismiss rewrite') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the literal copy for known missing fields (due_date)', () => {
    render(
      <RephraseProposal
        payload={{ suggestions: [], missing_fields: ['due_date'] }}
        targets={['todo-1']}
      />,
    );
    expect(
      screen.getByText(/Consider adding a due date — no deadline mentioned/),
    ).toBeDefined();
  });

  it('falls back to a generated copy for unknown missing fields', () => {
    render(
      <RephraseProposal
        payload={{ suggestions: [], missing_fields: ['priority_level'] }}
        targets={['todo-1']}
      />,
    );
    expect(screen.getByText(/Consider adding priority level/)).toBeDefined();
  });

  it('renders candidate chips and re-fires rephrase with the chosen id on click', () => {
    render(
      <RephraseProposal
        payload={{
          suggestions: [],
          missing_fields: [],
          candidates: [
            { id: 'todo-a', text: 'Dashboard refactor' },
            { id: 'todo-b', text: 'Update dashboard tests' },
          ],
        }}
        targets={[]}
      />,
    );
    expect(screen.getByText(/Pick a todo/)).toBeDefined();
    fireEvent.click(screen.getByText('Dashboard refactor'));
    expect(sendMessage).toHaveBeenCalledWith('rephrase this', {
      todoIds: ['todo-a'],
      skill: 'rephrase',
    });
  });

  it('renders nothing when suggestions / missing / candidates are all empty', () => {
    const { container } = render(
      <RephraseProposal
        payload={{ suggestions: [], missing_fields: [], candidates: [] }}
        targets={[]}
      />,
    );
    expect(container.firstElementChild).toBeNull();
  });

  it('shows [stale] chip and disables Accept when live todo text drifted from original', () => {
    useTodosMock.mockReturnValue({
      data: [{ id: 'todo-1', text: 'totally different text now' }],
    });
    render(
      <RephraseProposal
        payload={{
          suggestions: [
            {
              field: 'text',
              original: 'old',
              revised: 'new',
              reason: 'better',
            },
          ],
          missing_fields: [],
        }}
        targets={['todo-1']}
      />,
    );
    expect(screen.getByText('[stale]')).toBeDefined();
    expect((screen.getByLabelText('Accept rewrite') as HTMLButtonElement).disabled).toBe(true);
  });
});
