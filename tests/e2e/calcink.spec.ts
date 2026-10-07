import { expect, test } from '@playwright/test';
import { drawPaths, expectAnswer, lines, ready, write } from './helpers';
import { synthesize, rng } from '../fixtures/handwriting';

test.describe('CalcInk', () => {
  test.beforeEach(async ({ page }) => {
    await ready(page);
  });

  test('loads the on-device model in a worker and shows the empty state', async ({ page }) => {
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('#hint')).toBeVisible();
    // Three DPR-scaled canvas layers.
    const sizes = await page.$$eval('#paper canvas', (cs) => cs.map((c) => [c.width, c.clientWidth]));
    expect(sizes).toHaveLength(3);
    for (const [w, cw] of sizes) expect(w).toBe(cw! * 2);
  });

  test('writes the answer next to "=" (BODMAS)', async ({ page }) => {
    await write(page, '18+4×3=', 160, 220);
    await expectAnswer(page, '18+4×3=', '30');
    await expect(page.locator('#hint')).toBeHidden();
    await page.waitForTimeout(600); // let the write-in animation finish
    await page.screenshot({ path: 'test-results/screenshots/answer.png' });
  });

  test('handles decimals, negatives and several equations at once', async ({ page }) => {
    await write(page, '2.5×4=', 160, 140, 56, 4);
    await write(page, '9−12=', 160, 300, 56, 5);
    await write(page, '100÷8=', 160, 460, 56, 6);
    await expectAnswer(page, '2.5×4=', '10');
    await expectAnswer(page, '9−12=', '−3');
    await expectAnswer(page, '100÷8=', '12.5');
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'test-results/screenshots/multi.png' });
  });

  test('shows Undefined for division by zero', async ({ page }) => {
    await write(page, '7÷0=', 160, 220);
    await expectAnswer(page, '7÷0=', 'Undefined');
  });

  test('re-evaluates when a number is erased and rewritten', async ({ page }) => {
    await write(page, '5+3=', 160, 220, 60, 9);
    await expectAnswer(page, '5+3=', '8');
    // Stroke-erase the "3" with a swipe through it, then write a 9 there.
    const three = await page.evaluate(() => window.__calcink.lines()[0]);
    expect(three?.text).toBe('5+3=');
    await page.keyboard.press('e');
    const box = await page.evaluate(() => (window as unknown as { __calcink: { lines(): Array<{ anchor: { minX: number } }> } }).__calcink.lines()[0]!.anchor);
    // The "3" sits just left of the "=" anchor.
    const x = box.minX - 40;
    await page.mouse.move(x, 200);
    await page.mouse.down();
    await page.mouse.move(x, 300, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.press('p');
    await drawPaths(page, synthesize('9', x - 20, 222, 60, rng(2)));
    await expectAnswer(page, '5+9=', '14');
  });

  test('undo / redo restore the page and the answer', async ({ page }) => {
    await write(page, '6×7=', 160, 220);
    await expectAnswer(page, '6×7=', '42');
    const n = await page.evaluate(() => window.__calcink.strokes());
    await page.keyboard.press('Control+z'); // removes the second "=" bar
    await page.waitForFunction(() => window.__calcink.lines().every((l) => l.answer === null || l.text !== '6×7='));
    expect(await page.evaluate(() => window.__calcink.strokes())).toBe(n - 1);
    await page.keyboard.press('Control+Shift+z');
    await expectAnswer(page, '6×7=', '42');
  });

  test('clear is undoable', async ({ page }) => {
    await write(page, '1+1=', 160, 220);
    await expectAnswer(page, '1+1=', '2');
    await page.getByRole('button', { name: 'Clear page' }).click();
    expect(await page.evaluate(() => window.__calcink.strokes())).toBe(0);
    await expect(page.locator('#toast')).toContainText('Page cleared');
    await page.locator('#toast button').click();
    await expectAnswer(page, '1+1=', '2');
  });

  test('pixel eraser splits strokes and is a single undo step', async ({ page }) => {
    await page.mouse.move(200, 300);
    await page.mouse.down();
    await page.mouse.move(600, 300, { steps: 30 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.__calcink.strokes())).toBe(1);
    await page.keyboard.press('x');
    await page.mouse.move(400, 250);
    await page.mouse.down();
    await page.mouse.move(400, 350, { steps: 10 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.__calcink.strokes())).toBe(2);
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.__calcink.strokes())).toBe(1);
  });

  test('scratch-out gesture deletes the ink underneath', async ({ page }) => {
    await write(page, '42', 200, 220);
    const before = await page.evaluate(() => window.__calcink.strokes());
    expect(before).toBeGreaterThan(0);
    const zig: [number, number][] = [];
    for (let i = 0; i <= 64; i++) {
      const t = i / 8;
      const phase = t % 2 < 1 ? t % 1 : 1 - (t % 1);
      zig.push([190 + phase * 110, 215 + (70 * i) / 64]);
    }
    await drawPaths(page, [zig]);
    expect(await page.evaluate(() => window.__calcink.strokes())).toBe(0);
    await expect(page.locator('#toast')).toContainText('Scratched out');
  });

  test('checks a user-written answer', async ({ page }) => {
    await write(page, '2+2=5', 160, 220, 56, 12);
    await page.waitForFunction(() => window.__calcink.lines().some((l) => l.text === '2+2=5' && l.answer?.status === 'incorrect'));
    await write(page, '3×3=9', 160, 400, 56, 13);
    await page.waitForFunction(() => window.__calcink.lines().some((l) => l.text === '3×3=9' && l.answer?.status === 'correct'));
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'test-results/screenshots/check.png' });
  });

  test('insight view and hover card explain recognition', async ({ page }) => {
    await write(page, '12÷4=', 160, 220);
    await expectAnswer(page, '12÷4=', '3');
    await page.keyboard.press('i');
    await expect(page.getByRole('button', { name: 'Show what CalcInk sees' })).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(900, 600);
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'test-results/screenshots/insight.png' });
    // Hover over the answer for the explanation card.
    await page.keyboard.press('i');
    const anchor = await page.evaluate(() => (window as unknown as { __calcink: { lines(): Array<{ anchor: { maxX: number; minY: number; maxY: number } }> } }).__calcink.lines()[0]!.anchor);
    await page.mouse.move(anchor.maxX + 30, (anchor.minY + anchor.maxY) / 2);
    await expect(page.locator('#hovercard')).toBeVisible();
    await expect(page.locator('#hovercard')).toContainText('Recognition confidence');
    await page.screenshot({ path: 'test-results/screenshots/hovercard.png' });
  });

  test('persists the notebook across reloads', async ({ page }) => {
    await write(page, '8−3=', 160, 220);
    await expectAnswer(page, '8−3=', '5');
    await page.waitForTimeout(700); // debounced save
    await page.reload();
    await page.waitForFunction(() => window.__calcink?.model().kind === 'ready');
    await expectAnswer(page, '8−3=', '5');
  });

  test('stays at 60 FPS with no long tasks while recognition runs', async ({ page }) => {
    await page.evaluate(() => window.__calcink.startPerfSampling());
    // Seed the page so every recognition pass has real work to do.
    await write(page, '123+456=', 140, 140, 50, 21);
    await write(page, '78×9=', 140, 300, 50, 22);
    await page.evaluate(() => window.__calcink.resetPerf());
    // Keep writing continuously (recognition fires between strokes).
    for (let k = 0; k < 4; k++) {
      await write(page, '5+6=', 140 + k * 260, 470, 46, 30 + k);
    }
    const perf = await page.evaluate(() => window.__calcink.perf());
    console.log('perf during writing + recognition:', JSON.stringify(perf));
    expect(perf.longTasks).toBe(0);
    expect(perf.renderP95).toBeLessThan(8);
    expect(perf.p95).toBeLessThan(25);
  });
});
