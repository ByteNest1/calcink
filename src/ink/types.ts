/** Axis-aligned bounding box in world (CSS pixel) coordinates. */
export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * An immutable ink stroke. Points are stored flat as `[x0, y0, p0, x1, y1, p1, …]`
 * in world coordinates (CSS pixels relative to the canvas) with pressure in [0, 1].
 * Strokes are never mutated after they are committed: editing operations (pixel
 * erase, scratch-out) replace strokes with new ones, which keeps undo/redo, render
 * caches and the recogniser cache trivially consistent.
 */
export interface Stroke {
  readonly id: string;
  readonly points: Float32Array;
  readonly width: number;
  readonly color: string;
  /** Monotonic creation order — used for stable z-ordering. */
  readonly seq: number;
  /** True when pressure came from real hardware (pen) rather than being simulated. */
  readonly pressure: boolean;
  readonly bbox: BBox;
}

export const POINT_STRIDE = 3;

export type Tool = 'pen' | 'stroke-eraser' | 'pixel-eraser';
