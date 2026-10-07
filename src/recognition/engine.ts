import { unionAll } from '../ink/geometry';
import type { BBox } from '../ink/types';
import { analyzeEquation, toDisplay, type EvalResult } from '../math';
import { classifyOperator } from './operators';
import { refineOneSeven } from './refine';
import { DEFAULT_RASTER, rasterize, type RasterOptions } from './rasterize';
import { lineMetrics, segmentLines, segmentSymbols, type SymbolGroup } from './segmentation';
import {
  DIGITS,
  type AnswerSummary,
  type Glyph,
  type LineResult,
  type RecognitionOutput,
  type StrokeData,
  type SymbolResult,
} from './types';

/** Maps a batch of 28×28 images to class probabilities (10 per image). */
export type DigitClassifier = (images: readonly Float32Array[]) => Promise<Float32Array[]>;

export function softmax(logits: ArrayLike<number>): Float32Array {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) max = Math.max(max, logits[i]!);
  const out = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    out[i] = Math.exp(logits[i]! - max);
    sum += out[i]!;
  }
  for (let i = 0; i < out.length; i++) out[i]! /= sum;
  return out;
}

const CACHE_LIMIT = 4000;
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

type Classified = Omit<SymbolResult, 'bbox' | 'strokeIds'>;

/** Turn an evaluation result into what the canvas should show. */
export function summarize(lineText: string): { answer: AnswerSummary | null } {
  const a = analyzeEquation(lineText);
  const fromResult = (r: EvalResult): AnswerSummary => {
    switch (r.kind) {
      case 'value':
        return {
          status: 'value',
          text: toDisplay(r.text),
          exact: r.exact,
          ...(r.value.isInteger() ? {} : { fraction: r.value.toFractionString().replace(/^-/, '−') }),
        };
      case 'undefined':
        return { status: 'undefined', text: 'Undefined', exact: true, message: r.message };
      case 'error':
        return { status: 'error', text: '?', exact: false, message: r.message };
    }
  };
  switch (a.mode) {
    case 'none':
      return { answer: null };
    case 'invalid':
      return { answer: { status: 'invalid', text: '?', exact: false, message: a.message } };
    case 'compute':
      return { answer: fromResult(a.result) };
    case 'check': {
      const expected = fromResult(a.result);
      if (a.correct === null) return { answer: expected.status === 'value' ? { ...expected, status: 'error', message: `Can't read the written answer` } : expected };
      return {
        answer: a.correct
          ? { ...expected, status: 'correct', message: 'Correct' }
          : { ...expected, status: 'incorrect', message: `Expected ${expected.text}` },
      };
    }
  }
}

/**
 * Stateful, incremental recognition engine (runs inside the Web Worker).
 *
 * The main thread streams stroke additions/removals; `recognize()` segments
 * the page into lines and symbols, classifies each symbol (geometry first,
 * then the CNN), and evaluates every line that contains "=". Because strokes
 * are immutable, a symbol's stroke-id set is a perfect cache key: after an
 * edit only the symbols that actually changed hit the network.
 */
export class RecognitionEngine {
  private readonly strokes = new Map<string, StrokeData>();
  private readonly cache = new Map<string, Classified>();

  constructor(
    private readonly classify: DigitClassifier,
    private readonly raster: RasterOptions = DEFAULT_RASTER,
  ) {}

  get strokeCount(): number {
    return this.strokes.size;
  }

  sync(add: readonly StrokeData[], remove: readonly string[]): void {
    for (const id of remove) this.strokes.delete(id);
    for (const s of add) this.strokes.set(s.id, s);
  }

  reset(): void {
    this.strokes.clear();
  }

  private remember(key: string, value: Classified): void {
    this.cache.delete(key);
    this.cache.set(key, value);
    if (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  async recognize(): Promise<RecognitionOutput> {
    const t0 = now();
    const all = [...this.strokes.values()];
    const lines = segmentLines(all).map((strokes) => {
      const metrics = lineMetrics(strokes);
      return { strokes, metrics, groups: segmentSymbols(strokes, metrics) };
    });
    const t1 = now();

    // Classify: cache → geometry → neural model (batched).
    const results = new Map<SymbolGroup, Classified>();
    const pending: SymbolGroup[] = [];
    let cacheHits = 0;
    for (const line of lines) {
      for (const g of line.groups) {
        const cached = this.cache.get(g.key);
        if (cached) {
          cacheHits++;
          results.set(g, cached);
          this.remember(g.key, cached);
          continue;
        }
        const geo = classifyOperator(g, line.metrics);
        if (geo) {
          const c: Classified = { char: geo.char, confidence: geo.confidence, source: 'geometry', alternatives: [] };
          results.set(g, c);
          this.remember(g.key, c);
        } else {
          pending.push(g);
        }
      }
    }

    const t2 = now();
    if (pending.length > 0) {
      const images = pending.map((g) => rasterize(g.strokes.map((s) => s.points), this.raster));
      const probs = await this.classify(images);
      pending.forEach((g, i) => {
        const p = probs[i]!;
        const ranked = refineOneSeven(g, DIGITS.map((char, k) => ({ char, p: p[k]! })).sort((a, b) => b.p - a.p));
        const c: Classified = {
          char: ranked[0]!.char,
          confidence: ranked[0]!.p,
          source: 'model',
          alternatives: ranked.slice(1, 3),
        };
        results.set(g, c);
        this.remember(g.key, c);
      });
    }
    const t3 = now();

    const out: LineResult[] = lines.map(({ strokes, metrics, groups }) => {
      const symbols: SymbolResult[] = groups.map((g) => ({
        ...results.get(g)!,
        bbox: g.bbox,
        strokeIds: g.strokes.map((s) => s.id),
      }));
      const text = symbols.map((s) => s.char).join('');
      const eqIndex = symbols.findIndex((s) => s.char === '=');
      const eq = eqIndex >= 0 ? symbols[eqIndex]! : null;
      const { answer } = summarize(text);
      const last = symbols[symbols.length - 1];
      const anchor: BBox | null =
        answer && (answer.status === 'correct' || answer.status === 'incorrect') ? (last?.bbox ?? null) : (eq?.bbox ?? null);
      return {
        key: eq ? `eq:${eq.strokeIds.slice().sort().join(',')}` : `ln:${strokes.map((s) => s.id).sort()[0]}`,
        bbox: unionAll(strokes.map((s) => s.bbox)),
        refHeight: metrics.refHeight,
        bandTop: metrics.bandTop,
        bandBottom: metrics.bandBottom,
        symbols,
        text,
        anchor,
        answer,
        confidence: symbols.reduce((m, s) => Math.min(m, s.confidence), 1),
      };
    });

    const t4 = now();
    return {
      lines: out,
      stats: {
        strokes: all.length,
        symbols: results.size,
        modelRuns: pending.length,
        cacheHits,
        segmentMs: t1 - t0,
        inferMs: t3 - t2,
        totalMs: t4 - t0,
      },
    };
  }
}

export type { Glyph };
