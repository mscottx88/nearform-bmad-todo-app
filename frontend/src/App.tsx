import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PondScene } from './components/pond/PondScene';
import { CursorFirefly } from './components/effects/CursorFirefly';
import { ViewportGuard } from './components/ui/ViewportGuard';
import './styles/global.css';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ViewportGuard>
        <PondScene />
        <CursorFirefly />
      </ViewportGuard>
    </QueryClientProvider>
  );
}

export default App;
