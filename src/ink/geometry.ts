import { POINT_STRIDE, type BBox, type Stroke } from './types';

export const EMPTY_BBOX: Readonly<BBox> = Object.freeze({
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
});

export function bboxOfPoints(points: ArrayLike<number>, stride = POINT_STRIDE): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += stride) {
    const x = points[i]!;
    const y = points[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function unionAll(boxes: readonly BBox[]): BBox {
  return boxes.reduce<BBox>((acc, b) => unionBBox(acc, b), { ...EMPTY_BBOX });
}

export function inflate(b: BBox, by: number): BBox {
  return { minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by };
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function bboxContainsPoint(b: BBox, x: number, y: number): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

export const bboxWidth = (b: BBox): number => b.maxX - b.minX;
export const bboxHeight = (b: BBox): number => b.maxY - b.minY;
export const bboxCenterX = (b: BBox): number => (b.minX + b.maxX) / 2;
export const bboxCenterY = (b: BBox): number => (b.minY + b.maxY) / 2;

/** Squared distance from point P to segment AB. */
export function distSqPointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** Minimum distance from a point to a stroke's polyline (centre line). */
export function distanceToStroke(stroke: Stroke, x: number, y: number): number {
  const p = stroke.points;
  const n = p.length / POINT_STRIDE;
  if (n === 0) return Infinity;
  if (n === 1) return Math.hypot(p[0]! - x, p[1]! - y);
  let best = Infinity;
  for (let i = 0; i < n - 1; i++) {
    const o = i * POINT_STRIDE;
    const d = distSqPointSegment(x, y, p[o]!, p[o + 1]!, p[o + 3]!, p[o + 4]!);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Total polyline length of a flat point array. */
export function pathLength(points: ArrayLike<number>, stride = POINT_STRIDE): number {
  let len = 0;
  for (let i = stride; i + 1 < points.length; i += stride) {
    len += Math.hypot(points[i]! - points[i - stride]!, points[i + 1]! - points[i + 1 - stride]!);
  }
  return len;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Proper or touching intersection test for segments AB and CD. */
export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  return o1 * o2 <= 0 && o3 * o4 <= 0 && !(o1 === 0 && o2 === 0 && o3 === 0 && o4 === 0);
}
