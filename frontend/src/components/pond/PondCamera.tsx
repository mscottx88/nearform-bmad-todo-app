import { useEffect } from 'react';
import { OrbitControls } from '@react-three/drei';
import { usePondStore } from '../../stores/usePondStore';

export function PondCamera() {
  useEffect(() => {
    const handleResize = () => {
      usePondStore.getState().setViewportSize(window.innerWidth, window.innerHeight);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <OrbitControls
      target={[0, 0, 0]}
      maxPolarAngle={Math.PI / 2.2}
      minDistance={5}
      maxDistance={60}
      enableDamping
      dampingFactor={0.05}
      enablePan={false}
    />
  );
}
