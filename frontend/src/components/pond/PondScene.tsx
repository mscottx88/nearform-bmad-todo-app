import { useCallback, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { usePondStore } from '../../stores/usePondStore';
import { useTodos } from '../../api/todoApi';
import { WaterSurface } from './WaterSurface';
import { LilyPad } from './LilyPad';
import { PondCamera } from './PondCamera';
import { EmptyPondHint } from '../ui/EmptyPondHint';
import { ActionPopup } from '../ui/ActionPopup';

const POPUP_CLOSE_ANIM_MS = 150;

export function PondScene() {
  const glowIntensity = usePondStore((s) => s.glowIntensity);
  const [glError, setGlError] = useState<string | null>(null);
  const { data: todos = [] } = useTodos();

  // Hold the popup id for the close animation duration after the store clears it
  const [renderedPopupId, setRenderedPopupId] = useState<string | null>(
    () => usePondStore.getState().activePopupTodoId,
  );
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = usePondStore.subscribe((state, prev) => {
      if (state.activePopupTodoId === prev.activePopupTodoId) return;
      if (state.activePopupTodoId === null) {
        setClosing(true);
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          setRenderedPopupId(null);
          setClosing(false);
        }, POPUP_CLOSE_ANIM_MS);
      } else {
        if (timeoutId) clearTimeout(timeoutId);
        setRenderedPopupId(state.activePopupTodoId);
        setClosing(false);
      }
    });
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      unsubscribe();
    };
  }, []);

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

  const popupTodo = renderedPopupId ? todos.find((t) => t.id === renderedPopupId) : null;

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
          focused={renderedPopupId === todo.id && !closing}
        />
      ))}
      {popupTodo && (
        <ActionPopup
          key={popupTodo.id}
          todo={popupTodo}
          closing={closing}
          // TODO(Story 2.4): wire Complete to green-flash + dissolve completion
          onComplete={() => console.log('Complete', popupTodo.id)}
          // TODO(Story 2.5): wire Delete to red-flash + dissolve
          onDelete={() => console.log('Delete', popupTodo.id)}
          // TODO(Story 4.1): open color swatch panel
          onSetColor={() => console.log('Set Color', popupTodo.id)}
          // TODO(Epic 4.2): open group/ungroup flow
          onGroup={() => console.log('Group', popupTodo.id)}
        />
      )}
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
