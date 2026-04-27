import { expect, test } from '@playwright/test';
import { E2E_QUERY, clearAllTodos, seedTodo } from './helpers';

test.describe('Type-anywhere search overlay', () => {
  let avocadoId: string;
  let emailId: string;
  let zinniaId: string;

  test.beforeEach(async ({ request }) => {
    await clearAllTodos(request);
    const [avocado, email, zinnia] = await Promise.all([
      seedTodo(request, { text: 'Buy avocados', position_x: -3, position_y: 2 }),
      seedTodo(request, { text: 'Email Steve about Friday', position_x: 4, position_y: -1 }),
      seedTodo(request, { text: 'Plant zinnias', position_x: 0, position_y: 5 }),
    ]);
    avocadoId = avocado.id;
    emailId = email.id;
    zinniaId = zinnia.id;
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

    // Story 1.5 AC 5 Test 4 sub-bullet 2: assert the matching pad
    // rises (is in `searchResults`) and the others submerge (are
    // NOT). The store's `searchResults` map IS the data source the
    // pond's per-pad y-elevation reads from — exposing it via the
    // test seam lets us verify the rise/submerge behavior without a
    // WebGL probe.
    await expect
      .poll(
        async () =>
          page.evaluate(() => window.__pondE2E__?.getSearchResultIds() ?? []),
        { timeout: 5_000 },
      )
      .toContain(avocadoId);
    const searchHits = await page.evaluate(
      () => window.__pondE2E__?.getSearchResultIds() ?? [],
    );
    expect(searchHits).not.toContain(emailId);
    expect(searchHits).not.toContain(zinniaId);

    // Escape clears the search. AC #12 of story 5.3 specifies a
    // ~200ms dissolve, but the active class flips on key-up.
    await page.keyboard.press('Escape');
    await expect(overlay).not.toHaveClass(/pond-search-overlay--active/);
  });
});
