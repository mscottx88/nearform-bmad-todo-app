import { create } from 'zustand';
import type { AtmosphereMode } from '../types';

const ATMOSPHERE_MODES: Array<AtmosphereMode | 'base'> = ['base', 'zen', 'cyberpunk'];

const GLOW_INTENSITY: Record<AtmosphereMode | 'base', number> = {
  base: 1.0,
  zen: 0.6,
  cyberpunk: 1.4,
};

const getWindowSize = () =>
  typeof window !== 'undefined'
    ? { width: window.innerWidth, height: window.innerHeight }
    : { width: 1920, height: 1080 };

interface RippleEvent {
  x: number;
  z: number;
  time: number;
}

interface PondState {
  atmosphereMode: AtmosphereMode | 'base';
  glowIntensity: number;
  viewportSize: { width: number; height: number };
  dropRipple: RippleEvent | null;
  toggleAtmosphere: () => void;
  setViewportSize: (width: number, height: number) => void;
  triggerRipple: (x: number, z: number) => void;
}

export const usePondStore = create<PondState>((set) => ({
  atmosphereMode: 'base',
  glowIntensity: GLOW_INTENSITY.base,
  viewportSize: getWindowSize(),
  dropRipple: null,

  toggleAtmosphere: () =>
    set((state) => {
      const nextIndex = (ATMOSPHERE_MODES.indexOf(state.atmosphereMode) + 1) % ATMOSPHERE_MODES.length;
      const next = ATMOSPHERE_MODES[nextIndex];
      return { atmosphereMode: next, glowIntensity: GLOW_INTENSITY[next] };
    }),

  setViewportSize: (width: number, height: number) =>
    set({ viewportSize: { width: Math.max(1, width), height: Math.max(1, height) } }),

  triggerRipple: (x: number, z: number) =>
    set({ dropRipple: { x, z, time: performance.now() / 1000 } }),
}));
