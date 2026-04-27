import { expect, test } from '@playwright/test';
import {
  BACKEND_URL,
  E2E_QUERY,
  clearAllTodos,
  openTodoPopup,
  seedTodo,
} from './helpers';

test.describe('Complete todo via in-scene popup', () => {
  test.beforeEach(async ({ request }) => {
    await clearAllTodos(request);
  });

  test('clicking Complete in the popup PATCHes completed=true and removes the pad', async ({
    page,
    request,
  }) => {
    const seeded = await seedTodo(request, {
      text: 'Wash the car',
      position_x: 0,
      position_y: 0,
    });

    await page.goto(`/${E2E_QUERY}`);
    await openTodoPopup(page, seeded.id);

    // The InfoPopup renders into the R3F <Html /> portal but the
    // actual button is regular DOM. Match by accessible name —
    // a refactor that changes class names won't break this.
    const completeButton = page.getByRole('button', { name: 'Complete' });
    await expect(completeButton).toBeVisible();

    const patch = page.waitForRequest(
      (req) =>
        req.method() === 'PATCH' &&
        req.url().includes(`/api/todos/${seeded.id}`),
      { timeout: 10_000 },
    );

    // The InfoPopup is rendered through R3F's <Html /> which wraps
    // the buttons in a transform that updates every frame to track
    // the camera. Playwright's stability check sees that as motion;
    // `force: true` bypasses the check (the button is logically
    // stable — its onClick handler is the same every render).
    await completeButton.click({ force: true });
    const intercepted = await patch;
    const body = JSON.parse(intercepted.postData() ?? '{}') as { completed: boolean };
    expect(body.completed).toBe(true);

    // Confirm via API: default GET excludes completed todos, so the
    // post-completion list should not contain this id.
    await expect
      .poll(async () => {
        const list = await request.get(`${BACKEND_URL}/api/todos`);
        const todos = (await list.json()) as { id: string }[];
        return todos.map((t) => t.id);
      }, { timeout: 5_000 })
      .not.toContain(seeded.id);
  });
});
