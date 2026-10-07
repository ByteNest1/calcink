import { bboxOfPoints, unionAll } from '../ink/geometry';
import { POINT_STRIDE } from '../ink/types';

/**
 * Vector ink → MNIST-style input tensor.
 *
 * MNIST digits were produced by fitting each digit into a 20×20 box
 * (aspect ratio preserved), anti-aliasing, and then translating it so its
 * centre of mass sits at the centre of a 28×28 frame. We reproduce that
 * normalisation directly from stroke coordinates instead of resampling a
 * screenshot of the canvas, which makes recognition independent of the
 * screen DPR, pen width, zoom and the paper texture behind the ink.
 */

export const MODEL_SIZE = 28;
export const FIT_BOX = 20;

export interface RasterOptions {
  /** Pen radius in model pixels. MNIST strokes are ~2–3 px wide. */
  penRadius: number;
  /** Width of the anti-aliased edge falloff, in model pixels. */
  softness: number;
  /** Re-centre by centre of mass (as MNIST does). */
  centerOfMass: boolean;
  /**
   * Fraction of the measured slant to remove before rasterising (0 = off,
   * 1 = fully upright). Applied as an exact shear on the vector strokes.
   */
  deskew: number;
}

export const DEFAULT_RASTER: RasterOptions = {
  penRadius: 1.0,
  softness: 1.0,
  centerOfMass: true,
  deskew: 0.5,
};

/**
 * Estimate handwriting slant from second-order moments of the ink
 * (shear = μ11 / μ02), the classic MNIST deskewing statistic, computed on
 * the polyline points weighted by segment length.
 */
export function measureSlant(strokes: readonly Float32Array[]): number {
  let sw = 0, sx = 0, sy = 0;
  const acc: Array<[number, number, number]> = [];
  for (const pts of strokes) {
    const n = pts.length / POINT_STRIDE;
    for (let i = 0; i < n; i++) {
      const x = pts[i * POINT_STRIDE]!, y = pts[i * POINT_STRIDE + 1]!;
      const nx = i + 1 < n ? pts[(i + 1) * POINT_STRIDE]! : x;
      const ny = i + 1 < n ? pts[(i + 1) * POINT_STRIDE + 1]! : y;
      const w = n === 1 ? 1 : Math.hypot(nx - x, ny - y);
      if (w === 0) continue;
      acc.push([(x + nx) / 2, (y + ny) / 2, w]);
      sw += w; sx += w * ((x + nx) / 2); sy += w * ((y + ny) / 2);
    }
  }
  if (sw === 0) return 0;
  const mx = sx / sw, my = sy / sw;
  let mu11 = 0, mu02 = 0;
  for (const [x, y, w] of acc) {
    mu11 += w * (x - mx) * (y - my);
    mu02 += w * (y - my) * (y - my);
  }
  if (mu02 < 1e-6) return 0;
  return Math.max(-1, Math.min(1, mu11 / mu02));
}

/** Shear strokes horizontally about their vertical centre: x' = x − k·(y − cy). */
export function shearStrokes(strokes: readonly Float32Array[], k: number): Float32Array[] {
  if (k === 0) return strokes as Float32Array[];
  const box = unionAll(strokes.map((s) => bboxOfPoints(s)));
  const cy = (box.minY + box.maxY) / 2;
  return strokes.map((pts) => {
    const out = pts.slice();
    for (let i = 0; i < out.length; i += POINT_STRIDE) out[i] = out[i]! - k * (out[i + 1]! - cy);
    return out;
  });
}

interface Transform {
  scale: number;
  dx: number;
  dy: number;
}

function draw(strokes: readonly Float32Array[], t: Transform, opts: RasterOptions, out: Float32Array): void {
  out.fill(0);
  const r = opts.penRadius;
  const soft = opts.softness;
  const reach = r + soft;
  const N = MODEL_SIZE;

  const plot = (ax: number, ay: number, bx: number, by: number): void => {
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach));
    const x1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx) + reach));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - reach));
    const y1 = Math.min(N - 1, Math.ceil(Math.max(ay, by) + reach));
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let py = y0; py <= y1; py++) {
      const cy = py + 0.5;
      for (let px = x0; px <= x1; px++) {
        const cx = px + 0.5;
        let u = len2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy) / len2 : 0;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const ex = ax + u * dx - cx;
        const ey = ay + u * dy - cy;
        const d = Math.sqrt(ex * ex + ey * ey);
        if (d >= reach) continue;
        const v = d <= r ? 1 : 1 - (d - r) / soft;
        const idx = py * N + px;
        if (v > out[idx]!) out[idx] = v;
      }
    }
  };

  for (const pts of strokes) {
    const n = pts.length / POINT_STRIDE;
    if (n === 0) continue;
    const X = (i: number): number => pts[i * POINT_STRIDE]! * t.scale + t.dx;
    const Y = (i: number): number => pts[i * POINT_STRIDE + 1]! * t.scale + t.dy;
    if (n === 1) {
      plot(X(0), Y(0), X(0), Y(0));
      continue;
    }
    for (let i = 0; i < n - 1; i++) plot(X(i), Y(i), X(i + 1), Y(i + 1));
  }
}

/** Centre of mass of a 28×28 image (pixel-centre coordinates). */
export function centerOfMass(img: Float32Array): { x: number; y: number; mass: number } {
  let sx = 0;
  let sy = 0;
  let m = 0;
  for (let y = 0; y < MODEL_SIZE; y++) {
    for (let x = 0; x < MODEL_SIZE; x++) {
      const v = img[y * MODEL_SIZE + x]!;
      sx += v * (x + 0.5);
      sy += v * (y + 0.5);
      m += v;
    }
  }
  return m > 0 ? { x: sx / m, y: sy / m, mass: m } : { x: MODEL_SIZE / 2, y: MODEL_SIZE / 2, mass: 0 };
}

/**
 * Rasterise a group of strokes (flat `[x, y, p, …]` arrays in world space)
 * into a 28×28 Float32Array with values in [0, 1] — white ink on black,
 * exactly the layout the MNIST model expects for its `1×1×28×28` input.
 */
export function rasterize(strokes: readonly Float32Array[], opts: RasterOptions = DEFAULT_RASTER): Float32Array {
  const out = new Float32Array(MODEL_SIZE * MODEL_SIZE);
  if (strokes.length === 0) return out;
  if (opts.deskew !== 0) strokes = shearStrokes(strokes, opts.deskew * measureSlant(strokes));
  const box = unionAll(strokes.map((s) => bboxOfPoints(s)));
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const extent = Math.max(w, h);
  // Inner fit box shrinks by the pen radius so the inked digit spans ~20 px.
  const inner = FIT_BOX - 2 * opts.penRadius;
  const scale = extent > 1e-6 ? inner / extent : 1;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const t: Transform = { scale, dx: MODEL_SIZE / 2 - cx * scale, dy: MODEL_SIZE / 2 - cy * scale };
  draw(strokes, t, opts, out);
  if (opts.centerOfMass) {
    const com = centerOfMass(out);
    if (com.mass > 0) {
      t.dx += MODEL_SIZE / 2 - com.x;
      t.dy += MODEL_SIZE / 2 - com.y;
      draw(strokes, t, opts, out);
    }
  }
  return out;
}

/** Debug helper: ASCII-art preview of a model input. */
export function toAscii(img: Float32Array): string {
  const ramp = ' .:-=+*#%@';
  let s = '';
  for (let y = 0; y < MODEL_SIZE; y++) {
    for (let x = 0; x < MODEL_SIZE; x++) s += ramp[Math.min(9, Math.floor(img[y * MODEL_SIZE + x]! * 9.99))];
    s += '\n';
  }
  return s;
}
