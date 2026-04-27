import type { APIRequestContext, Page } from '@playwright/test';

/**
 * Backend base URL the test should hit directly for seeding /
 * teardown. In dev mode the backend listens on :8000 and the Vite
 * dev server proxies `/api/*` to it. In docker-compose mode, port
 * 8000 is also published. So the seed URL is the same in both modes
 * when run from the host. Override with `BACKEND_URL` for unusual
 * setups (e.g. CI where the backend is reachable only by an internal
 * hostname).
 */
export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000';

/**
 * Tests use `?e2e=1` so the bundle installs `window.__pondE2E__`.
 * See `src/test/e2eHooks.ts` for the seam contract.
 */
export const E2E_QUERY = '?e2e=1';

export interface SeededTodo {
  id: string;
  text: string;
  position_x: number | null;
  position_y: number | null;
}

/**
 * Soft-delete every active todo so each test starts from an empty
 * pond. The default GET /api/todos response excludes deleted rows,
 * so after one DELETE pass the API surface is empty even though the
 * rows themselves remain in the DB. That's intentional — the front-
 * end never sees them.
 */
export async function clearAllTodos(request: APIRequestContext): Promise<void> {
  const res = await request.get(`${BACKEND_URL}/api/todos`);
  if (!res.ok()) {
    throw new Error(`GET /api/todos failed: ${res.status()} ${await res.text()}`);
  }
  const todos = (await res.json()) as { id: string }[];
  await Promise.all(
    todos.map((t) => request.delete(`${BACKEND_URL}/api/todos/${t.id}`)),
  );
}

/** Seed a single todo via the backend API. */
export async function seedTodo(
  request: APIRequestContext,
  payload: { text: string; position_x?: number; position_y?: number },
): Promise<SeededTodo> {
  const res = await request.post(`${BACKEND_URL}/api/todos`, {
    data: payload,
  });
  if (!res.ok()) {
    throw new Error(`POST /api/todos failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as SeededTodo;
}

/**
 * Programmatically open the in-scene popup for a seeded todo. This
 * is the test seam that bypasses the R3F canvas raycast — the popup
 * itself renders via React and is fully DOM-clickable.
 */
export async function openTodoPopup(page: Page, todoId: string): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__pondE2E__), undefined, {
    timeout: 5_000,
  });
  await page.evaluate(
    ([id]) => {
      window.__pondE2E__!.openPopup(id);
    },
    [todoId],
  );
}
