import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { usePondStore } from '../../stores/usePondStore';
import { WaterSurface } from './WaterSurface';
import { PondCamera } from './PondCamera';

export function PondScene() {
  const glowIntensity = usePondStore((s) => s.glowIntensity);

  return (
    <Canvas
      gl={{ antialias: true, alpha: false }}
      camera={{ fov: 50, near: 0.1, far: 200 }}
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh' }}
    >
      <color attach="background" args={['#000000']} />

      <ambientLight intensity={0.1} />
      <pointLight position={[0, 10, 0]} intensity={0.3} color="#00eeff" />

      <WaterSurface />
      <PondCamera />

      <EffectComposer>
        <Bloom
          luminanceThreshold={0.2}
          luminanceSmoothing={0.9}
          intensity={glowIntensity}
        />
      </EffectComposer>
    </Canvas>
  );
}
