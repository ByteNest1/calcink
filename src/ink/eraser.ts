import { bboxIntersects, distanceToStroke, inflate } from './geometry';
import type { EditCommand } from './History';
import { createStroke, type StrokeStore } from './StrokeStore';
import { POINT_STRIDE, type BBox, type Stroke } from './types';

/** Sample the eraser's travel from (x0,y0) to (x1,y1) so fast swipes leave no gaps. */
export function sampleSegment(x0: number, y0: number, x1: number, y1: number, step: number): Array<[number, number]> {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(len / Math.max(step, 0.5)));
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) out.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  return out;
}

function circleBox(x: number, y: number, r: number): BBox {
  return { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r };
}

/** Does an eraser disc of `radius` at (x, y) touch the visible ink of `stroke`? */
export function strokeHit(stroke: Stroke, x: number, y: number, radius: number): boolean {
  const reach = radius + stroke.width / 2;
  if (!bboxIntersects(inflate(stroke.bbox, reach), circleBox(x, y, 0))) return false;
  return distanceToStroke(stroke, x, y) <= reach;
}

/**
 * Insert interpolated points so that consecutive points are at most `step`
 * apart. Needed so a small eraser can cut through the middle of a long,
 * sparsely-sampled segment.
 */
export function densify(points: Float32Array, step: number): Float32Array {
  const n = points.length / POINT_STRIDE;
  if (n < 2) return points;
  const out: number[] = [points[0]!, points[1]!, points[2]!];
  for (let i = 1; i < n; i++) {
    const o = i * POINT_STRIDE;
    const px = points[o - 3]!, py = points[o - 2]!, pp = points[o - 1]!;
    const x = points[o]!, y = points[o + 1]!, p = points[o + 2]!;
    const segs = Math.ceil(Math.hypot(x - px, y - py) / step);
    for (let k = 1; k < segs; k++) {
      const t = k / segs;
      out.push(px + (x - px) * t, py + (y - py) * t, pp + (p - pp) * t);
    }
    out.push(x, y, p);
  }
  return Float32Array.from(out);
}

/**
 * Cut a disc out of a stroke ("pixel" eraser on vector ink).
 * Returns `null` when the stroke is untouched, otherwise the surviving
 * fragments (possibly none).
 */
export function cutStroke(stroke: Stroke, x: number, y: number, radius: number): Float32Array[] | null {
  if (!strokeHit(stroke, x, y, radius)) return null;
  const reach = radius + stroke.width / 2;
  const pts = densify(stroke.points, Math.max(0.75, radius / 3));
  const n = pts.length / POINT_STRIDE;
  const fragments: Float32Array[] = [];
  let runStart = -1;
  const flush = (end: number): void => {
    if (runStart >= 0 && end - runStart >= 2) {
      fragments.push(pts.slice(runStart * POINT_STRIDE, end * POINT_STRIDE));
    }
    runStart = -1;
  };
  for (let i = 0; i < n; i++) {
    const o = i * POINT_STRIDE;
    const inside = Math.hypot(pts[o]! - x, pts[o + 1]! - y) <= reach;
    if (inside) flush(i);
    else if (runStart < 0) runStart = i;
  }
  flush(n);
  return fragments;
}

/**
 * Book-keeping for one eraser gesture (pointer down → up). The page is updated
 * live while the pointer moves; on release the whole gesture collapses into a
 * single undoable {@link EditCommand}.
 */
export class EraseSession {
  private readonly removedOriginals = new Map<string, Stroke>();
  private readonly addedLive = new Map<string, Stroke>();
  private lastX: number | null = null;
  private lastY: number | null = null;

  constructor(
    private readonly store: StrokeStore,
    private readonly mode: 'stroke' | 'pixel',
    private readonly radius: number,
  ) {}

  moveTo(x: number, y: number): void {
    const x0 = this.lastX ?? x;
    const y0 = this.lastY ?? y;
    this.lastX = x;
    this.lastY = y;
    for (const [sx, sy] of sampleSegment(x0, y0, x, y, this.radius / 2)) this.eraseAt(sx, sy);
  }

  private eraseAt(x: number, y: number): void {
    const candidates = this.store.all().filter((s) => strokeHit(s, x, y, this.radius));
    if (candidates.length === 0) return;
    if (this.mode === 'stroke') {
      this.store.apply([], candidates);
      for (const s of candidates) this.forget(s);
      return;
    }
    const added: Stroke[] = [];
    for (const s of candidates) {
      const pieces = cutStroke(s, x, y, this.radius);
      if (!pieces) continue;
      for (const pts of pieces) {
        const frag = createStroke({ points: pts, width: s.width, color: s.color, pressure: s.pressure });
        added.push(frag);
        this.addedLive.set(frag.id, frag);
      }
      this.forget(s);
    }
    this.store.apply(added, candidates);
  }

  /** A stroke left the page: either a fragment we created or an original. */
  private forget(s: Stroke): void {
    if (this.addedLive.has(s.id)) this.addedLive.delete(s.id);
    else this.removedOriginals.set(s.id, s);
  }

  finish(): EditCommand | null {
    if (this.removedOriginals.size === 0 && this.addedLive.size === 0) return null;
    return {
      label: this.mode === 'stroke' ? 'erase' : 'pixel-erase',
      added: [...this.addedLive.values()],
      removed: [...this.removedOriginals.values()],
    };
  }
}
