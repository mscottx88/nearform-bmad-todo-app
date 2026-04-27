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

type MockTodo = { id: string; text: string; dueDate?: string | null };
const useTodosMock = vi.fn(
  () => ({ data: [] as MockTodo[] }) as { data: MockTodo[] | undefined; isLoading?: boolean },
);

vi.mock('../../api/todoApi', () => ({
  useUpdateTodo: () => useUpdateTodoMock(),
  useTodos: () => useTodosMock(),
}));

const sendMessage = vi.fn();
const storeMessagesRef: { current: { role: 'user' | 'assistant'; content: string }[] } =
  { current: [] };
vi.mock('../../stores/useAgentStore', () => ({
  useAgentStore: {
    // The renderer reads `messages` to recover the user's original
    // prompt for candidate-chip clicks; expose it via the ref so each
    // test can seed its own conversation history.
    getState: () => ({ sendMessage, messages: storeMessagesRef.current }),
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
    storeMessagesRef.current = [];
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
    // The renderer disables Accept when the live todo is missing from
    // useTodos (treats it as "deleted/completed since proposal"); seed
    // a matching live todo so Accept stays enabled.
    useTodosMock.mockReturnValue({
      data: [{ id: 'todo-1', text: 'old', dueDate: null }],
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

  it('renders candidate chips and re-fires rephrase with the user\'s prompt on click', () => {
    // CR: the chip dispatch now reuses the user's most recent prompt
    // instead of a hardcoded "rephrase this", so a follow-up like
    // "make it about staging not prod" survives the disambiguation.
    storeMessagesRef.current = [
      { role: 'user', content: 'rephrase the dashboard task' },
    ];
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
    expect(sendMessage).toHaveBeenCalledWith('rephrase the dashboard task', {
      todoIds: ['todo-a'],
      skill: 'rephrase',
    });
  });

  it('chip dispatch falls back to "rephrase this" when no user message in history', () => {
    // Edge case: panel just opened, no messages yet — chip click
    // shouldn't crash and shouldn't send an empty string.
    storeMessagesRef.current = [];
    render(
      <RephraseProposal
        payload={{
          suggestions: [],
          missing_fields: [],
          candidates: [{ id: 'todo-a', text: 'Some task' }],
        }}
        targets={[]}
      />,
    );
    fireEvent.click(screen.getByText('Some task'));
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
      data: [{ id: 'todo-1', text: 'totally different text now', dueDate: null }],
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

  it('due_date staleness: same instant in different ISO formats is NOT stale', () => {
    // CR: ISO strings can differ byte-for-byte for the same instant
    // ("+00:00" vs "Z", trailing microseconds, etc.). The staleness
    // check now goes through Date.getTime() so format drift doesn't
    // flag every due_date suggestion as stale.
    useTodosMock.mockReturnValue({
      data: [
        {
          id: 'todo-1',
          text: 'x',
          dueDate: '2026-05-01T17:00:00Z',
        },
      ],
    });
    render(
      <RephraseProposal
        payload={{
          suggestions: [
            {
              field: 'due_date',
              original: '2026-05-01T17:00:00+00:00',
              revised: '2026-05-02T17:00:00+00:00',
              reason: 'push by a day',
            },
          ],
          missing_fields: [],
        }}
        targets={['todo-1']}
      />,
    );
    expect(screen.queryByText('[stale]')).toBeNull();
    expect((screen.getByLabelText('Accept rewrite') as HTMLButtonElement).disabled).toBe(false);
  });

  it('due_date staleness: live deadline differs in instant — flagged stale', () => {
    useTodosMock.mockReturnValue({
      data: [
        {
          id: 'todo-1',
          text: 'x',
          dueDate: '2026-06-15T09:00:00+00:00',
        },
      ],
    });
    render(
      <RephraseProposal
        payload={{
          suggestions: [
            {
              field: 'due_date',
              original: '2026-05-01T17:00:00+00:00',
              revised: '2026-05-02T17:00:00+00:00',
              reason: 'push',
            },
          ],
          missing_fields: [],
        }}
        targets={['todo-1']}
      />,
    );
    expect(screen.getByText('[stale]')).toBeDefined();
  });

  it('renders "(none)" placeholder when original is empty (setting due_date for the first time)', () => {
    useTodosMock.mockReturnValue({
      data: [{ id: 'todo-1', text: 'x', dueDate: null }],
    });
    render(
      <RephraseProposal
        payload={{
          suggestions: [
            {
              field: 'due_date',
              original: '',
              revised: '2026-05-01T17:00:00+00:00',
              reason: 'add a deadline',
            },
          ],
          missing_fields: [],
        }}
        targets={['todo-1']}
      />,
    );
    expect(screen.getByText('(none)')).toBeDefined();
  });

  it('disables Accept and shows "todo no longer exists" when targetId is missing from useTodos cache', () => {
    // CR: useTodos returns active rows only; once query is settled
    // and the target id isn't present, the underlying todo was
    // deleted/completed since proposal generation.
    useTodosMock.mockReturnValue({
      data: [{ id: 'other-todo', text: 'unrelated', dueDate: null }],
    });
    render(
      <RephraseProposal
        payload={{
          suggestions: [
            { field: 'text', original: 'old', revised: 'new', reason: 'better' },
          ],
          missing_fields: [],
        }}
        targets={['todo-gone']}
      />,
    );
    expect(screen.getByText('[todo no longer exists]')).toBeDefined();
    expect((screen.getByLabelText('Accept rewrite') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables Accept while useTodos is still loading', () => {
    useTodosMock.mockReturnValue({ data: undefined, isLoading: true });
    render(
      <RephraseProposal
        payload={{
          suggestions: [
            { field: 'text', original: 'old', revised: 'new', reason: 'better' },
          ],
          missing_fields: [],
        }}
        targets={['todo-1']}
      />,
    );
    expect((screen.getByLabelText('Accept rewrite') as HTMLButtonElement).disabled).toBe(true);
  });
});
