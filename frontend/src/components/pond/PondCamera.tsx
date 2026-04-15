import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect } from 'react';
import { usePondStore } from '../../stores/usePondStore';

export function PondCamera() {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(0, 15, 20);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  useEffect(() => {
    const handleResize = () => {
      usePondStore.getState().setViewportSize(window.innerWidth, window.innerHeight);
    };
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
