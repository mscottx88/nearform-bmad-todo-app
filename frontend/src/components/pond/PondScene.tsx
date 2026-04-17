import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

// Milliseconds between consecutive pads entering the 'forming' phase on
// the first staggered load. 100ms gives a visible cascade without dragging
// out the load on dense ponds.
const STAGGER_STEP_MS = 100;

export function PondScene() {
  const glowIntensity = usePondStore((s) => s.glowIntensity);
  const activePopupTodoId = usePondStore((s) => s.activePopupTodoId);
  const completingTodos = usePondStore((s) => s.completingTodos);
  const deletingTodos = usePondStore((s) => s.deletingTodos);
  const [glError, setGlError] = useState<string | null>(null);
  const { data: todos = [], isLoading: isTodosLoading } = useTodos();
  const completeTodo = useCompleteTodo();
  const deleteTodo = useDeleteTodoAction();

  // Story 2.6 AC #1, #3: the initial staggered cascade is a ONE-SHOT — once
  // the first non-empty data set has been rendered, any subsequent mount
  // of a `<LilyPad>` (refetch re-adding an id, StrictMode double-invoke,
  // error-boundary retry) must NOT replay the stagger. We track that with
  // a ref that flips on the first non-empty render, so from that moment
  // on PondScene passes `dropDelayMs = 0` to every pad. Existing mounted
  // pads keep their captured delay via LilyPad's lazy useState; only new
  // mounts observe the zeroed value.
  //
  // Written via useEffect to avoid mutating a ref during render (react-hooks
  // purity). First non-empty render still passes `index * STAGGER_STEP_MS`
  // because the effect hasn't run yet — that's the one staggered cascade.
  const hasSeenInitialLoadRef = useRef(false);
  useEffect(() => {
    if (todos.length > 0) hasSeenInitialLoadRef.current = true;
  }, [todos.length]);

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
    // Guard the handler itself — store's `startCompletion` is idempotent
    // but the POST /creatures network call fires regardless, and a rapid
    // double-dispatch (synchronous re-click, touchstart+click pairing)
    // would produce a duplicate that fails on the DB UniqueConstraint.
    const store = usePondStore.getState();
    if (store.completingTodos.has(popupTodo.id) || store.deletingTodos.has(popupTodo.id)) return;
    const { creatureType, rarity } = completeTodo(popupTodo.id);
    store.startCompletion(popupTodo, creatureType, rarity);
    store.closePopup();
  };

  const handleDelete = () => {
    if (!popupTodo) return;
    // Guard the handler itself — store's `startDeletion` is idempotent but
    // the DELETE network call fires regardless, and a duplicate DELETE can
    // 404 silently since the first call soft-deletes the row.
    const store = usePondStore.getState();
    if (store.deletingTodos.has(popupTodo.id) || store.completingTodos.has(popupTodo.id)) return;
    deleteTodo(popupTodo.id);
    store.startDeletion(popupTodo);
    store.closePopup();
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
      {/* P9: only show the empty-pond hint after the initial todos query
          has resolved — otherwise it briefly flashes during cold load while
          `todos = []` (default) before data arrives. */}
      {!isTodosLoading && renderTodos.length === 0 && <EmptyPondHint />}
      {renderTodos.map((todo, index) => (
        <LilyPad
          key={todo.id}
          todo={todo}
          onDropComplete={handleDropComplete}
          focused={activePopupTodoId === todo.id}
          dropDelayMs={hasSeenInitialLoadRef.current ? 0 : index * STAGGER_STEP_MS}
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
