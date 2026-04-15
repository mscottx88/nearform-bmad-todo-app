import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/global.css';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Share Tech Mono', monospace",
        color: 'var(--neon-cyan)',
        fontSize: '24px',
        textShadow: '0 0 10px var(--neon-cyan), 0 0 20px var(--neon-cyan)',
      }}>
        nearform-bmad-todo-app
      </div>
    </QueryClientProvider>
  );
}

export default App;
