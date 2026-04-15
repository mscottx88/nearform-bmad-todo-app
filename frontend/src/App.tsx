import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PondScene } from './components/pond/PondScene';
import { CursorFirefly } from './components/effects/CursorFirefly';
import './styles/global.css';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PondScene />
      <CursorFirefly />
    </QueryClientProvider>
  );
}

export default App;
