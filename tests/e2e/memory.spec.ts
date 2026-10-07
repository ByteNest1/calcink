import { expect, test } from '@playwright/test';
import { ready, write } from './helpers';

test.use({ launchOptions: { args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) } });

/**
 * Prolonged-session check: write, recognise, clear — many times. After the
 * warm-up rounds the UI-thread JS heap (measured after forced GC) must stay
 * flat: no leaked strokes, Path2D caches, listeners or result objects.
 */
test('memory stays flat over a prolonged drawing session', async ({ page }) => {
  await ready(page);
  const heap = async (): Promise<number> =>
    page.evaluate(async () => {
      const g = (window as unknown as { gc?: () => void }).gc;
      for (let i = 0; i < 3; i++) {
        g?.();
        await new Promise((r) => setTimeout(r, 50));
      }
      return (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
    });

  const samples: number[] = [];
  for (let round = 0; round < 10; round++) {
    await write(page, '123+456=', 140, 160, 48, round * 2 + 1);
    await write(page, '78×9−4=', 140, 320, 48, round * 2 + 2);
    await page.waitForFunction(() => window.__calcink.lines().filter((l) => l.answer).length >= 2, null, { timeout: 10_000 });
    await page.evaluate(() => window.__calcink.reset()); // clear page + history
    await page.waitForTimeout(400);
    samples.push(await heap());
  }
  const mb = samples.map((b) => +(b / 1048576).toFixed(2));
  console.log('heap after each round (MB):', mb.join(', '));
  const growth = samples[samples.length - 1]! - samples[2]!;
  expect(growth / 1048576).toBeLessThan(1.0);
});
