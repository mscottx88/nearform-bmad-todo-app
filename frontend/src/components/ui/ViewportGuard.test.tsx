import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ViewportGuard } from './ViewportGuard';

function setViewport(width: number, height: number) {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  window.dispatchEvent(new Event('resize'));
}

describe('ViewportGuard', () => {
  beforeEach(() => {
    setViewport(1920, 1080);
  });

  it('renders children when viewport is large enough', () => {
    render(
      <ViewportGuard>
        <div data-testid="app-content">App</div>
      </ViewportGuard>,
    );
    expect(screen.getByTestId('app-content')).toBeInTheDocument();
  });

  it('shows fallback when viewport is too narrow', () => {
    setViewport(600, 1080);
    render(
      <ViewportGuard>
        <div data-testid="app-content">App</div>
      </ViewportGuard>,
    );
    expect(screen.queryByTestId('app-content')).not.toBeInTheDocument();
    expect(screen.getByText('This experience is designed for desktop')).toBeInTheDocument();
  });

  it('shows fallback when viewport is too short', () => {
    setViewport(1920, 400);
    render(
      <ViewportGuard>
        <div data-testid="app-content">App</div>
      </ViewportGuard>,
    );
    expect(screen.queryByTestId('app-content')).not.toBeInTheDocument();
    expect(screen.getByText('Please resize your window')).toBeInTheDocument();
  });
});
