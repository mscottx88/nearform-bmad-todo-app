import { expect, test } from '@playwright/test';
import { E2E_QUERY, clearAllTodos } from './helpers';

test.describe('Agent panel resizable + persisted', () => {
  test.beforeEach(async ({ request }) => {
    await clearAllTodos(request);
  });

  test('keyboard-resizes the panel and the new width survives reload', async ({
    page,
  }) => {
    await page.goto(`/${E2E_QUERY}`);

    // Wait for the App to render before keyboard input. Without this
    // the F1 keypress can fire before useKeyboardShortcuts attaches
    // and is silently dropped.
    await page.waitForFunction(() => Boolean(window.__pondE2E__));
    await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0);
    await page.waitForTimeout(200);

    // F1 toggles the agent panel from anywhere (story 6.2 AC 1).
    await page.keyboard.press('F1');

    const handle = page.getByRole('separator', { name: 'Resize chat panel' });
    await expect(handle).toBeVisible();

    // Read the persisted starting width from the role's aria-valuenow
    // — the source of truth that the live AgentPanel exposes.
    const startWidth = Number(await handle.getAttribute('aria-valuenow'));
    expect(Number.isFinite(startWidth)).toBe(true);

    // ArrowLeft on the focused handle widens by 20px per press
    // (story 6.9). Five presses → +100px (capped at the 50%-viewport
    // ceiling, so the actual delta may be smaller on narrow screens).
    await handle.focus();
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('ArrowLeft');
    }
    // Allow keyup commits to flush.
    await page.waitForTimeout(50);

    const widerWidth = Number(await handle.getAttribute('aria-valuenow'));
    expect(widerWidth).toBeGreaterThan(startWidth);

    // Reload — the panel persistence lives in localStorage under
    // `agent-store-v1`. Because `panelOpen` is also persisted and
    // started as true, the panel re-mounts open after reload, which
    // is exactly what we need to read aria-valuenow again.
    await page.reload();
    const handleAfter = page.getByRole('separator', {
      name: 'Resize chat panel',
    });
    await expect(handleAfter).toBeVisible();
    const persistedWidth = Number(
      await handleAfter.getAttribute('aria-valuenow'),
    );
    // The persisted width MUST match what we just dragged to.
    // Allow ±1px tolerance for any rounding the clamp helper applies
    // when re-reading viewportWidth on remount.
    expect(Math.abs(persistedWidth - widerWidth)).toBeLessThanOrEqual(1);
  });
});
