/**
 * Coordinate spaces used by CalcInk
 *
 *  client  — PointerEvent.clientX/Y (CSS px, relative to the viewport)
 *  world   — CSS px relative to the canvas' top-left corner; all ink is stored here
 *  device  — physical pixels of the canvas backing store (world × devicePixelRatio)
 *  model   — the 28×28 tensor grid fed to the network (see recognition/rasterize.ts)
 *
 * Keeping ink in world space makes it resolution-independent: on a DPR change
 * (moving the window to a Retina screen, browser zoom) only the backing store
 * is resized and the strokes are re-rasterised crisply.
 */

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Largest backing-store edge we allocate (keeps GPU memory bounded). */
export const MAX_BACKING_EDGE = 8192;
/** Largest backing-store area (px²); iOS Safari caps canvases at ~16.7 MP. */
export const MAX_BACKING_AREA = 16_777_216;

/** Sanitise `window.devicePixelRatio` (it can be 0/undefined in odd embeds). */
export function resolveDpr(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(raw, 4);
}

export function clientToWorld(clientX: number, clientY: number, rect: RectLike): { x: number; y: number } {
  return { x: clientX - rect.left, y: clientY - rect.top };
}

export function worldToDevice(x: number, y: number, dpr: number): { x: number; y: number } {
  return { x: x * dpr, y: y * dpr };
}

export function deviceToWorld(x: number, y: number, dpr: number): { x: number; y: number } {
  return { x: x / dpr, y: y / dpr };
}

export interface BackingStore {
  /** canvas.width / canvas.height (device px, integers) */
  width: number;
  height: number;
  /** Effective scale actually applied (may be < dpr if clamped). */
  scale: number;
}

/**
 * Size of a canvas backing store for a CSS box at a given DPR, clamped so huge
 * displays never allocate a canvas the browser would silently refuse.
 */
export function backingStoreSize(cssWidth: number, cssHeight: number, dpr: number): BackingStore {
  const w = Math.max(1, cssWidth);
  const h = Math.max(1, cssHeight);
  let scale = resolveDpr(dpr);
  scale = Math.min(scale, MAX_BACKING_EDGE / w, MAX_BACKING_EDGE / h, Math.sqrt(MAX_BACKING_AREA / (w * h)));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
  };
}
