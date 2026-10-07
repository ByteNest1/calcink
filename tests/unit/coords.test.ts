import { describe, expect, it } from 'vitest';
import {
  backingStoreSize,
  clientToWorld,
  deviceToWorld,
  MAX_BACKING_AREA,
  MAX_BACKING_EDGE,
  resolveDpr,
  worldToDevice,
} from '../../src/canvas/coords';

describe('coordinate conversion', () => {
  const rect = { left: 40, top: 72, width: 800, height: 600 };

  it('maps client coordinates into canvas world space', () => {
    expect(clientToWorld(140, 172, rect)).toEqual({ x: 100, y: 100 });
    expect(clientToWorld(40, 72, rect)).toEqual({ x: 0, y: 0 });
  });

  it('maps world space onto the device-pixel backing store', () => {
    expect(worldToDevice(100, 50, 2)).toEqual({ x: 200, y: 100 });
    expect(worldToDevice(10, 10, 1.5)).toEqual({ x: 15, y: 15 });
  });

  it('round-trips world ↔ device for fractional DPRs', () => {
    for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3]) {
      const d = worldToDevice(123.4, 56.7, dpr);
      const w = deviceToWorld(d.x, d.y, dpr);
      expect(w.x).toBeCloseTo(123.4, 9);
      expect(w.y).toBeCloseTo(56.7, 9);
    }
  });

  it('sanitises devicePixelRatio', () => {
    expect(resolveDpr(undefined)).toBe(1);
    expect(resolveDpr(0)).toBe(1);
    expect(resolveDpr(Number.NaN)).toBe(1);
    expect(resolveDpr(2)).toBe(2);
    expect(resolveDpr(10)).toBe(4);
  });

  it('sizes the backing store at CSS size × DPR for Retina displays', () => {
    expect(backingStoreSize(800, 600, 2)).toEqual({ width: 1600, height: 1200, scale: 2 });
    expect(backingStoreSize(801, 601, 1.5)).toMatchObject({ width: 1202, height: 902 });
  });

  it('clamps huge canvases instead of exceeding browser limits', () => {
    const b = backingStoreSize(5000, 4000, 3);
    expect(b.width).toBeLessThanOrEqual(MAX_BACKING_EDGE);
    expect(b.width * b.height).toBeLessThanOrEqual(MAX_BACKING_AREA * 1.001);
    expect(b.scale).toBeLessThan(3);
  });

  it('never returns a zero-sized canvas', () => {
    expect(backingStoreSize(0, 0, 2)).toMatchObject({ width: 2, height: 2 });
  });
});
