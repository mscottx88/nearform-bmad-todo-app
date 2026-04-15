import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PondScene } from './components/pond/PondScene';
import './styles/global.css';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PondScene />
    </QueryClientProvider>
  );
}

export default App;
