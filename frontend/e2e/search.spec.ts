import { expect, test } from '@playwright/test';
import { E2E_QUERY, clearAllTodos, seedTodo } from './helpers';

test.describe('Type-anywhere search overlay', () => {
  test.beforeEach(async ({ request }) => {
    await clearAllTodos(request);
    await Promise.all([
      seedTodo(request, { text: 'Buy avocados', position_x: -3, position_y: 2 }),
      seedTodo(request, { text: 'Email Steve about Friday', position_x: 4, position_y: -1 }),
      seedTodo(request, { text: 'Plant zinnias', position_x: 0, position_y: 5 }),
    ]);
  });

  test('typing a fragment surfaces the matching pad in the search overlay', async ({
    page,
  }) => {
    await page.goto(`/${E2E_QUERY}`);

    // Wait for the test seam first (proves React mounted), then for
    // the canvas to render (proves PondScene mounted, which is where
    // usePondSearchKeyboard registers its keydown listener). Without
    // this gate the keypress can fire before the hook's useEffect
    // runs and the keystroke is silently dropped.
    await page.waitForFunction(() => Boolean(window.__pondE2E__));
    await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0);
    // One extra animation frame for the keydown listener to attach.
    await page.waitForTimeout(200);

    const overlayQuery = page.locator('.pond-search-overlay__query');
    const overlay = page.locator('.pond-search-overlay');

    await page.keyboard.type('avocados');
    await expect(overlayQuery).toHaveText('avocados');
    await expect(overlay).toHaveClass(/pond-search-overlay--active/);

    // Escape clears the search. AC #12 of story 5.3 specifies a
    // ~200ms dissolve, but the active class flips on key-up.
    await page.keyboard.press('Escape');
    await expect(overlay).not.toHaveClass(/pond-search-overlay--active/);
  });
});
