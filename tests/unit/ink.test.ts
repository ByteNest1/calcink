import { describe, expect, it } from 'vitest';
import { History } from '../../src/ink/History';
import { createStroke, StrokeStore } from '../../src/ink/StrokeStore';
import { cutStroke, densify, EraseSession, strokeHit } from '../../src/ink/eraser';
import { countReversals, isScribble, scribbleTargets } from '../../src/ink/gestures';
import { bboxOfPoints, distanceToStroke, pathLength, segmentsIntersect } from '../../src/ink/geometry';

const line = (x0: number, y0: number, x1: number, y1: number, n = 20): Float32Array => {
  const pts: number[] = [];
  for (let i = 0; i <= n; i++) pts.push(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 0.5);
  return Float32Array.from(pts);
};
const stroke = (pts: Float32Array) => createStroke({ points: pts, width: 4, color: 'ink' });

describe('geometry', () => {
  it('computes bounding boxes and path length', () => {
    const p = line(0, 0, 30, 40);
    expect(bboxOfPoints(p)).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 40 });
    expect(pathLength(p)).toBeCloseTo(50, 4);
  });

  it('measures distance to a stroke centre line', () => {
    expect(distanceToStroke(stroke(line(0, 0, 100, 0)), 50, 7)).toBeCloseTo(7);
  });

  it('detects segment intersections', () => {
    expect(segmentsIntersect(0, 0, 10, 10, 0, 10, 10, 0)).toBe(true);
    expect(segmentsIntersect(0, 0, 10, 0, 0, 5, 10, 5)).toBe(false);
  });
});

describe('StrokeStore', () => {
  it('keeps creation order and emits exact deltas', () => {
    const store = new StrokeStore();
    const events: Array<[number, number]> = [];
    store.subscribe((c) => events.push([c.added.length, c.removed.length]));
    const a = stroke(line(0, 0, 10, 0));
    const b = stroke(line(0, 10, 10, 10));
    store.add(b);
    store.add(a);
    expect(store.all().map((s) => s.id)).toEqual([a, b].sort((x, y) => x.seq - y.seq).map((s) => s.id));
    store.apply([], [a]);
    expect(events).toEqual([[1, 0], [1, 0], [0, 1]]);
  });

  it('ignores no-op edits', () => {
    const store = new StrokeStore();
    const v = store.version;
    store.apply([], [stroke(line(0, 0, 1, 1))]);
    expect(store.version).toBe(v);
  });
});

describe('History (undo/redo)', () => {
  it('undoes and redoes drawing', () => {
    const store = new StrokeStore();
    const h = new History(store);
    const a = stroke(line(0, 0, 10, 0));
    h.execute({ label: 'draw', added: [a], removed: [] });
    expect(store.size).toBe(1);
    expect(h.undo()).toBe(true);
    expect(store.size).toBe(0);
    expect(h.redo()).toBe(true);
    expect(store.has(a.id)).toBe(true);
  });

  it('clears the redo branch on a new edit', () => {
    const store = new StrokeStore();
    const h = new History(store);
    h.execute({ label: 'draw', added: [stroke(line(0, 0, 1, 0))], removed: [] });
    h.undo();
    h.execute({ label: 'draw', added: [stroke(line(0, 5, 1, 5))], removed: [] });
    expect(h.canRedo).toBe(false);
  });

  it('makes clear undoable', () => {
    const store = new StrokeStore();
    const h = new History(store);
    for (let i = 0; i < 5; i++) h.execute({ label: 'draw', added: [stroke(line(0, i * 10, 10, i * 10))], removed: [] });
    h.execute({ label: 'clear', added: [], removed: [...store.all()] });
    expect(store.size).toBe(0);
    h.undo();
    expect(store.size).toBe(5);
  });

  it('caps history depth', () => {
    const store = new StrokeStore();
    const h = new History(store, 3);
    for (let i = 0; i < 10; i++) h.execute({ label: 'draw', added: [stroke(line(0, i, 1, i))], removed: [] });
    expect(h.depth.undo).toBe(3);
  });
});

describe('erasers', () => {
  it('hit-tests against visible ink (centre line + half width)', () => {
    const s = stroke(line(0, 0, 100, 0));
    expect(strokeHit(s, 50, 10, 8)).toBe(true); // 8 + 4/2 = 10
    expect(strokeHit(s, 50, 11, 8)).toBe(false);
  });

  it('densifies sparse strokes', () => {
    const d = densify(Float32Array.from([0, 0, 0.5, 10, 0, 0.5]), 1);
    expect(d.length / 3).toBe(11);
  });

  it('pixel eraser cuts a stroke into two fragments', () => {
    const s = stroke(line(0, 0, 100, 0, 4));
    const parts = cutStroke(s, 50, 0, 5)!;
    expect(parts).toHaveLength(2);
    expect(Math.max(...Array.from(parts[0]!).filter((_, i) => i % 3 === 0))).toBeLessThan(50 - 5);
    expect(Math.min(...Array.from(parts[1]!).filter((_, i) => i % 3 === 0))).toBeGreaterThan(50 + 5);
  });

  it('pixel eraser leaves untouched strokes alone', () => {
    expect(cutStroke(stroke(line(0, 0, 100, 0)), 50, 40, 5)).toBeNull();
  });

  it('a whole erase gesture is a single undoable command', () => {
    const store = new StrokeStore();
    const h = new History(store);
    const s = stroke(line(0, 0, 100, 0));
    h.execute({ label: 'draw', added: [s], removed: [] });
    const session = new EraseSession(store, 'pixel', 6);
    session.moveTo(30, -20);
    session.moveTo(30, 20); // cut at x=30
    session.moveTo(70, 20);
    session.moveTo(70, -20); // cut at x=70 (re-cuts a fragment created by this gesture)
    const cmd = session.finish()!;
    h.record(cmd);
    expect(cmd.removed.map((x) => x.id)).toEqual([s.id]);
    expect(store.size).toBe(3);
    h.undo();
    expect(store.all().map((x) => x.id)).toEqual([s.id]);
    h.redo();
    expect(store.size).toBe(3);
  });

  it('stroke eraser removes whole strokes', () => {
    const store = new StrokeStore();
    store.add(stroke(line(0, 0, 100, 0)));
    store.add(stroke(line(0, 50, 100, 50)));
    const session = new EraseSession(store, 'stroke', 6);
    session.moveTo(50, -5);
    session.moveTo(50, 5);
    expect(session.finish()!.removed).toHaveLength(1);
    expect(store.size).toBe(1);
  });
});

describe('scratch-out gesture', () => {
  const zigzag = (x: number, y: number, w: number, h: number, passes: number): Float32Array => {
    const pts: number[] = [];
    for (let i = 0; i <= passes * 8; i++) {
      const t = i / 8;
      const phase = t % 2 < 1 ? t % 1 : 1 - (t % 1);
      pts.push(x + phase * w, y + (h * i) / (passes * 8), 0.5);
    }
    return Float32Array.from(pts);
  };

  it('counts direction reversals with hysteresis', () => {
    expect(countReversals(zigzag(0, 0, 60, 40, 6), 0, 10)).toBeGreaterThanOrEqual(5);
    expect(countReversals(line(0, 0, 100, 0), 0, 10)).toBe(0);
  });

  it('recognises a vigorous zig-zag but not ordinary strokes', () => {
    expect(isScribble(zigzag(0, 0, 60, 40, 7))).toBe(true);
    expect(isScribble(line(0, 0, 100, 0, 30))).toBe(false);
    // A "3"-like double bump has too few reversals.
    expect(isScribble(zigzag(0, 0, 40, 60, 3))).toBe(false);
  });

  it('targets only the ink it covers', () => {
    const covered = stroke(line(10, 20, 50, 20));
    const far = stroke(line(300, 20, 340, 20));
    const targets = scribbleTargets(zigzag(0, 0, 60, 40, 7), [covered, far], 3);
    expect(targets.map((s) => s.id)).toEqual([covered.id]);
  });
});
