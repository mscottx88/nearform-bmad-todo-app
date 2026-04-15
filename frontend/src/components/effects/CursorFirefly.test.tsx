import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CursorFirefly } from './CursorFirefly';

describe('CursorFirefly', () => {
  it('mounts and renders a canvas element', () => {
    const { container } = render(<CursorFirefly />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveClass('cursor-firefly-canvas');
  });
});
