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

// Story 1.5: soft-warn ONCE per process when the e2e suite targets a
// backend that doesn't look like a dedicated test database. Mirrors
// the spirit of `backend/tests/conftest.py`'s `_safeguard.py` (which
// hard-refuses) but stops short of blocking, since the backend doesn't
// actually have a separate test DB today and forcing one would be an
// out-of-band change. Set `E2E_SUPPRESS_DEV_DB_WARNING=1` to silence.
let dbWarningEmitted = false;
function maybeWarnAboutDevDb(): void {
  if (dbWarningEmitted) return;
  if (process.env.E2E_SUPPRESS_DEV_DB_WARNING === '1') {
    dbWarningEmitted = true;
    return;
  }
  // Heuristics: a "test"-flavoured BACKEND_URL OR an explicit opt-in
  // env var marks the run as safe.
  const looksLikeTest =
    /test/i.test(BACKEND_URL) || process.env.E2E_ALLOW_DEV_DB === '1';
  if (!looksLikeTest) {
    // eslint-disable-next-line no-console
    console.warn(
      `\n⚠️  e2e suite is wiping todos at ${BACKEND_URL} on every test.\n` +
        '   This backend does not look like a dedicated test database.\n' +
        '   If you are running against `make dev`, your dev todos will be deleted.\n' +
        '   Set E2E_ALLOW_DEV_DB=1 to acknowledge, or E2E_SUPPRESS_DEV_DB_WARNING=1 to silence.\n',
    );
  }
  dbWarningEmitted = true;
}

/**
 * Soft-delete every active todo so each test starts from an empty
 * pond. The default GET /api/todos response excludes deleted rows,
 * so after one DELETE pass the API surface is empty even though the
 * rows themselves remain in the DB. That's intentional — the front-
 * end never sees them.
 *
 * Failures on individual DELETEs are surfaced (previously
 * `Promise.all` swallowed non-2xx responses, leaving a polluted pond
 * for the next test).
 */
export async function clearAllTodos(request: APIRequestContext): Promise<void> {
  maybeWarnAboutDevDb();
  const res = await request.get(`${BACKEND_URL}/api/todos`);
  if (!res.ok()) {
    throw new Error(`GET /api/todos failed: ${res.status()} ${await res.text()}`);
  }
  const todos = (await res.json()) as { id: string }[];
  const results = await Promise.allSettled(
    todos.map(async (t) => {
      const r = await request.delete(`${BACKEND_URL}/api/todos/${t.id}`);
      if (!r.ok()) {
        throw new Error(
          `DELETE /api/todos/${t.id} failed: ${r.status()} ${await r.text()}`,
        );
      }
    }),
  );
  const failed = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => String(r.reason));
  if (failed.length > 0) {
    throw new Error(
      `clearAllTodos: ${failed.length} of ${todos.length} DELETEs failed:\n` +
        failed.join('\n'),
    );
  }
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
