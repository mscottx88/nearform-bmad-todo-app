import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { E2E_QUERY, clearAllTodos } from './helpers';
import { allowedRules } from './a11y-allowlist';

/**
 * Accessibility gate — story 1.5 AC 6.
 *
 * Two scans:
 *   1. Empty pond view (steady state).
 *   2. Empty pond + agent panel open (the largest set of interactive
 *      controls the SPA can have visible at once).
 *
 * Failure rule: any violation at impact `critical` or `serious` is a
 * fail. `moderate` and `minor` violations are reported via the run
 * log but do not gate the build.
 */
test.describe('Accessibility — zero critical/serious violations', () => {
  test.beforeEach(async ({ request }) => {
    await clearAllTodos(request);
  });

  test('empty pond passes axe-core (wcag2a + wcag2aa)', async ({ page }) => {
    await page.goto(`/${E2E_QUERY}`);
    await page.waitForFunction(() => Boolean(window.__pondE2E__));
    await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0);
    // Give the canvas a frame to settle so axe scans a stable DOM.
    await page.waitForTimeout(300);

    const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']);
    if (allowedRules.length > 0) builder.disableRules([...allowedRules]);
    const results = await builder.analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    if (blocking.length > 0) {
      console.log(
        'Blocking violations:',
        JSON.stringify(blocking, null, 2),
      );
    }
    expect(blocking, 'no critical/serious WCAG violations').toEqual([]);
  });

  test('agent panel open passes axe-core (wcag2a + wcag2aa)', async ({
    page,
  }) => {
    await page.goto(`/${E2E_QUERY}`);
    await page.waitForFunction(() => Boolean(window.__pondE2E__));
    await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0);
    await page.waitForTimeout(200);
    await page.keyboard.press('F1');

    // Wait for the panel to render before scanning.
    await expect(
      page.getByRole('separator', { name: 'Resize chat panel' }),
    ).toBeVisible();

    const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']);
    if (allowedRules.length > 0) builder.disableRules([...allowedRules]);
    const results = await builder.analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    if (blocking.length > 0) {
      console.log(
        'Blocking violations:',
        JSON.stringify(blocking, null, 2),
      );
    }
    expect(blocking, 'no critical/serious WCAG violations').toEqual([]);
  });
});
