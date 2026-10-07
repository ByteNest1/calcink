import type { BBox } from '../ink/types';
import type { AnswerStatus, LineResult } from '../recognition/types';

export interface AnswerPalette {
  answer: string;
  ok: string;
  bad: string;
  warn: string;
  muted: string;
  insight: string;
}

export interface Projection {
  key: string;
  line: LineResult;
  status: AnswerStatus;
  text: string;
  x: number;
  baseline: number;
  fontSize: number;
  /** Hit box for hover cards. */
  box: BBox;
  born: number;
}

interface Fading {
  p: Projection;
  start: number;
}

export const ANSWER_FONT = '"Caveat", "Segoe Print", "Bradley Hand", cursive';
const REVEAL_MS = 420;
const FADE_MS = 200;

const easeOut = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/** Confidence band → indicator colour (null = confident, no indicator). */
export function confidenceLevel(c: number): 'high' | 'medium' | 'low' {
  return c >= 0.85 ? 'high' : c >= 0.55 ? 'medium' : 'low';
}

/**
 * Projects evaluated answers onto the canvas, right next to each "=".
 * Answers are "written" in with a left-to-right reveal; when an edit changes
 * the result, the old value fades while the new one is written in place.
 * Renders only while something is animating.
 */
export class AnswerLayer {
  private readonly ctx: CanvasRenderingContext2D;
  private projections = new Map<string, Projection>();
  private fading: Fading[] = [];
  private frame = 0;
  private scale = 1;
  private insight = false;
  private lines: LineResult[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private palette: AnswerPalette,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  setPalette(p: AnswerPalette): void {
    this.palette = p;
    this.requestFrame();
  }

  setInsight(on: boolean): void {
    this.insight = on;
    this.requestFrame();
  }

  resize(scale: number): void {
    this.scale = scale;
    this.requestFrame();
  }

  /** Apply a new recognition result. Returns projections that are new or changed. */
  update(lines: LineResult[]): Projection[] {
    const now = performance.now();
    this.lines = lines;
    const next = new Map<string, Projection>();
    const changed: Projection[] = [];
    for (const line of lines) {
      if (!line.answer || !line.anchor) continue;
      const p = this.layout(line, now);
      const prev = this.projections.get(line.key);
      if (prev && prev.text === p.text && prev.status === p.status) {
        // Same answer — keep animation phase, refresh geometry.
        p.born = prev.born;
      } else {
        if (prev) this.fading.push({ p: prev, start: now });
        changed.push(p);
      }
      next.set(line.key, p);
    }
    for (const [key, prev] of this.projections) {
      if (!next.has(key)) this.fading.push({ p: prev, start: now });
    }
    this.projections = next;
    this.requestFrame();
    return changed;
  }

  private layout(line: LineResult, now: number): Projection {
    const a = line.answer!;
    const H = line.refHeight;
    const anchor = line.anchor!;
    const fontSize = Math.min(180, Math.max(20, H * 1.35));
    const small = a.status === 'undefined' || a.status === 'error' || a.status === 'invalid';
    const size = small ? fontSize * 0.75 : fontSize;
    const x = anchor.maxX + Math.max(8, 0.3 * H);
    const baseline = line.bandBottom + 0.02 * H;
    let text = a.text;
    if (a.status === 'correct') text = '';
    if (a.status === 'incorrect') text = a.text;
    this.ctx.font = `600 ${size}px ${ANSWER_FONT}`;
    const markW = a.status === 'correct' || a.status === 'incorrect' ? H * 0.7 + (text ? H * 0.25 : 0) : 0;
    const width = (text ? this.ctx.measureText(text).width : 0) + markW;
    return {
      key: line.key,
      line,
      status: a.status,
      text,
      x,
      baseline,
      fontSize: size,
      box: { minX: x - 4, maxX: x + Math.max(width, H * 0.6) + 4, minY: baseline - H * 1.05, maxY: baseline + H * 0.3 },
      born: now,
    };
  }

  hitTest(x: number, y: number): Projection | null {
    for (const p of this.projections.values()) {
      if (x >= p.box.minX && x <= p.box.maxX && y >= p.box.minY && y <= p.box.maxY) return p;
    }
    // Hovering the equation itself also explains it.
    for (const p of this.projections.values()) {
      const b = p.line.bbox;
      if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) return p;
    }
    return null;
  }

  get current(): Projection[] {
    return [...this.projections.values()];
  }

  private requestFrame(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame((t) => {
      this.frame = 0;
      this.render(t);
    });
  }

  private render(now: number): void {
    const ctx = this.ctx;
    const k = this.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);

    let animating = false;
    if (this.insight) this.drawInsight();

    this.fading = this.fading.filter((f) => now - f.start < FADE_MS);
    for (const f of this.fading) {
      this.drawProjection(f.p, 1, 1 - (now - f.start) / FADE_MS);
      animating = true;
    }
    for (const p of this.projections.values()) {
      const t = (now - p.born) / REVEAL_MS;
      if (t < 1) animating = true;
      this.drawProjection(p, easeOut(t), Math.min(1, t * 3));
    }
    if (animating) this.requestFrame();
  }

  private colorFor(status: AnswerStatus): string {
    switch (status) {
      case 'value':
        return this.palette.answer;
      case 'correct':
        return this.palette.ok;
      case 'incorrect':
        return this.palette.bad;
      case 'undefined':
        return this.palette.bad;
      default:
        return this.palette.warn;
    }
  }

  private drawProjection(p: Projection, reveal: number, alpha: number): void {
    const ctx = this.ctx;
    const H = p.line.refHeight;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    // Left-to-right "writing" reveal.
    ctx.beginPath();
    ctx.rect(p.box.minX - 2, p.box.minY - H, (p.box.maxX - p.box.minX + 4) * reveal, p.box.maxY - p.box.minY + 2 * H);
    ctx.clip();
    const color = this.colorFor(p.status);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let x = p.x;

    if (p.status === 'correct' || p.status === 'incorrect') {
      const s = H * 0.6;
      const top = p.baseline - H * 0.75;
      ctx.lineWidth = Math.max(2.5, H * 0.07);
      ctx.beginPath();
      if (p.status === 'correct') {
        ctx.moveTo(x, top + s * 0.55);
        ctx.quadraticCurveTo(x + s * 0.25, top + s * 0.75, x + s * 0.35, top + s);
        ctx.quadraticCurveTo(x + s * 0.6, top + s * 0.4, x + s, top);
      } else {
        ctx.moveTo(x, top);
        ctx.lineTo(x + s, top + s);
        ctx.moveTo(x + s, top);
        ctx.lineTo(x, top + s);
      }
      ctx.stroke();
      x += s + H * 0.25;
      if (p.status === 'incorrect') {
        ctx.font = `600 ${p.fontSize * 0.8}px ${ANSWER_FONT}`;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(p.text, x, p.baseline);
      }
    } else if (p.status === 'error' || p.status === 'invalid') {
      const r = H * 0.28;
      const cy = p.baseline - H * 0.45;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + r, cy, r, 0, Math.PI * 2);
      ctx.globalAlpha *= 0.9;
      ctx.stroke();
      ctx.font = `700 ${r * 1.5}px ${ANSWER_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', x + r, cy + r * 0.08);
    } else {
      ctx.font = `600 ${p.fontSize}px ${ANSWER_FONT}`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(p.text, x, p.baseline);
      // Confidence indicator: a hand-drawn dotted underline when unsure.
      const level = confidenceLevel(p.line.confidence);
      if (level !== 'high' && p.status === 'value') {
        const w = ctx.measureText(p.text).width;
        ctx.strokeStyle = level === 'medium' ? this.palette.warn : this.palette.bad;
        ctx.lineWidth = Math.max(1.5, H * 0.04);
        ctx.setLineDash([2, Math.max(4, H * 0.1)]);
        ctx.beginPath();
        ctx.moveTo(x, p.baseline + H * 0.14);
        ctx.lineTo(x + w, p.baseline + H * 0.14);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  /** "Show what CalcInk sees": per-symbol boxes, labels and confidences. */
  private drawInsight(): void {
    const ctx = this.ctx;
    ctx.save();
    for (const line of this.lines) {
      for (const s of line.symbols) {
        const b = s.bbox;
        const level = confidenceLevel(s.confidence);
        const col = level === 'high' ? this.palette.insight : level === 'medium' ? this.palette.warn : this.palette.bad;
        const pad = 3;
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + 2 * pad, b.maxY - b.minY + 2 * pad);
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = col;
        ctx.font = '600 11px "Inter", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const cx = (b.minX + b.maxX) / 2;
        const y = Math.max(b.maxY, line.bandBottom) + 6;
        ctx.fillText(s.char, cx, y);
        ctx.font = '500 9px "Inter", system-ui, sans-serif';
        ctx.globalAlpha = 0.75;
        ctx.fillText(`${Math.round(s.confidence * 100)}%${s.source === 'geometry' ? ' ◇' : ''}`, cx, y + 13);
      }
    }
    ctx.restore();
  }
}
