import { expect, test } from '@playwright/test';
import { expectAnswer, ready, write } from './helpers';

/**
 * Airplane-mode check: after the first visit the service worker has
 * precached the app shell, WASM runtime, model and fonts. We cut the
 * network, reload, and the whole pipeline must still work — and no request
 * may leave the browser.
 */
test('works fully offline after the first visit (airplane mode)', async ({ page, context }) => {
  await ready(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Reload once so the page is controlled by the service worker.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20_000 });

  await context.setOffline(true);
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost:4173')) external.push(r.url());
  });
  await page.reload();
  await page.waitForFunction(() => window.__calcink?.model().kind === 'ready', null, { timeout: 30_000 });
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(page.locator('#status')).toContainText('Offline');

  await page.evaluate(() => window.__calcink.reset());
  await write(page, '9×8−2=', 160, 220);
  await expectAnswer(page, '9×8−2=', '70');
  expect(external).toEqual([]);
  await context.setOffline(false);
});
