import { create } from 'zustand';
import type { AtmosphereMode } from '../types';

const GLOW_INTENSITY: Record<AtmosphereMode | 'base', number> = {
  base: 1.0,
  zen: 0.6,
  cyberpunk: 1.4,
};

interface PondState {
  atmosphereMode: AtmosphereMode | 'base';
  glowIntensity: number;
  viewportSize: { width: number; height: number };
  toggleAtmosphere: () => void;
  setViewportSize: (width: number, height: number) => void;
}

export const usePondStore = create<PondState>((set) => ({
  atmosphereMode: 'base',
  glowIntensity: GLOW_INTENSITY.base,
  viewportSize: { width: window.innerWidth, height: window.innerHeight },

  toggleAtmosphere: () =>
    set((state) => {
      const cycle: Array<AtmosphereMode | 'base'> = ['base', 'zen', 'cyberpunk'];
      const nextIndex = (cycle.indexOf(state.atmosphereMode) + 1) % cycle.length;
      const next = cycle[nextIndex];
      return { atmosphereMode: next, glowIntensity: GLOW_INTENSITY[next] };
    }),

  setViewportSize: (width: number, height: number) =>
    set({ viewportSize: { width, height } }),
}));
