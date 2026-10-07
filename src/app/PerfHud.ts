import type { RecognitionStats } from '../recognition/types';

interface PerfMemory {
  usedJSHeapSize: number;
}

/** Rolling percentile helper. */
function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
}

/**
 * Live performance monitor (toggle with F or the pulse button).
 * Measures real frame intervals with its own rAF loop, counts main-thread
 * long tasks (> 50 ms) via PerformanceObserver, and shows the latest
 * recognition timings reported by the worker. Exposes `window.__calcinkPerf`
 * so automated tests can assert on the same numbers.
 */
export class PerfHud {
  private visible = false;
  private raf = 0;
  private last = 0;
  private intervals: number[] = [];
  private renderCost: number[] = [];
  private longTasks = 0;
  private longTaskMax = 0;
  private recog: { stats: RecognitionStats; rtt: number } | null = null;
  private readonly graph: HTMLCanvasElement;
  private readonly body: HTMLDivElement;
  private lastPaint = 0;

  constructor(private readonly el: HTMLElement) {
    el.innerHTML = '<h4>Performance</h4><canvas width="392" height="68"></canvas><div></div>';
    this.graph = el.querySelector('canvas')!;
    this.body = el.querySelector('div')!;
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          this.longTasks++;
          this.longTaskMax = Math.max(this.longTaskMax, e.duration);
        }
      });
      po.observe({ type: 'longtask', buffered: false });
    } catch {
      /* Long Tasks API unsupported (Safari/Firefox) */
    }
    (window as unknown as { __calcinkPerf: () => unknown }).__calcinkPerf = () => this.snapshot();
  }

  snapshot(): { fps: number; p95: number; max: number; longTasks: number; longTaskMax: number; renderP95: number } {
    const mean = this.intervals.length ? this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length : 0;
    return {
      fps: mean ? 1000 / mean : 0,
      p95: percentile(this.intervals, 0.95),
      max: Math.max(0, ...this.intervals),
      longTasks: this.longTasks,
      longTaskMax: this.longTaskMax,
      renderP95: percentile(this.renderCost, 0.95),
    };
  }

  /** Start sampling frame intervals (used by tests even when hidden). */
  startSampling(): void {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (t: number): void => {
      this.intervals.push(t - this.last);
      if (this.intervals.length > 240) this.intervals.shift();
      this.last = t;
      if (this.visible && t - this.lastPaint > 250) {
        this.lastPaint = t;
        this.paint();
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stopSampling(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resetCounters(): void {
    this.intervals = [];
    this.renderCost = [];
    this.longTasks = 0;
    this.longTaskMax = 0;
  }

  toggle(force?: boolean): boolean {
    this.visible = force ?? !this.visible;
    this.el.hidden = !this.visible;
    if (this.visible) {
      this.resetCounters();
      this.startSampling();
    } else {
      this.stopSampling();
    }
    return this.visible;
  }

  recordFrame(cpuMs: number): void {
    this.renderCost.push(cpuMs);
    if (this.renderCost.length > 240) this.renderCost.shift();
  }

  recordRecognition(stats: RecognitionStats, rtt: number): void {
    this.recog = { stats, rtt };
  }

  private paint(): void {
    const s = this.snapshot();
    const mem = (performance as unknown as { memory?: PerfMemory }).memory;
    const r = this.recog;
    const row = (k: string, v: string, cls = ''): string => `<div class="row"><span>${k}</span><b class="${cls}">${v}</b></div>`;
    this.body.innerHTML =
      row('FPS', s.fps.toFixed(0), s.fps >= 55 ? 'good' : 'bad') +
      row('frame p95 / max', `${s.p95.toFixed(1)} / ${s.max.toFixed(0)} ms`, s.p95 <= 20 ? 'good' : 'bad') +
      row('ink render p95', `${percentile(this.renderCost, 0.95).toFixed(2)} ms`) +
      row('long tasks', `${s.longTasks}${s.longTasks ? ` (max ${s.longTaskMax.toFixed(0)} ms)` : ''}`, s.longTasks ? 'bad' : 'good') +
      (r
        ? row('recognise (worker)', `${r.stats.totalMs.toFixed(1)} ms`) +
          row('  model runs / cached', `${r.stats.modelRuns} / ${r.stats.cacheHits}`) +
          row('  round trip', `${r.rtt.toFixed(1)} ms`)
        : row('recognise', '—')) +
      (mem ? row('JS heap', `${(mem.usedJSHeapSize / 1048576).toFixed(1)} MB`) : '');
    this.drawGraph();
  }

  private drawGraph(): void {
    const c = this.graph;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    const n = this.intervals.length;
    const w = c.width / 240;
    const color = getComputedStyle(this.el).color;
    // 16.7 ms budget line
    const y60 = c.height - (16.7 / 50) * c.height;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(0, y60, c.width, 1);
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < n; i++) {
      const v = Math.min(50, this.intervals[i]!);
      const h = (v / 50) * c.height;
      ctx.fillStyle = v > 20 ? '#e5484d' : color;
      ctx.fillRect((240 - n + i) * w, c.height - h, Math.max(1, w - 0.5), h);
    }
  }
}
