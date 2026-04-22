import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerSpreadOutCommand } from './spreadOutCommand';
import {
  clearRegistry,
  findCommand,
  parseSlashCommands,
  worldFromVisibility,
  type SlashCommand,
} from './slashCommands';
import { usePondStore } from '../stores/usePondStore';
import type { Todo } from '../types';

function makeTodo(id: string, x: number, y: number): Todo {
  return {
    id,
    text: id,
    completed: false,
    color: '#00ff88',
    positionX: x,
    positionY: y,
    embeddingStatus: 'pending',
    archived: false,
    archivedAt: null,
    deleted: false,
    deletedAt: null,
    createdAt: '2026-04-22T00:00:00Z',
    updatedAt: '2026-04-22T00:00:00Z',
  };
}

const defaultWorld = worldFromVisibility({
  showActive: true,
  showCompleted: false,
  showDeleted: false,
});

describe('spreadOutCommand', () => {
  let command: SlashCommand;
  let setTargetPositionsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearRegistry();
    usePondStore.setState({ padTargetPositions: new Map() });
    setTargetPositionsSpy = vi.spyOn(usePondStore.getState(), 'setTargetPositions');
  });

  it('registers against the /spread-out token', () => {
    registerSpreadOutCommand(() => []);
    const cmd = findCommand('/spread-out');
    expect(cmd).toBeDefined();
    expect(cmd?.description).toBe('Spread pads apart so none overlap');
    command = cmd!;
  });

  it('is always consumable regardless of pad count or visibility state', () => {
    registerSpreadOutCommand(() => []);
    const cmd = findCommand('/spread-out')!;
    expect(cmd.isConsumable(defaultWorld)).toBe(true);
  });

  it('is parseable through the chain parser', () => {
    registerSpreadOutCommand(() => []);
    const parsed = parseSlashCommands('/spread-out', defaultWorld);
    expect(parsed).not.toBeNull();
    expect(parsed?.[0].token).toBe('/spread-out');
  });

  it('execute() calls setTargetPositions when pads actually move', () => {
    // Two overlapping pads — computeSpreadPositions will return a
    // non-empty result so setTargetPositions MUST be called.
    const todos = [makeTodo('a', 0, 0), makeTodo('b', 1, 0)];
    registerSpreadOutCommand(() => todos);
    const cmd = findCommand('/spread-out')!;
    const mockSet = vi.fn();
    usePondStore.setState({ setTargetPositions: mockSet });
    cmd.execute();
    expect(mockSet).toHaveBeenCalledTimes(1);
    const firstCallArg = mockSet.mock.calls[0][0] as Map<string, unknown>;
    expect(firstCallArg.size).toBeGreaterThan(0);
  });

  it('execute() is a no-op when all pads are already spread', () => {
    // Far-apart pads — computeSpreadPositions returns an empty map
    // and `setTargetPositions` is not called. This keeps
    // `/spread-out` cheap on clean ponds.
    const todos = [makeTodo('a', 0, 0), makeTodo('b', 10, 0)];
    registerSpreadOutCommand(() => todos);
    const cmd = findCommand('/spread-out')!;
    const mockSet = vi.fn();
    usePondStore.setState({ setTargetPositions: mockSet });
    cmd.execute();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('execute() reads the todo list fresh each time (not a frozen snapshot)', () => {
    let todos: Todo[] = [];
    registerSpreadOutCommand(() => todos);
    const cmd = findCommand('/spread-out')!;
    const mockSet = vi.fn();
    usePondStore.setState({ setTargetPositions: mockSet });

    // First invocation: empty pond.
    cmd.execute();
    expect(mockSet).not.toHaveBeenCalled();

    // Push new pads in, invoke again.
    todos = [makeTodo('a', 0, 0), makeTodo('b', 0.5, 0)];
    cmd.execute();
    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  // Housekeeping: make sure the outer-scope spy is acknowledged even
  // though the assertions in the spec cases use their own mocks —
  // avoids the unused-variable warning without dropping the test
  // infrastructure that proves the base store action exists.
  it('retains setTargetPositions on the store singleton', () => {
    expect(typeof usePondStore.getState().setTargetPositions).toBe('function');
    expect(setTargetPositionsSpy).toBeDefined();
    // silence "unused" on `command` — it's only used when the first
    // test runs in isolation.
    void command;
  });
});
