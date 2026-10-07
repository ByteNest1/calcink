import { crossing, fromHorizontal, isBar, isDot, isHorizontal, isStraight, type StrokeFeatures } from './features';
import type { LineMetrics, SymbolGroup } from './segmentation';
import type { Glyph } from './types';

export interface GeometricMatch {
  char: Glyph;
  confidence: number;
}

/** Both strokes cross somewhere in their middle portion (not touching at a corner like a 2-stroke "7"). */
function crossesInMiddle(a: StrokeFeatures, b: StrokeFeatures, lo = 0.12, hi = 0.88): boolean {
  const c = crossing(a, b);
  return !!c && c.t >= lo && c.t <= hi && c.u >= lo && c.u <= hi;
}

/**
 * Deterministic stroke-geometry analyser for the operator vocabulary.
 *
 * The neural model (MNIST CNN) only knows digits. The remaining glyphs are
 * built from straight bars and dots, and their identity is fully determined
 * by stroke count, orientation and arrangement — information that rasterising
 * would throw away. Returns `null` when the group is not an operator, so the
 * caller falls through to the digit model.
 */
export function classifyOperator(group: SymbolGroup, metrics: LineMetrics): GeometricMatch | null {
  const H = metrics.refHeight;
  const f = group.features;

  if (f.length === 1) {
    const s = f[0]!;
    if (isDot(s, H)) {
      // A dot riding high in the writing band is a multiplication dot (·);
      // near the baseline it is a decimal point.
      const band = Math.max(1, metrics.bandBottom - metrics.bandTop);
      const rel = (s.cy - metrics.bandTop) / band;
      const hasBand = metrics.bandBottom - metrics.bandTop > 2 * Math.max(s.w, s.h, 2);
      if (hasBand && rel < 0.6 && rel > 0.2) return { char: '×', confidence: 0.75 };
      return { char: '.', confidence: 0.95 };
    }
    if (isBar(s, H) && s.h <= 0.35 * H) {
      return { char: '−', confidence: fromHorizontal(s) < 12 ? 0.97 : 0.9 };
    }
    // A long rising diagonal "/" — clearly slanted compared with a handwritten "1".
    if (isStraight(s) && s.angle >= 25 && s.angle <= 62 && s.h >= 0.5 * H) {
      return { char: '÷', confidence: 0.85 };
    }
    return null;
  }

  if (f.length === 2) {
    const [a, b] = f as [StrokeFeatures, StrokeFeatures];
    const bothStraight = isStraight(a) && isStraight(b);
    const dotA = isDot(a, H);
    const dotB = isDot(b, H);

    // "=": two stacked horizontal bars that do not cross.
    if (bothStraight && isHorizontal(a, 28) && isHorizontal(b, 28) && !crossing(a, b)) {
      const sep = Math.abs(a.cy - b.cy);
      const ratio = Math.min(a.w, b.w) / Math.max(a.w, b.w, 1);
      if (sep >= 0.08 * H && ratio >= 0.35) return { char: '=', confidence: ratio > 0.6 ? 0.97 : 0.88 };
    }

    if (bothStraight && crossesInMiddle(a, b)) {
      // "+" (bars near 0° and 90°) vs "×" (diagonals near 45° and 135°):
      // pick whichever ideal arrangement the two strokes are closer to, which
      // stays robust under slant and rotation.
      const ang = (x: number, ideal: number): number => {
        const d = Math.abs(x - ideal) % 180;
        return Math.min(d, 180 - d);
      };
      const plus = Math.min(ang(a.angle, 0) + ang(b.angle, 90), ang(a.angle, 90) + ang(b.angle, 0));
      const times = Math.min(ang(a.angle, 45) + ang(b.angle, 135), ang(a.angle, 135) + ang(b.angle, 45));
      // The two strokes must actually be roughly perpendicular.
      const between = ang(a.angle, b.angle);
      if (between >= 50) {
        const margin = Math.abs(plus - times);
        const confidence = Math.min(0.98, 0.7 + margin / 120);
        return plus <= times ? { char: '+', confidence } : { char: '×', confidence };
      }
    }

    // Half-written "÷" (bar + one dot).
    if ((dotA && isBar(b, H)) || (dotB && isBar(a, H))) return { char: '÷', confidence: 0.6 };
    return null;
  }

  if (f.length === 3) {
    const dots = f.filter((s) => isDot(s, H));
    const bars = f.filter((s) => isBar(s, H));
    if (dots.length === 2 && bars.length === 1) {
      const bar = bars[0]!;
      const above = dots.some((d) => d.cy < bar.cy);
      const below = dots.some((d) => d.cy > bar.cy);
      if (above && below) return { char: '÷', confidence: 0.98 };
      return { char: '÷', confidence: 0.7 };
    }
  }
  return null;
}
