import { useCallback, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { usePondStore } from '../../stores/usePondStore';
import { useTodos } from '../../api/todoApi';
import { WaterSurface } from './WaterSurface';
import { LilyPad } from './LilyPad';
import { PondCamera } from './PondCamera';
import { EmptyPondHint } from '../ui/EmptyPondHint';

export function PondScene() {
  const glowIntensity = usePondStore((s) => s.glowIntensity);
  const [glError, setGlError] = useState<string | null>(null);
  const { data: todos = [] } = useTodos();

  const handleCreated = useCallback((state: RootState) => {
    const canvas = state.gl.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('WebGL context lost — waiting for restore');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      console.info('WebGL context restored');
    });
  }, []);

  const handleDropComplete = useCallback((x: number, z: number) => {
    usePondStore.getState().triggerRipple(x, z);
  }, []);

  if (glError) {
    return (
      <div style={{
        position: 'fixed', inset: 0, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: '#000', color: '#00eeff',
        fontFamily: "'Share Tech Mono', monospace", fontSize: '18px',
        textAlign: 'center', padding: '2rem',
      }}>
        Unable to initialize 3D scene.<br />
        {glError}
      </div>
    );
  }

  return (
    <Canvas
      gl={{ antialias: true, alpha: false }}
      camera={{ fov: 50, near: 0.1, far: 200, position: [0, 15, 20] }}
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh' }}
      onCreated={handleCreated}
      onError={() => setGlError('Your browser may not support WebGL.')}
    >
      <color attach="background" args={['#000000']} />

      <ambientLight intensity={0.1} />
      <pointLight position={[0, 10, 0]} intensity={0.3} color="#00eeff" />

      <WaterSurface />
      {todos.length === 0 && <EmptyPondHint />}
      {todos.map((todo) => (
        <LilyPad
          key={todo.id}
          todo={todo}
          onDropComplete={handleDropComplete}
        />
      ))}
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
