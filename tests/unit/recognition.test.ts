import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-web';
import { beforeAll, describe, expect, it } from 'vitest';
import { bboxOfPoints } from '../../src/ink/geometry';
import { RecognitionEngine, softmax, summarize } from '../../src/recognition/engine';
import { classifyOperator } from '../../src/recognition/operators';
import { createOrtClassifier } from '../../src/recognition/ortClassifier';
import { centerOfMass, MODEL_SIZE, measureSlant, rasterize, shearStrokes } from '../../src/recognition/rasterize';
import { lineMetrics, segmentLines, segmentSymbols } from '../../src/recognition/segmentation';
import type { StrokeData } from '../../src/recognition/types';
import { rng, synthesize, synthesizeExpression, toFlat, type Pt } from '../fixtures/handwriting';

let uid = 0;
const toStrokes = (paths: Pt[][]): StrokeData[] =>
  paths.map((p) => {
    const points = toFlat(p);
    return { id: `t${uid++}`, points, bbox: bboxOfPoints(points) };
  });

const symbolsOf = (expr: string, seed = 1) => {
  const strokes = toStrokes(synthesizeExpression(expr, 20, 20, 50, seed));
  const m = lineMetrics(strokes);
  return { groups: segmentSymbols(strokes, m), metrics: m };
};

describe('segmentation', () => {
  it('splits strokes into separate lines', () => {
    const a = synthesizeExpression('12+3=', 20, 20, 40, 1);
    const b = synthesizeExpression('7×8=', 20, 120, 40, 2);
    const lines = segmentLines(toStrokes([...a, ...b]));
    expect(lines).toHaveLength(2);
    expect(lines[0]!.length).toBe(a.length);
  });

  it('keeps two equations on the same row apart when far away', () => {
    const a = synthesizeExpression('1+1=', 20, 20, 40, 1);
    const b = synthesizeExpression('2+2=', 600, 20, 40, 2);
    expect(segmentLines(toStrokes([...a, ...b]))).toHaveLength(2);
  });

  it('groups multi-stroke glyphs into one symbol each', () => {
    // "4" (2 strokes), "+" (2), "=" (2), "÷" (3)
    const { groups } = symbolsOf('4+4÷4=');
    expect(groups).toHaveLength(6);
    expect(groups.map((g) => g.strokes.length)).toEqual([2, 2, 2, 3, 2, 2]);
  });

  it('keeps a decimal point as its own symbol', () => {
    const { groups } = symbolsOf('3.5');
    expect(groups).toHaveLength(3);
  });

  it('orders symbols left to right', () => {
    const { groups } = symbolsOf('9−8');
    const xs = groups.map((g) => g.bbox.minX);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });
});

describe('geometric operator analyser', () => {
  it.each([
    ['+', '+'],
    ['−', '−'],
    ['×', '×'],
    ['÷', '÷'],
    ['=', '='],
    ['.', '.'],
  ])('recognises %s', (glyph, expected) => {
    for (let seed = 1; seed <= 25; seed++) {
      const { groups, metrics } = symbolsOf(`8${glyph}8`, seed);
      expect(groups).toHaveLength(3);
      expect(classifyOperator(groups[1]!, metrics)?.char).toBe(expected);
    }
  });

  it('leaves digits to the neural model', () => {
    for (const d of '0123456789') {
      const { groups, metrics } = symbolsOf(d, 3);
      expect(classifyOperator(groups[0]!, metrics)).toBeNull();
    }
  });

  it('does not mistake a two-stroke 7 for a plus', () => {
    const paths = synthesize('7', 0, 0, 60, rng(4), { variant: 1 });
    const strokes = toStrokes(paths);
    const m = lineMetrics(strokes);
    const groups = segmentSymbols(strokes, m);
    expect(groups).toHaveLength(1);
    expect(classifyOperator(groups[0]!, m)).toBeNull();
  });
});

describe('rasteriser', () => {
  const one = (p: Pt[][]) => p.map(toFlat);

  it('produces a 28×28 image in [0, 1]', () => {
    const img = rasterize(one(synthesize('8', 0, 0, 80, rng(1))));
    expect(img).toHaveLength(MODEL_SIZE * MODEL_SIZE);
    expect(Math.max(...img)).toBeLessThanOrEqual(1);
    expect(Math.min(...img)).toBeGreaterThanOrEqual(0);
  });

  it('centres ink by centre of mass like MNIST', () => {
    const com = centerOfMass(rasterize(one(synthesize('2', 500, 300, 120, rng(2)))));
    expect(com.x).toBeCloseTo(14, 0);
    expect(com.y).toBeCloseTo(14, 0);
  });

  it('is invariant to where and how large the digit is written', () => {
    const a = rasterize(one(synthesize('5', 0, 0, 40, rng(9))));
    const b = rasterize(one(synthesize('5', 900, 700, 160, rng(9))));
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i]! - b[i]!);
    expect(diff / a.length).toBeLessThan(0.02);
  });

  it('measures and removes slant', () => {
    const slanted = one(synthesize('1', 0, 0, 100, rng(1), { slant: 0, rotation: 0, variant: 0 })).map((p) => shearStrokes([p], 0.4)[0]!);
    expect(measureSlant(slanted)).toBeLessThan(-0.2);
    expect(Math.abs(measureSlant(shearStrokes(slanted, measureSlant(slanted))))).toBeLessThan(0.05);
  });

  it('handles a single tap without NaNs', () => {
    const img = rasterize([Float32Array.from([10, 10, 0.5])]);
    expect(img.some((v) => Number.isNaN(v))).toBe(false);
    expect(img.some((v) => v > 0)).toBe(true);
  });
});

describe('answer summaries', () => {
  it('formats values, Undefined and errors for projection', () => {
    expect(summarize('18+4×3=').answer).toMatchObject({ status: 'value', text: '30' });
    expect(summarize('3−10=').answer).toMatchObject({ text: '−7' });
    expect(summarize('1÷4=').answer).toMatchObject({ text: '0.25', fraction: '1/4' });
    expect(summarize('7÷0=').answer).toMatchObject({ status: 'undefined', text: 'Undefined' });
    expect(summarize('7×=').answer).toMatchObject({ status: 'error' });
    expect(summarize('2+2=4').answer).toMatchObject({ status: 'correct' });
    expect(summarize('2+2=5').answer).toMatchObject({ status: 'incorrect', text: '4' });
    expect(summarize('2+2').answer).toBeNull();
  });

  it('softmax is a probability distribution', () => {
    const p = softmax([1, 2, 3, 1000]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(p[3]).toBeCloseTo(1, 6);
  });
});

describe('end-to-end pipeline with the real ONNX model (WASM)', () => {
  let engine: RecognitionEngine;
  beforeAll(async () => {
    const model = readFileSync(fileURLToPath(new URL('../../public/models/mnist-12.onnx', import.meta.url)));
    const session = await ort.InferenceSession.create(model);
    engine = new RecognitionEngine(createOrtClassifier(ort, session));
  });

  it.each([
    ['18+4×3=', '30'],
    ['2.5×4=', '10'],
    ['9−12=', '−3'],
    ['100÷8=', '12.5'],
    ['6÷0=', 'Undefined'],
    ['7+3×2−1=', '12'],
  ])('reads "%s" and answers %s', async (expr, answer) => {
    engine.reset();
    engine.sync(toStrokes(synthesizeExpression(expr, 40, 60, 56, 11)), []);
    const out = await engine.recognize();
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]!.text).toBe(expr);
    expect(out.lines[0]!.answer?.text).toBe(answer);
    expect(out.lines[0]!.anchor).not.toBeNull();
  });

  it('re-evaluates reactively when a number is erased and replaced', async () => {
    engine.reset();
    const strokes = toStrokes(synthesizeExpression('5+3=', 40, 60, 56, 5));
    engine.sync(strokes, []);
    expect((await engine.recognize()).lines[0]!.answer?.text).toBe('8');
    // Erase the "3" (strokes of the 3rd symbol) and write a "9" in its place.
    const { groups } = (() => {
      const m = lineMetrics(strokes);
      return { groups: segmentSymbols(strokes, m) };
    })();
    const three = groups[2]!;
    const nine = toStrokes([synthesize('9', three.bbox.minX, three.bbox.minY, 56, rng(3))].flat());
    engine.sync(nine, three.strokes.map((s) => s.id));
    const out = await engine.recognize();
    expect(out.lines[0]!.text).toBe('5+9=');
    expect(out.lines[0]!.answer?.text).toBe('14');
  });

  it('only re-runs the model for symbols that changed', async () => {
    engine.reset();
    engine.sync(toStrokes(synthesizeExpression('123+456=', 40, 60, 56, 8)), []);
    const first = await engine.recognize();
    expect(first.stats.modelRuns).toBe(6);
    const again = await engine.recognize();
    expect(again.stats.modelRuns).toBe(0);
    expect(again.stats.cacheHits).toBe(first.stats.symbols);
  });

  it('handles several equations on one page independently', async () => {
    engine.reset();
    engine.sync(
      toStrokes([
        ...synthesizeExpression('1+2=', 40, 60, 50, 1),
        ...synthesizeExpression('8×7=', 40, 200, 50, 2),
        ...synthesizeExpression('5−9', 40, 340, 50, 3),
      ]),
      [],
    );
    const out = await engine.recognize();
    expect(out.lines.map((l) => l.answer?.text ?? null)).toEqual(['3', '56', null]);
  });

  it('survives an empty page', async () => {
    engine.reset();
    const out = await engine.recognize();
    expect(out.lines).toEqual([]);
  });
});
