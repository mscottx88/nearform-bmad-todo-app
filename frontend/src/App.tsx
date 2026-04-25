import { useCallback, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { AgentPanel } from './components/agent/AgentPanel';
import { PondScene } from './components/pond/PondScene';
import { CursorFirefly } from './components/effects/CursorFirefly';
import { ViewportGuard } from './components/ui/ViewportGuard';
import { TodoInput } from './components/ui/TodoInput';
import { useGlobalCursorMode } from './hooks/useGlobalCursorMode';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useClosePopupOnEscape } from './hooks/useClosePopupOnEscape';
import { queryClient } from './api/queryClient';
import './styles/global.css';

function AppContent() {
  const [inputOpen, setInputOpen] = useState(false);
  // Story 3.3 AC #10: seed TodoInput's controlled `value` on open so
  // the global `/` shortcut lands with "/" already typed. Enter
  // continues to seed an empty input.
  const [inputInitial, setInputInitial] = useState('');

  const openInput = useCallback((initial: string) => {
    setInputInitial(initial);
    setInputOpen(true);
  }, []);
  const closeInput = useCallback(() => setInputOpen(false), []);

  useKeyboardShortcuts(openInput);
  useClosePopupOnEscape();
  useGlobalCursorMode();

  return (
    <ViewportGuard>
      <PondScene />
      <TodoInput isOpen={inputOpen} initialValue={inputInitial} onClose={closeInput} />
      <AgentPanel />
      <CursorFirefly />
    </ViewportGuard>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
