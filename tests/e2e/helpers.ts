import type { Page } from '@playwright/test';
import { synthesizeExpression, type Pt, type StyleOptions } from '../fixtures/handwriting';

export interface LineInfo {
  text: string;
  answer: { status: string; text: string } | null;
  confidence: number;
}

declare global {
  interface Window {
    __calcink: {
      lines(): LineInfo[];
      model(): { kind: string };
      strokes(): number;
      history(): { undo: number; redo: number };
      perf(): { fps: number; p95: number; max: number; longTasks: number; longTaskMax: number; renderP95: number };
      startPerfSampling(): void;
      resetPerf(): void;
      setTool(t: string): void;
      reset(): void;
    };
  }
}

/** Replay pen paths as real mouse input (down → moves → up). */
export async function drawPaths(page: Page, paths: Pt[][], stepDelayMs = 0): Promise<void> {
  for (const path of paths) {
    const [x0, y0] = path[0]!;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i < path.length; i++) {
      await page.mouse.move(path[i]![0], path[i]![1]);
      if (stepDelayMs) await page.waitForTimeout(stepDelayMs);
    }
    await page.mouse.up();
  }
}

export async function write(page: Page, expr: string, x: number, y: number, size = 56, seed = 3, style: StyleOptions = {}): Promise<void> {
  await drawPaths(page, synthesizeExpression(expr, x, y, size, seed, style));
}

export async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__calcink?.model().kind === 'ready', null, { timeout: 30_000 });
  await page.evaluate(() => window.__calcink.reset());
}

/** Wait until the recogniser reports a line whose answer text matches. */
export async function expectAnswer(page: Page, lineText: string, answer: string): Promise<void> {
  await page.waitForFunction(
    ([t, a]) => window.__calcink.lines().some((l) => l.text === t && l.answer?.text === a),
    [lineText, answer] as const,
    { timeout: 10_000 },
  );
}

export const lines = (page: Page): Promise<LineInfo[]> => page.evaluate(() => window.__calcink.lines());
