import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearRegistry,
  getRegistry,
  worldFromVisibility,
  type VisibilityState,
} from './slashCommands';
import {
  hideActive,
  hideAll,
  hideCompleted,
  hideDeleted,
  registerVisibilityCommands,
  showActive,
  showAll,
  showCompleted,
  showDeleted,
} from './visibilityCommands';
import { usePondStore } from '../stores/usePondStore';

function makeVis(overrides: Partial<VisibilityState> = {}): VisibilityState {
  return { showActive: true, showCompleted: false, showDeleted: false, ...overrides };
}

describe('visibilityCommands (story 3.3)', () => {
  beforeEach(() => {
    clearRegistry();
    usePondStore.setState({
      showActive: true,
      showCompleted: false,
      showDeleted: false,
    });
  });

  describe('registerVisibilityCommands ordering', () => {
    it('registers the 8 commands in stable dropdown order', () => {
      registerVisibilityCommands();
      const tokens = getRegistry().map((c) => c.token);
      expect(tokens).toEqual([
        '/show-active',
        '/hide-active',
        '/show-completed',
        '/hide-completed',
        '/show-deleted',
        '/hide-deleted',
        '/show-all',
        '/hide-all',
      ]);
    });
  });

  describe('showActive / hideActive', () => {
    it('showActive consumable iff showActive is false', () => {
      expect(showActive.isConsumable(worldFromVisibility(makeVis({ showActive: false })))).toBe(true);
      expect(showActive.isConsumable(worldFromVisibility(makeVis({ showActive: true })))).toBe(false);
    });

    it('hideActive consumable iff showActive is true', () => {
      expect(hideActive.isConsumable(worldFromVisibility(makeVis({ showActive: true })))).toBe(true);
      expect(hideActive.isConsumable(worldFromVisibility(makeVis({ showActive: false })))).toBe(false);
    });

    it('showActive projects showActive=true, leaves others alone', () => {
      const world = worldFromVisibility(makeVis({ showActive: false, showCompleted: true, showDeleted: true }));
      const next = showActive.project(world);
      expect(next.visibility).toEqual({ showActive: true, showCompleted: true, showDeleted: true });
    });

    it('showActive.execute writes { showActive: true } to the store', () => {
      usePondStore.setState({ showActive: false });
      showActive.execute();
      expect(usePondStore.getState().showActive).toBe(true);
      expect(usePondStore.getState().showCompleted).toBe(false);
    });

    it('hideActive.execute writes { showActive: false }', () => {
      usePondStore.setState({ showActive: true });
      hideActive.execute();
      expect(usePondStore.getState().showActive).toBe(false);
    });
  });

  describe('showCompleted / hideCompleted', () => {
    it('showCompleted consumable iff showCompleted is false', () => {
      expect(showCompleted.isConsumable(worldFromVisibility(makeVis({ showCompleted: false })))).toBe(true);
      expect(showCompleted.isConsumable(worldFromVisibility(makeVis({ showCompleted: true })))).toBe(false);
    });

    it('hideCompleted consumable iff showCompleted is true', () => {
      expect(hideCompleted.isConsumable(worldFromVisibility(makeVis({ showCompleted: true })))).toBe(true);
      expect(hideCompleted.isConsumable(worldFromVisibility(makeVis({ showCompleted: false })))).toBe(false);
    });

    it('showCompleted.execute sets showCompleted=true without touching others', () => {
      showCompleted.execute();
      const state = usePondStore.getState();
      expect(state.showActive).toBe(true);
      expect(state.showCompleted).toBe(true);
      expect(state.showDeleted).toBe(false);
    });
  });

  describe('showDeleted / hideDeleted', () => {
    it('showDeleted consumable iff showDeleted is false', () => {
      expect(showDeleted.isConsumable(worldFromVisibility(makeVis({ showDeleted: false })))).toBe(true);
      expect(showDeleted.isConsumable(worldFromVisibility(makeVis({ showDeleted: true })))).toBe(false);
    });

    it('hideDeleted consumable iff showDeleted is true', () => {
      expect(hideDeleted.isConsumable(worldFromVisibility(makeVis({ showDeleted: true })))).toBe(true);
      expect(hideDeleted.isConsumable(worldFromVisibility(makeVis({ showDeleted: false })))).toBe(false);
    });

    it('showDeleted.execute sets showDeleted=true only', () => {
      showDeleted.execute();
      const state = usePondStore.getState();
      expect(state.showDeleted).toBe(true);
      expect(state.showActive).toBe(true);
      expect(state.showCompleted).toBe(false);
    });
  });

  describe('showAll / hideAll', () => {
    it('showAll consumable when at least one flag is false', () => {
      expect(showAll.isConsumable(worldFromVisibility(makeVis()))).toBe(true);
      expect(
        showAll.isConsumable(
          worldFromVisibility({ showActive: true, showCompleted: true, showDeleted: true }),
        ),
      ).toBe(false);
    });

    it('hideAll consumable when at least one flag is true', () => {
      expect(hideAll.isConsumable(worldFromVisibility(makeVis()))).toBe(true);
      expect(
        hideAll.isConsumable(
          worldFromVisibility({ showActive: false, showCompleted: false, showDeleted: false }),
        ),
      ).toBe(false);
    });

    it('showAll projects all three flags to true', () => {
      const world = worldFromVisibility({ showActive: false, showCompleted: false, showDeleted: false });
      const next = showAll.project(world);
      expect(next.visibility).toEqual({ showActive: true, showCompleted: true, showDeleted: true });
    });

    it('hideAll projects all three flags to false', () => {
      const world = worldFromVisibility(makeVis({ showCompleted: true, showDeleted: true }));
      const next = hideAll.project(world);
      expect(next.visibility).toEqual({ showActive: false, showCompleted: false, showDeleted: false });
    });

    it('showAll.execute writes all three to true at once', () => {
      usePondStore.setState({ showActive: false, showCompleted: false, showDeleted: false });
      showAll.execute();
      const state = usePondStore.getState();
      expect(state.showActive).toBe(true);
      expect(state.showCompleted).toBe(true);
      expect(state.showDeleted).toBe(true);
    });

    it('hideAll.execute writes all three to false at once', () => {
      usePondStore.setState({ showActive: true, showCompleted: true, showDeleted: true });
      hideAll.execute();
      const state = usePondStore.getState();
      expect(state.showActive).toBe(false);
      expect(state.showCompleted).toBe(false);
      expect(state.showDeleted).toBe(false);
    });
  });

  // Story 6.2 Group E CR P2: `registerCommand` is now idempotent
  // (was: throw on duplicate). Vite HMR re-evaluating main.tsx used
  // to crash. Duplicate calls are silent no-ops; the FIRST
  // registration wins.
  describe('registerVisibilityCommands is idempotent', () => {
    it('a second call is a silent no-op (no throw, no duplicate)', () => {
      registerVisibilityCommands();
      const sizeAfterFirst = getRegistry().length;
      expect(() => registerVisibilityCommands()).not.toThrow();
      expect(getRegistry()).toHaveLength(sizeAfterFirst);
    });
  });
});
