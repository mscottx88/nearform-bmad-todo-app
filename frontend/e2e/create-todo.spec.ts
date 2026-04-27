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
    // The empty-pond keypress hint is rendered after first paint;
    // waiting on its visibility is a reliable "app booted" signal
    // without coupling to the WebGL canvas.
    await expect(page.locator('body')).toBeVisible();

    // Press Enter from the body to open TodoInput. The pond's global
    // keyboard hook captures this when no input is focused.
    await page.keyboard.press('Enter');

    // The TodoInput renders a portal into <body>. Find by placeholder.
    const input = page.getByPlaceholder("what's on your mind...");
    await expect(input).toBeFocused();

    await input.fill('Buy milk');
    await input.press('Enter');

    const intercepted = await createRequest;
    const body = JSON.parse(intercepted.postData() ?? '{}') as { text: string };
    expect(body.text).toBe('Buy milk');

    // Round-trip via the API to confirm the row landed. (Reading the
    // pond canvas DOM directly would require a WebGL probe — which is
    // exactly what the test seam was designed to avoid.)
    await expect
      .poll(async () => {
        const list = await request.get(`${BACKEND_URL}/api/todos`);
        const todos = (await list.json()) as { text: string }[];
        return todos.map((t) => t.text);
      }, { timeout: 5_000 })
      .toContain('Buy milk');
  });
});
