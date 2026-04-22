import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './App.tsx'
import { registerVisibilityCommands } from './utils/visibilityCommands'

// Story 3.3: register the eight slash-command visibility registrations
// exactly once at cold boot — the registry throws on duplicates, so a
// double-call would surface as a dev-time error.
registerVisibilityCommands()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
