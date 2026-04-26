import { describe, it, expect, beforeEach } from 'vitest';
import { registerSpreadOutCommand } from './spreadOutCommand';
import {
  clearRegistry,
  findCommand,
  parseSlashCommands,
  worldFromVisibility,
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
    rotationY: 0,
    driftSeed: 0,
    dueDate: null,
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
  beforeEach(() => {
    clearRegistry();
    usePondStore.setState({ padTargetPositions: new Map() });
  });

  it('registers against the /spread-out token', () => {
    registerSpreadOutCommand(() => []);
    const cmd = findCommand('/spread-out');
    expect(cmd).toBeDefined();
    expect(cmd?.description).toBe('Spread pads apart so none overlap');
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

  it('execute() populates padTargetPositions when pads actually move', () => {
    // Two overlapping pads — computeSpreadPositions will return a
    // non-empty result so `padTargetPositions` MUST be populated.
    // Asserts against the real store slice rather than a mock, so the
    // test exercises the full setTargetPositions → store state path.
    const todos = [makeTodo('a', 0, 0), makeTodo('b', 1, 0)];
    registerSpreadOutCommand(() => todos);
    const cmd = findCommand('/spread-out')!;
    cmd.execute();
    const targets = usePondStore.getState().padTargetPositions;
    expect(targets.size).toBeGreaterThan(0);
  });

  it('execute() is a no-op when all pads are already spread', () => {
    // Far-apart pads — computeSpreadPositions returns an empty map
    // and `padTargetPositions` stays empty. Keeps `/spread-out` cheap
    // on clean ponds.
    const todos = [makeTodo('a', 0, 0), makeTodo('b', 10, 0)];
    registerSpreadOutCommand(() => todos);
    const cmd = findCommand('/spread-out')!;
    cmd.execute();
    expect(usePondStore.getState().padTargetPositions.size).toBe(0);
  });

  it('execute() reads the todo list fresh each time (not a frozen snapshot)', () => {
    let todos: Todo[] = [];
    registerSpreadOutCommand(() => todos);
    const cmd = findCommand('/spread-out')!;

    // First invocation: empty pond — no targets populated.
    cmd.execute();
    expect(usePondStore.getState().padTargetPositions.size).toBe(0);

    // Push new overlapping pads in, invoke again.
    todos = [makeTodo('a', 0, 0), makeTodo('b', 0.5, 0)];
    cmd.execute();
    expect(usePondStore.getState().padTargetPositions.size).toBeGreaterThan(0);
  });

  it('exposes setTargetPositions on the store singleton', () => {
    expect(typeof usePondStore.getState().setTargetPositions).toBe('function');
  });
});
