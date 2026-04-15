import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from './App';

vi.mock('./components/pond/PondScene', () => ({
  PondScene: () => <div data-testid="pond-scene">PondScene</div>,
}));

vi.mock('./components/effects/CursorFirefly', () => ({
  CursorFirefly: () => <canvas data-testid="cursor-firefly" />,
}));

describe('App', () => {
  it('renders the PondScene', () => {
    const { getByTestId } = render(<App />);
    expect(getByTestId('pond-scene')).toBeInTheDocument();
  });
});
