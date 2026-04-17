import { useCallback, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { usePondStore } from '../../stores/usePondStore';
import { useTodos } from '../../api/todoApi';
import { useCompleteTodo } from '../../hooks/usePopupComplete';
import { useDeleteTodoAction } from '../../hooks/usePopupDelete';
import type { Todo } from '../../types';
import { WaterSurface } from './WaterSurface';
import { LilyPad } from './LilyPad';
import { PondCamera } from './PondCamera';
import { EmptyPondHint } from '../ui/EmptyPondHint';
import { ActionPopup } from '../ui/ActionPopup';

export function PondScene() {
  const glowIntensity = usePondStore((s) => s.glowIntensity);
  const activePopupTodoId = usePondStore((s) => s.activePopupTodoId);
  const completingTodos = usePondStore((s) => s.completingTodos);
  const deletingTodos = usePondStore((s) => s.deletingTodos);
  const [glError, setGlError] = useState<string | null>(null);
  const { data: todos = [] } = useTodos();
  const completeTodo = useCompleteTodo();
  const deleteTodo = useDeleteTodoAction();

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

  // Merge the live todo list with any in-flight completion OR deletion
  // overrides so a pad mid-dissolve keeps rendering even after the backend
  // refetch drops it from `todos`. Dedup by id; live todos take precedence.
  const renderTodos = useMemo<Todo[]>(() => {
    if (completingTodos.size === 0 && deletingTodos.size === 0) return todos;
    const ids = new Set(todos.map((t) => t.id));
    const extras: Todo[] = [];
    for (const entry of completingTodos.values()) {
      if (!ids.has(entry.todo.id)) {
        extras.push(entry.todo);
        ids.add(entry.todo.id);
      }
    }
    for (const entry of deletingTodos.values()) {
      if (!ids.has(entry.todo.id)) {
        extras.push(entry.todo);
        ids.add(entry.todo.id);
      }
    }
    return extras.length > 0 ? [...todos, ...extras] : todos;
  }, [todos, completingTodos, deletingTodos]);

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

  const popupTodo = activePopupTodoId
    ? renderTodos.find((t) => t.id === activePopupTodoId)
    : null;

  const handleComplete = () => {
    if (!popupTodo) return;
    const { creatureType, rarity } = completeTodo(popupTodo.id);
    usePondStore.getState().startCompletion(popupTodo, creatureType, rarity);
    usePondStore.getState().closePopup();
  };

  const handleDelete = () => {
    if (!popupTodo) return;
    deleteTodo(popupTodo.id);
    usePondStore.getState().startDeletion(popupTodo);
    usePondStore.getState().closePopup();
  };

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
      {renderTodos.length === 0 && <EmptyPondHint />}
      {renderTodos.map((todo) => (
        <LilyPad
          key={todo.id}
          todo={todo}
          onDropComplete={handleDropComplete}
          focused={activePopupTodoId === todo.id}
        />
      ))}
      {popupTodo && (
        <ActionPopup
          key={popupTodo.id}
          todo={popupTodo}
          onComplete={handleComplete}
          onDelete={handleDelete}
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
