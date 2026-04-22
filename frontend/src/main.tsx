import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './App.tsx'
import { registerVisibilityCommands } from './utils/visibilityCommands'
import { registerSpreadOutCommand } from './utils/spreadOutCommand'
import { queryClient } from './api/queryClient'
import { TODOS_KEY } from './api/todoApi'
import type { Todo } from './types'

// Story 3.3: register the eight slash-command visibility registrations
// exactly once at cold boot — the registry throws on duplicates, so a
// double-call would surface as a dev-time error.
registerVisibilityCommands()

// Story 4.2: register the `/spread-out` command with a closure that
// reads the current todo list from the React Query cache at dispatch
// time. Each visibility triple is stored under its own cache key
// (see `todosQueryKey` in todoApi.ts) — we flatten across every
// cached triple and dedupe by id so the command works regardless of
// which visibility mode the user is currently in.
registerSpreadOutCommand((): readonly Todo[] => {
  const entries = queryClient.getQueriesData<Todo[]>({ queryKey: TODOS_KEY })
  const seen = new Set<string>()
  const merged: Todo[] = []
  for (const [, data] of entries) {
    if (!data) continue
    for (const t of data) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      merged.push(t)
    }
  }
  return merged
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
