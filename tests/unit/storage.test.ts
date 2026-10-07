import { describe, expect, it } from 'vitest';
import { deserialize, serialize } from '../../src/app/storage';
import { createStroke } from '../../src/ink/StrokeStore';

describe('notebook persistence', () => {
  it('round-trips strokes with rounded coordinates', () => {
    const s = createStroke({ points: Float32Array.from([1.234, 5.678, 0.512, 10, 20, 0.5]), width: 4, color: 'blue', pressure: true });
    const [back] = deserialize(serialize([s]));
    expect(back).toMatchObject({ id: s.id, seq: s.seq, width: 4, color: 'blue', pressure: true });
    expect(Array.from(back!.points)).toEqual([1.2000000476837158, 5.699999809265137, 0.5099999904632568, 10, 20, 0.5]);
    expect(back!.bbox).toEqual({ minX: back!.points[0], minY: back!.points[1], maxX: 10, maxY: 20 });
  });

  it('rejects corrupted payloads instead of crashing', () => {
    expect(deserialize('{"v":2}')).toEqual([]);
    expect(deserialize(JSON.stringify({ v: 1, strokes: [{ i: 'a', s: 1, w: 3, c: 'ink', p: 0, d: [1, 2] }] }))).toEqual([]);
    expect(deserialize(JSON.stringify({ v: 1, strokes: [{ i: 'a', s: 1, w: 3, c: 'ink', p: 0, d: [1, 'x', 3] }] }))).toEqual([]);
  });
});
