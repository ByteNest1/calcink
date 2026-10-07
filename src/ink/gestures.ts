import { bboxContainsPoint, bboxHeight, bboxOfPoints, bboxWidth, distSqPointSegment, inflate, pathLength } from './geometry';
import { POINT_STRIDE, type Stroke } from './types';

/** Count direction reversals along one axis using hysteresis to ignore jitter. */
export function countReversals(points: Float32Array, axis: 0 | 1, threshold: number): number {
  const n = points.length / POINT_STRIDE;
  if (n < 3) return 0;
  let dir = 0; // +1 increasing, -1 decreasing, 0 unknown yet
  let extreme = points[axis]!;
  let reversals = 0;
  for (let i = 1; i < n; i++) {
    const v = points[i * POINT_STRIDE + axis]!;
    if (dir === 0) {
      if (v - extreme > threshold) {
        dir = 1;
        extreme = v;
      } else if (extreme - v > threshold) {
        dir = -1;
        extreme = v;
      }
    } else if (dir === 1) {
      if (v > extreme) extreme = v;
      else if (extreme - v > threshold) {
        reversals++;
        dir = -1;
        extreme = v;
      }
    } else if (v < extreme) {
      extreme = v;
    } else if (v - extreme > threshold) {
      reversals++;
      dir = 1;
      extreme = v;
    }
  }
  return reversals;
}

export const SCRIBBLE_MIN_REVERSALS = 5;

/**
 * A scratch-out gesture is a vigorous zig-zag: many direction reversals and a
 * path far longer than its bounding box. Digits such as 3 or 8 have at most
 * ~4 x-reversals, so the threshold keeps normal handwriting safe.
 */
export function isScribble(points: Float32Array): boolean {
  if (points.length / POINT_STRIDE < 12) return false;
  const box = bboxOfPoints(points);
  const w = bboxWidth(box);
  const h = bboxHeight(box);
  const size = Math.max(w, h);
  if (size < 12) return false;
  const len = pathLength(points);
  if (len < 3.5 * size) return false;
  const rx = countReversals(points, 0, Math.max(3, 0.25 * w));
  const ry = countReversals(points, 1, Math.max(3, 0.25 * h));
  return Math.max(rx, ry) >= SCRIBBLE_MIN_REVERSALS;
}

function minDistToPolyline(x: number, y: number, poly: Float32Array): number {
  let best = Infinity;
  const n = poly.length / POINT_STRIDE;
  for (let i = 0; i < n - 1; i++) {
    const o = i * POINT_STRIDE;
    const d = distSqPointSegment(x, y, poly[o]!, poly[o + 1]!, poly[o + 3]!, poly[o + 4]!);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Strokes substantially covered by a scribble — the ones a scratch-out deletes. */
export function scribbleTargets(scribble: Float32Array, strokes: readonly Stroke[], scribbleWidth: number): Stroke[] {
  const area = inflate(bboxOfPoints(scribble), 6);
  const out: Stroke[] = [];
  for (const s of strokes) {
    const n = s.points.length / POINT_STRIDE;
    let inside = 0;
    let touched = false;
    const step = Math.max(1, Math.floor(n / 24));
    let sampled = 0;
    for (let i = 0; i < n; i += step) {
      sampled++;
      const x = s.points[i * POINT_STRIDE]!;
      const y = s.points[i * POINT_STRIDE + 1]!;
      if (bboxContainsPoint(area, x, y)) {
        inside++;
        if (!touched && minDistToPolyline(x, y, scribble) <= scribbleWidth + s.width + 8) touched = true;
      }
    }
    if (touched && inside / sampled >= 0.6) out.push(s);
  }
  return out;
}
