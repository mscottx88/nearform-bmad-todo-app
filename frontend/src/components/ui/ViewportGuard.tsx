import { useEffect, type ReactNode } from 'react';
import { usePondStore } from '../../stores/usePondStore';
import './ViewportGuard.css';

const MIN_WIDTH = 800;
const MIN_HEIGHT = 500;

export function ViewportGuard({ children }: { children: ReactNode }) {
  const viewportSize = usePondStore((s) => s.viewportSize);

  useEffect(() => {
    const handleResize = () => {
      usePondStore.getState().setViewportSize(window.innerWidth, window.innerHeight);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (viewportSize.width < MIN_WIDTH || viewportSize.height < MIN_HEIGHT) {
    return (
      <div className="viewport-fallback">
        <div className="viewport-fallback__title">
          This experience is designed for desktop
        </div>
        <div className="viewport-fallback__subtitle">
          Please resize your window
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
