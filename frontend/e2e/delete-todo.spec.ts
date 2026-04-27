import { expect, test } from '@playwright/test';
import {
  BACKEND_URL,
  E2E_QUERY,
  clearAllTodos,
  openTodoPopup,
  seedTodo,
} from './helpers';

test.describe('Delete todo via in-scene popup', () => {
  test.beforeEach(async ({ request }) => {
    await clearAllTodos(request);
  });

  test('clicking Delete soft-deletes the todo and removes the pad', async ({
    page,
    request,
  }) => {
    const seeded = await seedTodo(request, {
      text: 'Throw away old jam',
      position_x: 0,
      position_y: 0,
    });

    await page.goto(`/${E2E_QUERY}`);
    await openTodoPopup(page, seeded.id);

    const deleteButton = page.getByRole('button', { name: 'Delete' });
    await expect(deleteButton).toBeVisible();

    // The frontend deletes via DELETE /api/todos/:id (which the
    // backend handles as a soft-delete; see backend/src/api/todos.py).
    // Asserting on DELETE specifically catches a regression where a
    // refactor accidentally swaps the popup to call PATCH (which is
    // the *update* endpoint and would not actually soft-delete).
    const deleteRequest = page.waitForRequest(
      (req) =>
        req.method() === 'DELETE' &&
        req.url().includes(`/api/todos/${seeded.id}`),
      { timeout: 10_000 },
    );

    // See complete-todo.spec.ts for why we force-click — same
    // R3F-<Html /> transform churn that defeats the stability check.
    await deleteButton.click({ force: true });
    await deleteRequest;

    await expect
      .poll(async () => {
        const list = await request.get(`${BACKEND_URL}/api/todos`);
        const todos = (await list.json()) as { id: string }[];
        return todos.map((t) => t.id);
      }, { timeout: 5_000 })
      .not.toContain(seeded.id);
  });
});
