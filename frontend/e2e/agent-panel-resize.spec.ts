import { expect, test } from '@playwright/test';
import { E2E_QUERY, clearAllTodos } from './helpers';

test.describe('Agent panel resizable + persisted', () => {
  test.beforeEach(async ({ request }) => {
    await clearAllTodos(request);
    // Note: this test relies on Playwright's per-test context
    // isolation (the default with `workers: 1` + `fullyParallel:
    // false`) so localStorage starts empty. The reload mid-test
    // intentionally preserves the persisted store state — that's
    // what we're verifying. If `workers` ever changes, an explicit
    // localStorage clear before the first F1 press becomes
    // necessary to avoid persisted `panelOpen=true` from a prior
    // run causing F1 to close the panel.
  });

  test('drag-resizes the panel and the new width survives reload', async ({
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
    // After the localStorage wipe in beforeEach, panelOpen is the
    // store's default (false), so F1 here always opens.
    await page.keyboard.press('F1');

    const handle = page.getByRole('separator', { name: 'Resize chat panel' });
    await expect(handle).toBeVisible();

    // Read the persisted starting width from the role's aria-valuenow
    // — the source of truth that the live AgentPanel exposes.
    const startWidth = Number(await handle.getAttribute('aria-valuenow'));
    expect(Number.isFinite(startWidth)).toBe(true);

    // Story 1.5 AC 5 Test 5: drag the handle ~150px wider with real
    // pointer events. The panel sits at the right of the viewport,
    // so dragging the handle LEFT widens the panel.
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    const dragDx = -150; // negative = move left = widen

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Multi-step move so the pointermove handler fires repeatedly
    // (a single jump-to-end can be coalesced by the browser).
    const steps = 8;
    for (let i = 1; i <= steps; i += 1) {
      await page.mouse.move(startX + (dragDx * i) / steps, startY, { steps: 4 });
    }
    await page.mouse.up();
    // Allow the commitDraft → setPanelWidth → persist cycle to flush.
    await page.waitForTimeout(100);

    const widerWidth = Number(await handle.getAttribute('aria-valuenow'));
    expect(widerWidth).toBeGreaterThan(startWidth);
    // The drag should have widened the panel by close to 150px,
    // unless we hit the 50%-viewport ceiling (in which case we'd
    // expect a smaller-but-positive delta). Either way, > start.
    expect(widerWidth - startWidth).toBeGreaterThan(0);

    // Reload — the panel persistence lives in localStorage under
    // `agent-store-v1`. After the F1 above, panelOpen=true was
    // persisted, so the panel re-mounts open after reload (which
    // is what we need to read aria-valuenow again).
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
