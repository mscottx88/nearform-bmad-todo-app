import { describe, it, expect, beforeEach } from 'vitest';
import { usePondStore } from './usePondStore';

describe('usePondStore', () => {
  beforeEach(() => {
    usePondStore.setState({
      activePopupTodoId: null,
      cameraFocus: null,
      dropRipple: null,
    });
  });

  describe('atmosphere', () => {
    it('cycles atmosphere modes and updates glow intensity', () => {
      const initial = usePondStore.getState().atmosphereMode;
      usePondStore.getState().toggleAtmosphere();
      const next = usePondStore.getState().atmosphereMode;
      expect(next).not.toBe(initial);
      expect(usePondStore.getState().glowIntensity).toBeGreaterThan(0);
    });
  });

  describe('triggerRipple', () => {
    it('records the ripple coordinates', () => {
      usePondStore.getState().triggerRipple(1, 2);
      expect(usePondStore.getState().dropRipple).toMatchObject({ x: 1, z: 2 });
    });
  });

  describe('focusCamera', () => {
    it('sets cameraFocus with x, z, and zoom', () => {
      usePondStore.getState().focusCamera(3, 4, 5);
      expect(usePondStore.getState().cameraFocus).toEqual({ x: 3, z: 4, zoom: 5 });
    });
  });

  describe('openPopup', () => {
    it('sets activePopupTodoId and triggers cameraFocus at pad position', () => {
      usePondStore.getState().openPopup('todo-1', 2, 3);
      const state = usePondStore.getState();
      expect(state.activePopupTodoId).toBe('todo-1');
      expect(state.cameraFocus).toEqual({ x: 2, z: 3, zoom: 4 });
    });

    it('replaces the active popup when called again (auto-close prior)', () => {
      usePondStore.getState().openPopup('todo-1', 0, 0);
      usePondStore.getState().openPopup('todo-2', 5, 6);
      const state = usePondStore.getState();
      expect(state.activePopupTodoId).toBe('todo-2');
      expect(state.cameraFocus).toEqual({ x: 5, z: 6, zoom: 4 });
    });
  });

  describe('closePopup', () => {
    it('clears activePopupTodoId and cameraFocus', () => {
      usePondStore.getState().openPopup('todo-1', 1, 1);
      expect(usePondStore.getState().cameraFocus).not.toBeNull();
      usePondStore.getState().closePopup();
      const state = usePondStore.getState();
      expect(state.activePopupTodoId).toBeNull();
      expect(state.cameraFocus).toBeNull();
    });

    it('is a no-op when no popup is open', () => {
      usePondStore.getState().closePopup();
      expect(usePondStore.getState().activePopupTodoId).toBeNull();
    });
  });
});
