/**
 * Synthetic handwriting generator.
 *
 * Each glyph is described as one or more pen strokes through control points in
 * a unit box (x right, y down; digits are ~0.6 wide). `synthesize()` applies a
 * random affine "writer style" (slant, rotation, aspect, scale) plus per-point
 * jitter and Catmull-Rom smoothing, producing realistic, varied pen paths.
 * Used by unit tests, the accuracy benchmark and the Playwright E2E test
 * (which replays the paths as real mouse input).
 */

export type Pt = [number, number];
export type GlyphTemplate = Pt[][];

export const TEMPLATES: Record<string, GlyphTemplate[]> = {
  '0': [
    [[[0.5, 0], [0.18, 0.12], [0.05, 0.5], [0.18, 0.88], [0.5, 1], [0.82, 0.88], [0.95, 0.5], [0.82, 0.12], [0.5, 0], [0.42, 0.03]]],
  ],
  '1': [
    [[[0.55, 0], [0.55, 1]]],
    [[[0.25, 0.2], [0.6, 0], [0.6, 1]]],
  ],
  '2': [
    [[[0.1, 0.25], [0.3, 0.03], [0.62, 0], [0.88, 0.18], [0.85, 0.42], [0.55, 0.68], [0.1, 1], [0.95, 0.98]]],
  ],
  '3': [
    [[[0.12, 0.12], [0.45, 0], [0.82, 0.1], [0.82, 0.33], [0.45, 0.48], [0.88, 0.62], [0.88, 0.88], [0.5, 1], [0.1, 0.9]]],
  ],
  '4': [
    [
      [[0.62, 0], [0.08, 0.66], [0.95, 0.66]],
      [[0.7, 0.3], [0.7, 1]],
    ],
    [[[0.15, 0], [0.1, 0.58], [0.85, 0.58]], [[0.72, 0.05], [0.72, 1]]],
  ],
  '5': [
    [[[0.85, 0], [0.25, 0], [0.18, 0.45], [0.55, 0.38], [0.88, 0.58], [0.85, 0.88], [0.5, 1], [0.12, 0.9]]],
    [
      [[0.25, 0], [0.18, 0.45], [0.55, 0.38], [0.88, 0.58], [0.85, 0.88], [0.5, 1], [0.12, 0.9]],
      [[0.25, 0.02], [0.9, 0.02]],
    ],
  ],
  '6': [
    [[[0.78, 0], [0.4, 0.2], [0.15, 0.6], [0.22, 0.92], [0.5, 1], [0.82, 0.85], [0.82, 0.6], [0.5, 0.48], [0.17, 0.62]]],
  ],
  '7': [
    [[[0.08, 0.02], [0.92, 0], [0.4, 1]]],
    [[[0.08, 0.02], [0.92, 0], [0.4, 1]], [[0.3, 0.5], [0.8, 0.5]]],
  ],
  '8': [
    [[[0.78, 0.12], [0.5, 0], [0.22, 0.12], [0.24, 0.36], [0.5, 0.5], [0.82, 0.66], [0.82, 0.9], [0.5, 1], [0.18, 0.9], [0.18, 0.66], [0.5, 0.5], [0.76, 0.36], [0.78, 0.12]]],
  ],
  '9': [
    [[[0.85, 0.2], [0.55, 0], [0.2, 0.1], [0.15, 0.32], [0.45, 0.48], [0.82, 0.32], [0.85, 0.15], [0.82, 0.55], [0.75, 1]]],
  ],
  '+': [[[[0.0, 0.5], [1.0, 0.5]], [[0.5, 0.0], [0.5, 1.0]]]],
  '−': [[[[0.0, 0.5], [1.0, 0.5]]]],
  '×': [[[[0.05, 0.05], [0.95, 0.95]], [[0.95, 0.05], [0.05, 0.95]]]],
  '÷': [[[[0.0, 0.5], [1.0, 0.5]], [[0.5, 0.12]], [[0.5, 0.88]]]],
  '=': [[[[0.0, 0.3], [1.0, 0.3]], [[0.0, 0.72], [1.0, 0.72]]]],
  '.': [[[[0.5, 0.5]]]],
};

/** Box of each glyph relative to a digit cell of height 1: [width, height, yOffset]. */
const LAYOUT: Record<string, [number, number, number]> = {
  '+': [0.6, 0.6, 0.2],
  '−': [0.6, 0.6, 0.2],
  '×': [0.5, 0.5, 0.25],
  '÷': [0.6, 0.6, 0.2],
  '=': [0.6, 0.4, 0.3],
  '.': [0.05, 0.05, 0.92],
};
const DIGIT_WIDTH = 0.6;

/** Mulberry32 — tiny deterministic PRNG so tests are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function catmullRom(pts: Pt[], samplesPerSeg: number): Pt[] {
  if (pts.length < 3) {
    if (pts.length === 1) return [pts[0]!];
    const out: Pt[] = [];
    const [a, b] = pts as [Pt, Pt];
    const n = samplesPerSeg * 2;
    for (let i = 0; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
    return out;
  }
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    for (let k = 0; k < samplesPerSeg; k++) {
      const t = k / samplesPerSeg, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

export interface StyleOptions {
  /** Max slant (shear) magnitude */
  slant?: number;
  /** Max rotation in radians */
  rotation?: number;
  /** Control point jitter relative to glyph size */
  jitter?: number;
  variant?: number;
}

/** Render one glyph into absolute pen paths. `size` is the digit height in px. */
export function synthesize(char: string, x: number, y: number, size: number, rand: () => number, style: StyleOptions = {}): Pt[][] {
  const variants = TEMPLATES[char];
  if (!variants) throw new Error(`No template for ${char}`);
  const tpl = variants[style.variant ?? Math.floor(rand() * variants.length)]!;
  const [lw, lh, ly] = LAYOUT[char] ?? [DIGIT_WIDTH, 1, 0];
  const slant = ((rand() * 2 - 1) * (style.slant ?? 0.18));
  const rot = (rand() * 2 - 1) * (style.rotation ?? 0.08);
  const sx = lw * size * (0.85 + rand() * 0.3);
  const sy = lh * size * (0.9 + rand() * 0.2);
  const jit = style.jitter ?? 0.025;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return tpl.map((stroke) => {
    const ctrl: Pt[] = stroke.map(([u, v]) => [u + (rand() * 2 - 1) * jit, v + (rand() * 2 - 1) * jit]);
    const dense = catmullRom(ctrl, 8);
    return dense.map(([u, v]) => {
      const px = (u - 0.5) * sx + slant * (0.5 - v) * sy;
      const py = (v - 0.5) * sy;
      return [x + sx / 2 + px * cos - py * sin, y + ly * size + sy / 2 + px * sin + py * cos] as Pt;
    });
  });
}

/** Lay out a whole expression left-to-right, returning every pen stroke. */
export function synthesizeExpression(expr: string, x: number, y: number, size: number, seed = 1, style: StyleOptions = {}): Pt[][] {
  const rand = rng(seed);
  const strokes: Pt[][] = [];
  let cx = x;
  for (const ch of expr) {
    if (ch === ' ') {
      cx += size * 0.3;
      continue;
    }
    const [lw] = LAYOUT[ch] ?? [DIGIT_WIDTH, 1, 0];
    strokes.push(...synthesize(ch, cx, y, size, rand, style));
    cx += lw * size + size * (0.28 + rand() * 0.14);
  }
  return strokes;
}

/** Convert pen paths to the flat `[x, y, p]` layout used by the app. */
export function toFlat(path: Pt[]): Float32Array {
  const out = new Float32Array(path.length * 3);
  path.forEach(([x, y], i) => {
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = 0.5;
  });
  return out;
}
