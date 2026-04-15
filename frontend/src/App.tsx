import { useCallback, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PondScene } from './components/pond/PondScene';
import { CursorFirefly } from './components/effects/CursorFirefly';
import { ViewportGuard } from './components/ui/ViewportGuard';
import { TodoInput } from './components/ui/TodoInput';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import './styles/global.css';

const queryClient = new QueryClient();

function AppContent() {
  const [inputOpen, setInputOpen] = useState(false);

  const openInput = useCallback(() => setInputOpen(true), []);
  const closeInput = useCallback(() => setInputOpen(false), []);

  useKeyboardShortcuts(openInput);

  return (
    <ViewportGuard>
      <PondScene />
      <TodoInput isOpen={inputOpen} onClose={closeInput} />
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
