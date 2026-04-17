import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EmergingCreature } from './EmergingCreature';

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

vi.mock('./creatures/Firefly', () => ({
  Firefly: ({ color }: { color: string }) => (
    <mesh data-testid="firefly" data-color={color} />
  ),
}));

vi.mock('./creatures/WaterStrider', () => ({
  WaterStrider: ({ color }: { color: string }) => (
    <group data-testid="water-strider" data-color={color} />
  ),
}));

describe('EmergingCreature', () => {
  it('renders a Firefly when creatureType is "firefly"', () => {
    const { container } = render(
      <EmergingCreature
        creatureType="firefly"
        color="#00eeff"
        basePosition={[0, 0, 0]}
        startTime={0}
      />,
    );
    expect(container.querySelector('[data-testid="firefly"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="water-strider"]')).toBeFalsy();
  });

  it('renders a WaterStrider when creatureType is "water_strider"', () => {
    const { container } = render(
      <EmergingCreature
        creatureType="water_strider"
        color="#ff10f0"
        basePosition={[1, 0, 2]}
        startTime={0}
      />,
    );
    expect(container.querySelector('[data-testid="water-strider"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="firefly"]')).toBeFalsy();
  });

  it('falls back to Firefly for unknown creature types (AC #3 fallback)', () => {
    for (const type of ['frog', 'dragonfly', 'golden_koi', 'neon_phoenix', 'glowing_jellyfish']) {
      const { container, unmount } = render(
        <EmergingCreature
          creatureType={type}
          color="#39ff14"
          basePosition={[0, 0, 0]}
          startTime={0}
        />,
      );
      expect(
        container.querySelector('[data-testid="firefly"]'),
        `fallback for "${type}" should render a Firefly`,
      ).toBeTruthy();
      unmount();
    }
  });

  it('passes the color through to the base creature', () => {
    const { container } = render(
      <EmergingCreature
        creatureType="firefly"
        color="#ffd700"
        basePosition={[0, 0, 0]}
        startTime={0}
      />,
    );
    const firefly = container.querySelector('[data-testid="firefly"]');
    expect(firefly?.getAttribute('data-color')).toBe('#ffd700');
  });
});
