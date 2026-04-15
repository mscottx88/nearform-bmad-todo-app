import { OrbitControls } from '@react-three/drei';

export function PondCamera() {
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
