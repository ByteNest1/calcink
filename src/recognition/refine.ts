import { POINT_STRIDE } from '../ink/types';
import type { SymbolGroup } from './segmentation';
import type { Alternative, Glyph } from './types';

/**
 * Stroke-order-aware tie-breaker for the model's most common confusion on
 * live handwriting: a "1" written with an entry flag vs. a "7".
 *
 * A raster model sees both as "a short stroke at the top joined to a long
 * diagonal". The pen trajectory disambiguates: a 7 starts with a near-
 * horizontal bar travelling right; a flagged 1 starts with an upward tick.
 * Only applied when the model ranks 1 and 7 as its top candidates.
 */
export function refineOneSeven(group: SymbolGroup, ranked: Alternative[]): Alternative[] {
  if (group.strokes.length !== 1 || ranked.length < 2) return ranked;
  const top = ranked[0]!;
  const second = ranked.find((r) => r.char === (top.char === '1' ? '7' : '1'));
  if ((top.char !== '1' && top.char !== '7') || !second) return ranked;

  const p = group.strokes[0]!.points;
  const n = p.length / POINT_STRIDE;
  if (n < 3) return ranked;
  const x0 = p[0]!, y0 = p[1]!;
  const xn = p[(n - 1) * POINT_STRIDE]!, yn = p[(n - 1) * POINT_STRIDE + 1]!;
  const chord = Math.hypot(xn - x0, yn - y0) || 1;
  // Corner = point furthest from the start→end chord.
  let k = 0;
  let best = -1;
  for (let i = 1; i < n - 1; i++) {
    const x = p[i * POINT_STRIDE]!, y = p[i * POINT_STRIDE + 1]!;
    const d = Math.abs((xn - x0) * (y0 - y) - (x0 - x) * (yn - y0)) / chord;
    if (d > best) {
      best = d;
      k = i;
    }
  }
  const h = group.bbox.maxY - group.bbox.minY || 1;
  if (best < 0.08 * h) return ranked; // no corner → plain stroke, trust the model
  const dx = p[k * POINT_STRIDE]! - x0;
  const dy = p[k * POINT_STRIDE + 1]! - y0;
  const len = Math.hypot(dx, dy);
  const angle = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;

  let winner: Glyph | null = null;
  if (dx > 0 && angle <= 20 && len >= 0.3 * h) winner = '7';
  else if (dy < 0 && angle >= 28) winner = '1';
  if (!winner || winner === top.char) return ranked;

  // Geometry overrides only with a moderate confidence so the UI flags it for review.
  const boosted: Alternative = { char: winner, p: Math.max(second.p, Math.min(0.85, 0.8 * top.p)) };
  return [boosted, ...ranked.filter((r) => r.char !== winner)];
}
