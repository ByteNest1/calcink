import { bboxOfPoints } from './geometry';
import type { Stroke } from './types';

let seqCounter = 0;
const session = Math.random().toString(36).slice(2, 7);

export interface StrokeInit {
  points: Float32Array;
  width: number;
  color: string;
  pressure?: boolean;
  /** Preserve an existing id/seq (used when restoring a saved notebook). */
  id?: string;
  seq?: number;
}

export function createStroke(init: StrokeInit): Stroke {
  const seq = init.seq ?? ++seqCounter;
  if (seq > seqCounter) seqCounter = seq;
  return Object.freeze({
    id: init.id ?? `s${seq.toString(36)}${session}`,
    points: init.points,
    width: init.width,
    color: init.color,
    seq,
    pressure: init.pressure ?? false,
    bbox: bboxOfPoints(init.points),
  });
}

export type StoreListener = (change: { added: readonly Stroke[]; removed: readonly Stroke[] }) => void;

/**
 * The single source of truth for the ink on the page. Keeps strokes in
 * creation order and notifies listeners (renderer, recogniser, persistence)
 * with the exact delta of every mutation.
 */
export class StrokeStore {
  private readonly strokes = new Map<string, Stroke>();
  private readonly listeners = new Set<StoreListener>();
  private orderedCache: Stroke[] | null = null;
  /** Incremented on every mutation. */
  version = 0;

  get size(): number {
    return this.strokes.size;
  }

  has(id: string): boolean {
    return this.strokes.has(id);
  }

  get(id: string): Stroke | undefined {
    return this.strokes.get(id);
  }

  /** Strokes in z-order (creation order). The returned array must not be mutated. */
  all(): readonly Stroke[] {
    if (!this.orderedCache) {
      this.orderedCache = [...this.strokes.values()].sort((a, b) => a.seq - b.seq);
    }
    return this.orderedCache;
  }

  /** Apply a batch edit atomically and emit one change event. */
  apply(added: readonly Stroke[], removed: readonly Stroke[]): void {
    const actuallyRemoved: Stroke[] = [];
    const actuallyAdded: Stroke[] = [];
    for (const s of removed) {
      if (this.strokes.delete(s.id)) actuallyRemoved.push(s);
    }
    for (const s of added) {
      if (!this.strokes.has(s.id)) {
        this.strokes.set(s.id, s);
        actuallyAdded.push(s);
      }
    }
    if (actuallyAdded.length === 0 && actuallyRemoved.length === 0) return;
    this.orderedCache = null;
    this.version++;
    const change = { added: actuallyAdded, removed: actuallyRemoved };
    for (const l of this.listeners) l(change);
  }

  add(stroke: Stroke): void {
    this.apply([stroke], []);
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
