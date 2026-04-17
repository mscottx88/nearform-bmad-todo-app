import { useCallback, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PondScene } from './components/pond/PondScene';
import { CursorFirefly } from './components/effects/CursorFirefly';
import { ViewportGuard } from './components/ui/ViewportGuard';
import { TodoInput } from './components/ui/TodoInput';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useClosePopupOnEscape } from './hooks/useClosePopupOnEscape';
import './styles/global.css';

// Mutation retry policy per story 2.6 AC #7: 3 automatic retries with
// exponential backoff capped at 8s. React Query's `onError` fires only
// after the final retry exhausts, which is when LilyPad's decay visual
// appears. Queries (just useTodos today) use the default retry policy.
const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
  },
});

function AppContent() {
  const [inputOpen, setInputOpen] = useState(false);

  const openInput = useCallback(() => setInputOpen(true), []);
  const closeInput = useCallback(() => setInputOpen(false), []);

  useKeyboardShortcuts(openInput);
  useClosePopupOnEscape();

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
