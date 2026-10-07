import { bboxCenterX, bboxCenterY, bboxHeight, bboxIntersects, bboxWidth, distSqPointSegment, inflate, unionAll } from '../ink/geometry';
import { POINT_STRIDE, type BBox } from '../ink/types';
import { isBar, isDot, strokeFeatures, type StrokeFeatures } from './features';
import type { StrokeData } from './types';

/** Tiny union-find over indices. */
class DisjointSet {
  private readonly parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]!]!;
      i = this.parent[i]!;
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
  groups(): number[][] {
    const map = new Map<number, number[]>();
    this.parent.forEach((_, i) => {
      const r = this.find(i);
      const g = map.get(r);
      if (g) g.push(i);
      else map.set(r, [i]);
    });
    return [...map.values()];
  }
}

const MIN_SIZE = 8;

/** Characteristic size of a stroke for proximity tests (flat strokes count by width). */
function strokeSize(b: BBox): number {
  return Math.max(bboxHeight(b), 0.5 * bboxWidth(b), MIN_SIZE);
}

/**
 * Are two strokes part of the same written line?
 * Vertically: their centres are close relative to their size (or they overlap
 * well). Horizontally: the gap between them is not much bigger than a symbol.
 */
export function sameLine(a: BBox, b: BBox): boolean {
  const s = Math.max(strokeSize(a), strokeSize(b));
  const cyDist = Math.abs(bboxCenterY(a) - bboxCenterY(b));
  const vOverlap = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  const minH = Math.max(1, Math.min(bboxHeight(a), bboxHeight(b)));
  const vertical = cyDist <= 0.6 * s || vOverlap >= 0.5 * minH;
  const hGap = Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX);
  return vertical && hGap <= 2.2 * s;
}

/** Cluster strokes into written lines (equations), ordered top to bottom. */
export function segmentLines(strokes: readonly StrokeData[]): StrokeData[][] {
  const ds = new DisjointSet(strokes.length);
  for (let i = 0; i < strokes.length; i++) {
    for (let j = i + 1; j < strokes.length; j++) {
      if (sameLine(strokes[i]!.bbox, strokes[j]!.bbox)) ds.union(i, j);
    }
  }
  return ds
    .groups()
    .map((idx) => idx.map((i) => strokes[i]!))
    .sort((a, b) => {
      const ba = unionAll(a.map((s) => s.bbox));
      const bb = unionAll(b.map((s) => s.bbox));
      return bboxCenterY(ba) - bboxCenterY(bb) || ba.minX - bb.minX;
    });
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export interface LineMetrics {
  /** Typical full symbol height */
  refHeight: number;
  /** Median top / bottom of full-height strokes */
  bandTop: number;
  bandBottom: number;
}

export function lineMetrics(strokes: readonly StrokeData[]): LineMetrics {
  const heights = strokes.map((s) => bboxHeight(s.bbox));
  const maxH = Math.max(...heights, 0);
  const tall = strokes.filter((s) => bboxHeight(s.bbox) >= 0.5 * maxH && bboxHeight(s.bbox) > 0);
  // A line made only of flat strokes (e.g. a lone "−") falls back to its width.
  const refHeight = Math.max(median(tall.map((s) => bboxHeight(s.bbox))), MIN_SIZE * 2, maxH > 0 ? 0 : 20);
  const box = unionAll(strokes.map((s) => s.bbox));
  return {
    refHeight,
    bandTop: tall.length ? median(tall.map((s) => s.bbox.minY)) : box.minY,
    bandBottom: tall.length ? median(tall.map((s) => s.bbox.maxY)) : box.maxY,
  };
}

/** Minimum distance between two strokes' centre lines (sampled; exact enough for touch tests). */
export function strokeDistance(a: StrokeData, b: StrokeData): number {
  const pa = a.points;
  const pb = b.points;
  const na = pa.length / POINT_STRIDE;
  const nb = pb.length / POINT_STRIDE;
  let best = Infinity;
  for (let i = 0; i < na; i++) {
    const x = pa[i * POINT_STRIDE]!;
    const y = pa[i * POINT_STRIDE + 1]!;
    if (nb === 1) {
      best = Math.min(best, (x - pb[0]!) ** 2 + (y - pb[1]!) ** 2);
      continue;
    }
    for (let j = 0; j < nb - 1; j++) {
      const o = j * POINT_STRIDE;
      const d = distSqPointSegment(x, y, pb[o]!, pb[o + 1]!, pb[o + 3]!, pb[o + 4]!);
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

export interface SymbolGroup {
  strokes: StrokeData[];
  features: StrokeFeatures[];
  bbox: BBox;
  /** Cache key: the (immutable) stroke ids that form this symbol. */
  key: string;
}

/**
 * Split one line into symbols. Strokes belong to the same symbol when one's
 * horizontal centre falls inside the other's extent (the two bars of "=", the
 * cross of "+", the two strokes of "4"/"5"). Dots only join a symbol when they
 * sit above or below a horizontal bar (÷); otherwise they stay decimal points.
 */
export function segmentSymbols(strokes: readonly StrokeData[], metrics: LineMetrics): SymbolGroup[] {
  const H = metrics.refHeight;
  const feats = strokes.map(strokeFeatures);
  const dots = feats.map((f) => isDot(f, H));
  const ds = new DisjointSet(strokes.length);
  const tol = 0.04 * H;

  for (let i = 0; i < strokes.length; i++) {
    if (dots[i]) continue;
    const a = feats[i]!;
    for (let j = i + 1; j < strokes.length; j++) {
      if (dots[j]) continue;
      const b = feats[j]!;
      const aInB = a.cx >= b.bbox.minX - tol && a.cx <= b.bbox.maxX + tol;
      const bInA = b.cx >= a.bbox.minX - tol && b.cx <= a.bbox.maxX + tol;
      if (aInB || bInA) {
        ds.union(i, j);
        continue;
      }
      // A flat stroke physically attached to another (the cap of a 2-stroke
      // "5", a long "7" crossbar) belongs to it even if it sticks out sideways.
      const xOverlap = Math.min(a.bbox.maxX, b.bbox.maxX) - Math.max(a.bbox.minX, b.bbox.minX);
      const oneFlat = a.h <= 0.4 * H || b.h <= 0.4 * H;
      if (
        xOverlap > 0 &&
        oneFlat &&
        bboxIntersects(inflate(a.bbox, 0.08 * H), b.bbox) &&
        strokeDistance(strokes[i]!, strokes[j]!) <= Math.max(2, 0.06 * H)
      ) {
        ds.union(i, j);
      }
    }
  }

  // Small marks inside the body of a symbol (a short "7" crossbar) are part of it.
  for (let i = 0; i < strokes.length; i++) {
    if (!dots[i]) continue;
    const d = feats[i]!;
    for (let j = 0; j < strokes.length; j++) {
      if (dots[j] || isBar(feats[j]!, H)) continue;
      const b = feats[j]!.bbox;
      const inset = 0.15 * (b.maxX - b.minX);
      if (d.cx > b.minX + inset && d.cx < b.maxX - inset && d.cy > b.minY && d.cy < b.maxY) {
        ds.union(j, i);
        dots[i] = false;
        break;
      }
    }
  }

  // Attach ÷ dots to the bar they decorate.
  for (let i = 0; i < strokes.length; i++) {
    if (!dots[i] || ds.find(i) !== i) continue;
    const d = feats[i]!;
    let best = -1;
    let bestDist = Infinity;
    for (let j = 0; j < strokes.length; j++) {
      if (i === j || dots[j]) continue;
      const bar = feats[j]!;
      if (!isBar(bar, H)) continue;
      const withinX = d.cx >= bar.bbox.minX - 0.1 * H && d.cx <= bar.bbox.maxX + 0.1 * H;
      const dy = Math.abs(d.cy - bar.cy);
      if (withinX && dy >= 0.08 * H && dy <= 0.9 * H && dy < bestDist) {
        best = j;
        bestDist = dy;
      }
    }
    if (best >= 0) ds.union(best, i);
  }

  return ds
    .groups()
    .map((idx) => {
      const group = idx.map((i) => strokes[i]!);
      const bbox = unionAll(group.map((s) => s.bbox));
      return {
        strokes: group,
        features: idx.map((i) => feats[i]!),
        bbox,
        key: group
          .map((s) => s.id)
          .sort()
          .join(','),
      };
    })
    .sort((a, b) => bboxCenterX(a.bbox) - bboxCenterX(b.bbox));
}
