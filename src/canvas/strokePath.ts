import { getStroke, type StrokeOptions } from 'perfect-freehand';
import { POINT_STRIDE, type Stroke } from '../ink/types';

/**
 * Ink appearance: a fountain-pen-like nib. Real stylus pressure modulates the
 * width when available; for mouse/touch the width is simulated from velocity.
 */
export function inkOptions(width: number, realPressure: boolean, complete: boolean): StrokeOptions {
  return {
    size: width,
    thinning: realPressure ? 0.6 : 0.45,
    smoothing: 0.55,
    streamline: 0.4,
    simulatePressure: !realPressure,
    last: complete,
    start: { taper: 0, cap: true },
    end: { taper: 0, cap: true },
  };
}

export function toInputPoints(points: ArrayLike<number>, count = points.length / POINT_STRIDE): number[][] {
  const out: number[][] = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * POINT_STRIDE;
    out[i] = [points[o]!, points[o + 1]!, points[o + 2]!];
  }
  return out;
}

/** Outline polygon (filled shape) of a stroke. */
export function strokeOutline(points: ArrayLike<number>, width: number, realPressure: boolean, complete: boolean): number[][] {
  return getStroke(toInputPoints(points), inkOptions(width, realPressure, complete));
}

/**
 * Trace an outline polygon as a chain of quadratic Béziers through edge
 * midpoints — smooth curves without the cost of spline fitting.
 */
export function traceOutline(path: CanvasPath, outline: number[][]): void {
  const len = outline.length;
  if (len === 0) return;
  if (len < 4) {
    const [x, y] = outline[0]!;
    path.moveTo(x!, y!);
    for (const [px, py] of outline) path.lineTo(px!, py!);
    path.closePath();
    return;
  }
  const first = outline[0]!;
  path.moveTo((first[0]! + outline[1]![0]!) / 2, (first[1]! + outline[1]![1]!) / 2);
  for (let i = 1; i < len; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % len]!;
    path.quadraticCurveTo(a[0]!, a[1]!, (a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2);
  }
  path.closePath();
}

const pathCache = new WeakMap<Stroke, Path2D>();

/** Cached Path2D for a committed (immutable) stroke. Freed automatically with the stroke. */
export function strokePath2D(stroke: Stroke): Path2D {
  let p = pathCache.get(stroke);
  if (!p) {
    p = new Path2D();
    traceOutline(p, strokeOutline(stroke.points, stroke.width, stroke.pressure, true));
    pathCache.set(stroke, p);
  }
  return p;
}
