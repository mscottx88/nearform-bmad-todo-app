import { expect, test } from '@playwright/test';
import { BACKEND_URL, E2E_QUERY, clearAllTodos } from './helpers';

test.describe('Create todo via TodoInput', () => {
  test.beforeEach(async ({ request }) => {
    await clearAllTodos(request);
  });

  test('typing a phrase + Enter creates a lily pad and POSTs to /api/todos', async ({
    page,
    request,
  }) => {
    // Intercept the create call so we can assert on the request body
    // even when the fixture clock isn't precisely aligned with the
    // backend's response.
    const createRequest = page.waitForRequest(
      (req) => req.url().endsWith('/api/todos') && req.method() === 'POST',
      { timeout: 10_000 },
    );

    await page.goto(`/${E2E_QUERY}`);
    // Wait for the test seam (proves React mounted) + canvas + a
    // breath for the keyboard hook's useEffect to attach.
    await page.waitForFunction(() => Boolean(window.__pondE2E__));
    await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0);
    await page.waitForTimeout(200);

    // Press Enter from the body to open TodoInput. The pond's global
    // keyboard hook captures this when no input is focused.
    await page.keyboard.press('Enter');

    // Stable test-id selector — placeholder copy is user-facing and
    // may churn.
    const input = page.getByTestId('todo-input');
    await expect(input).toBeFocused();

    await input.fill('Buy milk');
    await input.press('Enter');

    const intercepted = await createRequest;
    const body = JSON.parse(intercepted.postData() ?? '{}') as { text: string };
    expect(body.text).toBe('Buy milk');

    // Round-trip via the API to confirm the row landed.
    let createdId: string | undefined;
    await expect
      .poll(async () => {
        const list = await request.get(`${BACKEND_URL}/api/todos`);
        const todos = (await list.json()) as { id: string; text: string }[];
        const match = todos.find((t) => t.text === 'Buy milk');
        if (match) createdId = match.id;
        return todos.map((t) => t.text);
      }, { timeout: 5_000 })
      .toContain('Buy milk');

    // Story 1.5 AC 5 Test 1 sub-bullet 2: assert the lily pad
    // actually surfaces in the SPA (DOM-presence check). The test
    // seam exposes the React Query cache snapshot — verifying the
    // new id appears there proves the SPA rendered the pad.
    expect(createdId).toBeDefined();
    await expect
      .poll(
        async () =>
          page.evaluate(() => window.__pondE2E__?.getRenderedTodoIds() ?? []),
        { timeout: 5_000 },
      )
      .toContain(createdId!);
  });
});
