import { bboxHeight, bboxWidth, pathLength } from '../ink/geometry';
import { POINT_STRIDE, type BBox } from '../ink/types';
import type { StrokeData } from './types';

/** Shape descriptors of a single stroke, used by segmentation and the operator analyser. */
export interface StrokeFeatures {
  bbox: BBox;
  w: number;
  h: number;
  cx: number;
  cy: number;
  length: number;
  /** Endpoints */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  chord: number;
  /** chord / path length — 1 for a perfectly straight stroke */
  straightness: number;
  /** max perpendicular deviation from the chord, relative to chord length */
  deviation: number;
  /** Undirected orientation of the chord in degrees, [0, 180): 0 = horizontal, 90 = vertical, 45 = "/" */
  angle: number;
}

export function strokeFeatures(s: StrokeData): StrokeFeatures {
  const p = s.points;
  const n = p.length / POINT_STRIDE;
  const x0 = p[0]!, y0 = p[1]!;
  const x1 = p[(n - 1) * POINT_STRIDE]!, y1 = p[(n - 1) * POINT_STRIDE + 1]!;
  const length = pathLength(p);
  const chord = Math.hypot(x1 - x0, y1 - y0);
  let maxDev = 0;
  if (chord > 0) {
    const nx = -(y1 - y0) / chord;
    const ny = (x1 - x0) / chord;
    for (let i = 0; i < n; i++) {
      const d = Math.abs((p[i * POINT_STRIDE]! - x0) * nx + (p[i * POINT_STRIDE + 1]! - y0) * ny);
      if (d > maxDev) maxDev = d;
    }
  }
  // Screen y grows downwards; flip so "/" reads as 45°.
  let angle = (Math.atan2(-(y1 - y0), x1 - x0) * 180) / Math.PI;
  if (angle < 0) angle += 180;
  if (angle >= 180) angle -= 180;
  const bbox = s.bbox;
  return {
    bbox,
    w: bboxWidth(bbox),
    h: bboxHeight(bbox),
    cx: (bbox.minX + bbox.maxX) / 2,
    cy: (bbox.minY + bbox.maxY) / 2,
    length,
    x0, y0, x1, y1,
    chord,
    straightness: length > 0 ? chord / length : 0,
    deviation: chord > 0 ? maxDev / chord : 1,
    angle,
  };
}

export const isStraight = (f: StrokeFeatures): boolean => f.straightness >= 0.85 && f.deviation <= 0.16;

/** Angular distance from horizontal, in [0, 90]. */
export const fromHorizontal = (f: StrokeFeatures): number => Math.min(f.angle, 180 - f.angle);

export const isHorizontal = (f: StrokeFeatures, tol = 25): boolean => fromHorizontal(f) <= tol;
export const isVertical = (f: StrokeFeatures, tol = 30): boolean => Math.abs(f.angle - 90) <= tol;

/** A dot (decimal point, ÷ dot): tiny relative to the line's writing height. */
export function isDot(f: StrokeFeatures, refHeight: number): boolean {
  return Math.max(f.w, f.h) <= 0.22 * refHeight && f.length <= 0.6 * refHeight;
}

/** Long, straight, horizontal stroke — the bar of −, = or ÷. */
export function isBar(f: StrokeFeatures, refHeight: number): boolean {
  return isStraight(f) && isHorizontal(f) && f.w >= 0.25 * refHeight && !isDot(f, refHeight);
}

/**
 * Where two segments cross, as parameters (t on AB, u on CD) in [0, 1].
 * Returns null when they don't cross (or are parallel).
 */
export function crossing(a: StrokeFeatures, b: StrokeFeatures): { t: number; u: number } | null {
  const rx = a.x1 - a.x0, ry = a.y1 - a.y0;
  const sx = b.x1 - b.x0, sy = b.y1 - b.y0;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const qx = b.x0 - a.x0, qy = b.y0 - a.y0;
  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * ry - qy * rx) / denom;
  if (t < -0.05 || t > 1.05 || u < -0.05 || u > 1.05) return null;
  return { t, u };
}
