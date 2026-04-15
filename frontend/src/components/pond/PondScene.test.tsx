import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PondScene } from './PondScene';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="r3f-canvas">{children}</div>
  ),
  useFrame: vi.fn(),
  useThree: () => ({
    camera: { position: { set: vi.fn() }, lookAt: vi.fn() },
  }),
}));

vi.mock('@react-three/postprocessing', () => ({
  EffectComposer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Bloom: () => null,
}));

vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
}));

describe('PondScene', () => {
  it('mounts without errors', () => {
    const { getByTestId } = render(<PondScene />);
    expect(getByTestId('r3f-canvas')).toBeInTheDocument();
  });
});
