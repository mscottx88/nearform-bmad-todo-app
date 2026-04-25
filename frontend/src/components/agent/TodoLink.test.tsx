import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { TodoLink } from './TodoLink';
import { usePondStore } from '../../stores/usePondStore';
import { useWorldStore } from '../../stores/useWorldStore';

const UUID = '3f9a2b1c-1234-4567-89ab-cdef01234567';

function seedWorld(id: string, x: number, y: number) {
  useWorldStore.setState({
    worldMetadata: new Map([
      [
        id,
        {
          positionX: x,
          positionY: y,
          rotationY: 0,
          driftSeed: 1,
          velocityX: 0,
          velocityZ: 0,
          lastUpdatedLocalMs: 0,
          lastSavedAtMs: 0,
        },
      ],
    ]),
  });
}

function clearWorld() {
  useWorldStore.setState({ worldMetadata: new Map() });
}

describe('TodoLink', () => {
  beforeEach(() => {
    usePondStore.setState({
      hoveredTodoId: null,
      activePopupTodoId: null,
      cameraFocus: null,
      cursorMode: 'firefly',
    });
    clearWorld();
  });

  it('hovering swaps the firefly cursor to the pointing-finger mode', () => {
    seedWorld(UUID, 4, 7);
    const { container } = render(<TodoLink label="milk" todoId={UUID} />);
    const btn = container.querySelector('button.todo-link') as HTMLButtonElement;
    expect(usePondStore.getState().cursorMode).toBe('firefly');
    fireEvent.pointerEnter(btn);
    expect(usePondStore.getState().cursorMode).toBe('point');
    fireEvent.pointerLeave(btn);
    expect(usePondStore.getState().cursorMode).toBe('firefly');
  });

  it('hovering sets the pond store hoveredTodoId', () => {
    seedWorld(UUID, 4, 7);
    const { container } = render(<TodoLink label="milk" todoId={UUID} />);
    const btn = container.querySelector('button.todo-link') as HTMLButtonElement;
    fireEvent.pointerEnter(btn);
    expect(usePondStore.getState().hoveredTodoId).toBe(UUID);
  });

  it('leaving the link clears the hoveredTodoId IF we set it', () => {
    seedWorld(UUID, 4, 7);
    const { container } = render(<TodoLink label="milk" todoId={UUID} />);
    const btn = container.querySelector('button.todo-link') as HTMLButtonElement;
    fireEvent.pointerEnter(btn);
    fireEvent.pointerLeave(btn);
    expect(usePondStore.getState().hoveredTodoId).toBeNull();
  });

  it('leaving does NOT clear hoveredTodoId if it has been replaced', () => {
    seedWorld(UUID, 4, 7);
    const { container } = render(<TodoLink label="milk" todoId={UUID} />);
    const btn = container.querySelector('button.todo-link') as HTMLButtonElement;
    fireEvent.pointerEnter(btn);
    // Simulate the user moving onto a real pad in the scene mid-leave.
    usePondStore.setState({ hoveredTodoId: 'other-id' });
    fireEvent.pointerLeave(btn);
    expect(usePondStore.getState().hoveredTodoId).toBe('other-id');
  });

  it('clicking calls openPopup with the todo position from useWorldStore', () => {
    seedWorld(UUID, 4.2, 7.8);
    const { container } = render(<TodoLink label="milk" todoId={UUID} />);
    const btn = container.querySelector('button.todo-link') as HTMLButtonElement;
    fireEvent.click(btn);
    const state = usePondStore.getState();
    expect(state.activePopupTodoId).toBe(UUID);
    expect(state.cameraFocus).not.toBeNull();
    expect(state.cameraFocus?.x).toBe(4.2);
    expect(state.cameraFocus?.z).toBe(7.8);
  });

  it('renders in missing state when the todo is not loaded in the world store', () => {
    // No seed → the world entry is undefined.
    const { container } = render(<TodoLink label="missing" todoId={UUID} />);
    const btn = container.querySelector('button.todo-link') as HTMLButtonElement;
    expect(btn.className).toContain('todo-link--missing');
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    // Click is a no-op for missing — nothing happens.
    expect(usePondStore.getState().activePopupTodoId).toBeNull();
  });

  it('does not openPopup while the todo is mid-completion', () => {
    seedWorld(UUID, 4, 7);
    usePondStore.setState({
      completingTodos: new Map([
        [
          UUID,
          {
            todo: { id: UUID } as never,
            creatureType: 'frog',
            rarity: 'common',
            startedAt: 0,
          },
        ],
      ]),
    });
    const { container } = render(<TodoLink label="milk" todoId={UUID} />);
    const btn = container.querySelector('button.todo-link') as HTMLButtonElement;
    act(() => {
      fireEvent.click(btn);
    });
    expect(usePondStore.getState().activePopupTodoId).toBeNull();
  });
});
