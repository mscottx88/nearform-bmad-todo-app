import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TodoInput } from './TodoInput';

vi.mock('../../api/todoApi', () => ({
  useCreateTodo: () => ({ mutate: vi.fn() }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('TodoInput', () => {
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
});
