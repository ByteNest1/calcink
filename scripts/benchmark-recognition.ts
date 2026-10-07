/**
 * Offline recognition benchmark.
 *
 *   npm run bench            # per-glyph + full-expression accuracy
 *   npm run bench -- --json  # also writes docs/benchmark.json
 *
 * Runs the exact production pipeline (segmentation → geometry analyser →
 * rasteriser → MNIST-12 via onnxruntime-web WASM) under Node on thousands of
 * synthetic handwritten samples with randomised writer styles.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-web';
import { RecognitionEngine } from '../src/recognition/engine';
import { rasterize } from '../src/recognition/rasterize';
import { createOrtClassifier } from '../src/recognition/ortClassifier';
import { bboxOfPoints } from '../src/ink/geometry';
import type { StrokeData } from '../src/recognition/types';
import { rng, synthesize, synthesizeExpression, toFlat, type Pt } from '../tests/fixtures/handwriting';

const root = fileURLToPath(new URL('..', import.meta.url));
const GLYPHS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '−', '×', '÷', '=', '.'];
const SAMPLES = Number(process.env.SAMPLES ?? 150);
/** `STYLE=hard` roughly doubles slant, rotation and jitter. */
const STYLE = process.env.STYLE === 'hard' ? { slant: 0.35, rotation: 0.18, jitter: 0.06 } : { slant: 0.22, rotation: 0.1, jitter: 0.035 };

let uid = 0;
function toStrokes(paths: Pt[][]): StrokeData[] {
  return paths.map((p) => {
    const points = toFlat(p);
    return { id: `b${uid++}`, points, bbox: bboxOfPoints(points) };
  });
}

function randomExpression(rand: () => number): string {
  const num = (): string => {
    const digits = 1 + Math.floor(rand() * 3);
    let s = String(1 + Math.floor(rand() * 9));
    for (let i = 1; i < digits; i++) s += String(Math.floor(rand() * 10));
    if (rand() < 0.15) s += '.' + String(Math.floor(rand() * 10));
    return s;
  };
  const ops = ['+', '−', '×', '÷'];
  let e = num();
  const terms = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < terms; i++) e += ops[Math.floor(rand() * ops.length)] + num();
  return e + '=';
}

async function main(): Promise<void> {
  const model = readFileSync(`${root}public/models/mnist-12.onnx`);
  const session = await ort.InferenceSession.create(model);
  const engine = new RecognitionEngine(createOrtClassifier(ort, session));

  // 0. Real human handwriting: MNIST digits skeletonised back to pen centre lines.
  const fixture = JSON.parse(readFileSync(`${root}tests/fixtures/mnist-skeletons.json`, 'utf8')) as { samples: [number, string][] };
  const classify = createOrtClassifier(ort, session);
  const realImgs = fixture.samples.map(([, b64]) => {
    const bytes = Buffer.from(b64, 'base64');
    const dots: Float32Array[] = [];
    for (let i = 0; i < bytes.length; i += 2) dots.push(Float32Array.from([bytes[i]! * 3, bytes[i + 1]! * 3, 0.5]));
    return rasterize(dots);
  });
  const realProbs = await classify(realImgs);
  let realOk = 0;
  realProbs.forEach((p, i) => {
    let best = 0;
    for (let k = 1; k < 10; k++) if (p[k]! > p[best]!) best = k;
    if (best === fixture.samples[i]![0]) realOk++;
  });
  const realAcc = realOk / realProbs.length;

  // 1. Isolated glyphs.
  const perGlyph: Record<string, { n: number; ok: number; confusions: Record<string, number> }> = {};
  const rand = rng(42);
  for (const g of GLYPHS) {
    const stat = { n: 0, ok: 0, confusions: {} as Record<string, number> };
    for (let i = 0; i < SAMPLES; i++) {
      const size = 30 + rand() * 60;
      // Put a reference digit next to operators so the line has a writing height.
      const paths = synthesize(g, 200, 100, size, rand, STYLE);
      const ctx = g === '.' || '+−×÷='.includes(g) ? synthesize('8', 200 - size, 100, size, rand, STYLE) : [];
      engine.reset();
      engine.sync(toStrokes([...ctx, ...paths]), []);
      const out = await engine.recognize();
      const text = out.lines.map((l) => l.text).join('|');
      const got = ctx.length ? text.slice(1) : text;
      stat.n++;
      if (got === g) stat.ok++;
      else stat.confusions[got] = (stat.confusions[got] ?? 0) + 1;
    }
    perGlyph[g] = stat;
  }

  // 2. Full expressions.
  const exprRand = rng(7);
  let exprN = 0;
  let exprOk = 0;
  let totalMs = 0;
  const failures: string[] = [];
  for (let i = 0; i < SAMPLES * 2; i++) {
    const expr = randomExpression(exprRand);
    const paths = synthesizeExpression(expr, 40, 80, 36 + exprRand() * 40, 1000 + i, STYLE);
    engine.reset();
    engine.sync(toStrokes(paths), []);
    const out = await engine.recognize();
    totalMs += out.stats.totalMs;
    exprN++;
    const text = out.lines.map((l) => l.text).join('|');
    if (text === expr) exprOk++;
    else if (failures.length < 12) failures.push(`${expr}  →  ${text}`);
  }

  const rows = GLYPHS.map((g) => {
    const s = perGlyph[g]!;
    const top = Object.entries(s.confusions).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k || '∅'}×${v}`).join(' ');
    return { glyph: g, accuracy: s.ok / s.n, samples: s.n, confusions: top };
  });
  const glyphAcc = rows.reduce((a, r) => a + r.accuracy, 0) / rows.length;

  console.log(`\nPer-glyph accuracy — style=${process.env.STYLE ?? 'normal'} (synthetic handwriting, randomised slant/rotation/jitter/size)\n`);
  for (const r of rows) console.log(`  ${r.glyph.padEnd(3)} ${(r.accuracy * 100).toFixed(1).padStart(6)}%   ${r.confusions}`);
  console.log(`\n  real MNIST handwriting (skeleton → strokes → rasteriser → model): ${(realAcc * 100).toFixed(2)}% (n=${realProbs.length})`);
  console.log(`  mean glyph accuracy: ${(glyphAcc * 100).toFixed(2)}%`);
  console.log(`  full-expression exact match: ${((exprOk / exprN) * 100).toFixed(2)}% (${exprOk}/${exprN})`);
  console.log(`  mean pipeline latency per expression (Node, WASM): ${(totalMs / exprN).toFixed(2)} ms`);
  if (failures.length) console.log('\n  sample failures:\n   ' + failures.join('\n   '));

  if (process.argv.includes('--json')) {
    writeFileSync(
      `${root}docs/benchmark.json`,
      JSON.stringify({ style: process.env.STYLE ?? 'normal', realMnistSkeletonAccuracy: realAcc, samplesPerGlyph: SAMPLES, glyphs: rows, meanGlyphAccuracy: glyphAcc, expressionAccuracy: exprOk / exprN, expressions: exprN, meanLatencyMs: totalMs / exprN }, null, 2) + '\n',
    );
    console.log('\n  wrote docs/benchmark.json');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
