import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { useState } from 'react';
import { TodoInput } from './TodoInput';
import { usePondStore } from '../../stores/usePondStore';
import { clearRegistry } from '../../utils/slashCommands';
import { registerVisibilityCommands } from '../../utils/visibilityCommands';

const createMutate = vi.fn();

vi.mock('../../api/todoApi', () => ({
  useCreateTodo: () => ({ mutate: createMutate }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

function resetStore() {
  usePondStore.setState({
    showActive: true,
    showCompleted: false,
    showDeleted: false,
    cameraFocus: null,
  });
}

describe('TodoInput', () => {
  beforeEach(() => {
    createMutate.mockReset();
    resetStore();
    clearRegistry();
    registerVisibilityCommands();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Pre-3.3 baseline smoke tests.
  it('renders nothing when closed', () => {
    renderWithQuery(<TodoInput isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByPlaceholderText("what's on your mind...")).not.toBeInTheDocument();
  });

  it('renders input when open', () => {
    renderWithQuery(<TodoInput isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText("what's on your mind...")).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    renderWithQuery(<TodoInput isOpen={true} onClose={onClose} />);
    const input = screen.getByPlaceholderText("what's on your mind...");
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  // Story 3.3 tests ─────────────────────────────────────────────────
  describe('controlled value + initialValue seed (AC #10)', () => {
    it('empty initialValue seeds an empty value', () => {
      renderWithQuery(<TodoInput isOpen={true} onClose={() => {}} />);
      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input.value).toBe('');
    });

    it('initialValue="/" seeds the controlled value with "/"', () => {
      renderWithQuery(<TodoInput isOpen={true} initialValue="/" onClose={() => {}} />);
      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input.value).toBe('/');
    });

    it('re-seeds value when isOpen flips false → true', () => {
      function Harness() {
        const [open, setOpen] = useState(false);
        const [initial, setInitial] = useState('');
        return (
          <>
            <button
              onClick={() => {
                setInitial('/');
                setOpen(true);
              }}
            >
              open-slash
            </button>
            <TodoInput isOpen={open} initialValue={initial} onClose={() => setOpen(false)} />
          </>
        );
      }
      renderWithQuery(<Harness />);
      fireEvent.click(screen.getByText('open-slash'));
      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input.value).toBe('/');
    });
  });

  describe('dropdown visibility gate (AC #1, #3)', () => {
    it('renders the dropdown when the input is empty (dim-on-open)', () => {
      renderWithQuery(<TodoInput isOpen={true} onClose={() => {}} />);
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('renders the dropdown when the input starts with "/"', () => {
      renderWithQuery(<TodoInput isOpen={true} initialValue="/" onClose={() => {}} />);
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('DOES NOT render the dropdown when input has plain text', () => {
      renderWithQuery(<TodoInput isOpen={true} onClose={() => {}} />);
      const input = screen.getByRole('textbox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'buy milk' } });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('dropdown re-appears after clearing text back to empty', () => {
      renderWithQuery(<TodoInput isOpen={true} onClose={() => {}} />);
      const input = screen.getByRole('textbox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'abc' } });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      fireEvent.change(input, { target: { value: '' } });
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
  });

  describe('slash-command dispatch on Enter (AC #4)', () => {
    it('/show-completed dispatches setVisibility and does NOT call createTodo', () => {
      const onClose = vi.fn();
      renderWithQuery(<TodoInput isOpen={true} onClose={onClose} />);
      const input = screen.getByRole('textbox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '/show-completed' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(usePondStore.getState().showCompleted).toBe(true);
      expect(createMutate).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('chained /show-completed /show-deleted dispatches both', () => {
      renderWithQuery(<TodoInput isOpen={true} onClose={() => {}} />);
      const input = screen.getByRole('textbox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '/show-completed /show-deleted' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(usePondStore.getState().showCompleted).toBe(true);
      expect(usePondStore.getState().showDeleted).toBe(true);
      expect(createMutate).not.toHaveBeenCalled();
    });

    it('trailing space on a single command still dispatches (Tab artifact)', () => {
      renderWithQuery(<TodoInput isOpen={true} onClose={() => {}} />);
      const input = screen.getByRole('textbox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '/show-completed ' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(usePondStore.getState().showCompleted).toBe(true);
    });

    it('plain text Enter creates a todo via mutation', async () => {
      renderWithQuery(<TodoInput isOpen={true} onClose={() => {}} />);
      const input = screen.getByRole('textbox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'buy milk' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });
      expect(createMutate).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'buy milk' }),
      );
    });

    it('invalid /xyz falls through to todo-create with "/xyz" as text', async () => {
      renderWithQuery(<TodoInput isOpen={true} onClose={() => {}} />);
      const input = screen.getByRole('textbox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '/xyz' } });
      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });
      expect(createMutate).toHaveBeenCalledWith(
        expect.objectContaining({ text: '/xyz' }),
      );
    });
  });

  describe('autocomplete navigation + filtering (AC #2, #9)', () => {
    it('initial highlight is index 0', () => {
      renderWithQuery(<TodoInput isOpen={true} initialValue="/" onClose={() => {}} />);
      const items = screen.getAllByRole('option');
      expect(items[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('ArrowDown moves highlight to next item, ArrowUp wraps', () => {
      renderWithQuery(<TodoInput isOpen={true} initialValue="/" onClose={() => {}} />);
      const input = screen.getByRole('textbox') as HTMLInputElement;
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      let items = screen.getAllByRole('option');
      expect(items[1]).toHaveAttribute('aria-selected', 'true');

      // ArrowUp from index 1 → index 0.
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      items = screen.getAllByRole('option');
      expect(items[0]).toHaveAttribute('aria-selected', 'true');

      // ArrowUp from 0 wraps to last.
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      items = screen.getAllByRole('option');
      expect(items[items.length - 1]).toHaveAttribute('aria-selected', 'true');
    });

    it('Tab completes the current fragment to the highlighted token + trailing space', () => {
      renderWithQuery(<TodoInput isOpen={true} initialValue="/hide" onClose={() => {}} />);
      const input = screen.getByRole('textbox') as HTMLInputElement;
      // With default visibility (showActive=true), /hide- narrows to
      // /hide-active (the only /hide-* consumable command + /hide-all).
      fireEvent.keyDown(input, { key: 'Tab' });
      // Highlight index 0 — first /hide-* match.
      expect(input.value.startsWith('/hide-')).toBe(true);
      expect(input.value.endsWith(' ')).toBe(true);
    });

    it('prefix filter /hid narrows to /hide-* options only', () => {
      usePondStore.setState({
        showActive: true,
        showCompleted: true,
        showDeleted: true,
      });
      renderWithQuery(<TodoInput isOpen={true} initialValue="/hid" onClose={() => {}} />);
      const items = screen.getAllByRole('option');
      const tokens = items.map(
        (li) => li.querySelector('.todo-input-dropdown__token')?.textContent,
      );
      for (const t of tokens) expect(t).toMatch(/^\/hide-/);
    });
  });

  describe('mid-chain virtual-world preview (AC #9)', () => {
    it('after /show-completed + space, /show-completed disappears from options', () => {
      renderWithQuery(
        <TodoInput isOpen={true} initialValue="/show-completed " onClose={() => {}} />,
      );
      const items = screen.getAllByRole('option');
      const tokens = items.map(
        (li) => li.querySelector('.todo-input-dropdown__token')?.textContent,
      );
      expect(tokens).not.toContain('/show-completed');
      expect(tokens).toContain('/hide-completed');
    });
  });
});
