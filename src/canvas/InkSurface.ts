import { EraseSession } from '../ink/eraser';
import { isScribble, scribbleTargets } from '../ink/gestures';
import type { History } from '../ink/History';
import { createStroke, type StrokeStore } from '../ink/StrokeStore';
import { POINT_STRIDE, type Stroke, type Tool } from '../ink/types';
import { backingStoreSize, clientToWorld, resolveDpr } from './coords';
import { strokeOutline, strokePath2D, traceOutline } from './strokePath';

export interface SurfaceConfig {
  tool(): Tool;
  /** Pen width (CSS px). */
  penWidth(): number;
  /** Eraser radius (CSS px). */
  eraserRadius(): number;
  /** Palette key of the current ink colour. */
  inkKey(): string;
  /** Resolve a palette key to a CSS colour for the current theme. */
  resolveColor(key: string): string;
}

export interface SurfaceEvents {
  onPenDown?(): void;
  onPenUp?(): void;
  /** A stroke was turned into a scratch-out that deleted `count` strokes. */
  onScratch?(count: number): void;
  /** Pointer hovering (no button) — used for answer tooltips. */
  onHover?(x: number, y: number, clientX: number, clientY: number): void;
  onHoverEnd?(): void;
  /** Called after each rendered frame with its CPU cost (ms). */
  onFrame?(cpuMs: number): void;
  /** Backing store resized (CSS size and DPR). */
  onResize?(width: number, height: number, scale: number): void;
}

type Active =
  | { kind: 'pen'; pointerId: number; points: number[]; width: number; color: string; pressure: boolean }
  | { kind: 'erase'; pointerId: number; session: EraseSession; x: number; y: number; radius: number };

/** Ignore pointer samples closer than this to the previous one (CSS px). */
const MIN_POINT_DISTANCE = 0.4;
/** After a pen is seen, ignore touch input for this long (palm rejection). */
const PALM_REJECT_MS = 1500;

/**
 * Three stacked canvases:
 *   ink    — committed strokes; drawn incrementally, fully redrawn only on removal/resize
 *   answer — owned by AnswerLayer (projected results)
 *   live   — the stroke being drawn + eraser cursor; cleared every frame
 *
 * Input handlers only record points; all drawing happens in a single
 * requestAnimationFrame callback that runs on demand (idle page = zero work).
 */
export class InkSurface {
  readonly inkCanvas: HTMLCanvasElement;
  readonly answerCanvas: HTMLCanvasElement;
  readonly liveCanvas: HTMLCanvasElement;
  private readonly ink: CanvasRenderingContext2D;
  private readonly live: CanvasRenderingContext2D;

  width = 1;
  height = 1;
  scale = 1;

  private active: Active | null = null;
  private hover: { x: number; y: number } | null = null;
  private lastPenTime = -Infinity;
  private frameRequested = false;
  private fullRedraw = true;
  private readonly incremental: Stroke[] = [];
  private liveDirty = false;
  private readonly cleanups: Array<() => void> = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly store: StrokeStore,
    private readonly history: History,
    private readonly config: SurfaceConfig,
    private readonly events: SurfaceEvents = {},
  ) {
    const make = (cls: string): HTMLCanvasElement => {
      const c = document.createElement('canvas');
      c.className = `layer ${cls}`;
      container.appendChild(c);
      return c;
    };
    this.inkCanvas = make('layer-ink');
    this.answerCanvas = make('layer-answers');
    this.liveCanvas = make('layer-live');
    this.liveCanvas.setAttribute('aria-label', 'Handwriting canvas');
    this.liveCanvas.setAttribute('role', 'img');
    this.ink = this.inkCanvas.getContext('2d')!;
    // `desynchronized` lets Chromium bypass the compositor for lower pen latency.
    this.live = (this.liveCanvas.getContext('2d', { desynchronized: true }) ?? this.liveCanvas.getContext('2d'))!;

    this.cleanups.push(
      store.subscribe(({ added, removed }) => {
        if (removed.length > 0) this.fullRedraw = true;
        else this.incremental.push(...added);
        this.requestFrame();
      }),
    );

    this.bindInput();
    this.observeSize();
  }

  /* ───────────────────────── sizing / DPR ───────────────────────── */

  private observeSize(): void {
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.container);
    this.cleanups.push(() => ro.disconnect());

    // devicePixelRatio changes (browser zoom, moving to a Retina screen) don't
    // fire resize on the element; listen with a resolution media query.
    let mq: MediaQueryList | null = null;
    const onDpr = (): void => {
      this.resize();
      watch();
    };
    const watch = (): void => {
      mq?.removeEventListener('change', onDpr);
      mq = matchMedia(`(resolution: ${resolveDpr(window.devicePixelRatio)}dppx)`);
      mq.addEventListener('change', onDpr, { once: true });
    };
    watch();
    this.cleanups.push(() => mq?.removeEventListener('change', onDpr));
    this.resize();
  }

  resize(): void {
    const rect = this.container.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    const store = backingStoreSize(cssW, cssH, window.devicePixelRatio);
    if (store.width === this.inkCanvas.width && store.height === this.inkCanvas.height && cssW === this.width && cssH === this.height) return;
    this.width = cssW;
    this.height = cssH;
    this.scale = store.scale;
    for (const c of [this.inkCanvas, this.answerCanvas, this.liveCanvas]) {
      c.width = store.width;
      c.height = store.height;
      c.style.width = `${cssW}px`;
      c.style.height = `${cssH}px`;
    }
    this.fullRedraw = true;
    this.liveDirty = true;
    this.events.onResize?.(cssW, cssH, store.scale);
    this.renderFrame(); // synchronous so there is never a blank frame
  }

  /* ───────────────────────── input ───────────────────────── */

  private bindInput(): void {
    const el = this.liveCanvas;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      el.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on('pointerdown', (e) => this.onDown(e));
    on('pointermove', (e) => this.onMove(e));
    on('pointerup', (e) => this.onUp(e));
    on('pointercancel', (e) => this.onUp(e, true));
    on('lostpointercapture', (e) => this.onUp(e));
    on('pointerleave', () => {
      if (!this.active) {
        this.hover = null;
        this.liveDirty = true;
        this.requestFrame();
        this.events.onHoverEnd?.();
      }
    });
    on('contextmenu', (e) => e.preventDefault());
    // Prevent iOS from interpreting a long-press / double-tap as a page gesture.
    on('touchstart', (e) => e.preventDefault(), { passive: false });
  }

  private world(e: PointerEvent): { x: number; y: number } {
    return clientToWorld(e.clientX, e.clientY, this.liveCanvas.getBoundingClientRect());
  }

  private onDown(e: PointerEvent): void {
    if (this.active) return; // single-pointer inking; extra fingers are ignored
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'pen') this.lastPenTime = performance.now();
    if (e.pointerType === 'touch' && performance.now() - this.lastPenTime < PALM_REJECT_MS) return;
    e.preventDefault();
    this.liveCanvas.setPointerCapture(e.pointerId);
    const { x, y } = this.world(e);
    // Barrel/eraser button on a stylus (buttons bit 5) erases whole strokes.
    const tool: Tool = e.buttons & 32 ? 'stroke-eraser' : this.config.tool();
    if (tool === 'pen') {
      const pressure = e.pointerType === 'pen' && e.pressure > 0;
      this.active = {
        kind: 'pen',
        pointerId: e.pointerId,
        points: [x, y, pressure ? e.pressure : 0.5],
        width: this.config.penWidth(),
        color: this.config.inkKey(),
        pressure,
      };
    } else {
      const radius = this.config.eraserRadius();
      const session = new EraseSession(this.store, tool === 'stroke-eraser' ? 'stroke' : 'pixel', radius);
      session.moveTo(x, y);
      this.active = { kind: 'erase', pointerId: e.pointerId, session, x, y, radius };
    }
    this.events.onHoverEnd?.();
    this.events.onPenDown?.();
    this.liveDirty = true;
    this.requestFrame();
  }

  private onMove(e: PointerEvent): void {
    const a = this.active;
    if (!a) {
      if (e.pointerType !== 'touch') {
        const { x, y } = this.world(e);
        this.hover = { x, y };
        if (this.config.tool() !== 'pen') {
          this.liveDirty = true;
          this.requestFrame();
        }
        this.events.onHover?.(x, y, e.clientX, e.clientY);
      }
      return;
    }
    if (e.pointerId !== a.pointerId) return;
    if (e.pointerType === 'pen') this.lastPenTime = performance.now();
    // Coalesced events recover the full-rate (120–240 Hz) pen samples the
    // browser batched into this frame — essential for smooth curves.
    const samples = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const list = samples.length > 0 ? samples : [e];
    const rect = this.liveCanvas.getBoundingClientRect();
    for (const s of list) {
      const { x, y } = clientToWorld(s.clientX, s.clientY, rect);
      if (a.kind === 'pen') {
        const n = a.points.length;
        const dx = x - a.points[n - 3]!;
        const dy = y - a.points[n - 2]!;
        if (dx * dx + dy * dy < MIN_POINT_DISTANCE * MIN_POINT_DISTANCE) continue;
        a.points.push(x, y, a.pressure ? s.pressure || 0.5 : 0.5);
      } else {
        a.session.moveTo(x, y);
        a.x = x;
        a.y = y;
      }
    }
    this.liveDirty = true;
    this.requestFrame();
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    this.active = null;
    if (this.liveCanvas.hasPointerCapture(e.pointerId)) this.liveCanvas.releasePointerCapture(e.pointerId);

    if (a.kind === 'pen') {
      if (!cancelled) this.commitPen(a);
    } else {
      const cmd = a.session.finish();
      if (cmd) this.history.record(cmd);
    }
    this.liveDirty = true;
    this.requestFrame();
    this.events.onPenUp?.();
  }

  private commitPen(a: Extract<Active, { kind: 'pen' }>): void {
    const points = Float32Array.from(a.points);
    // Scratch-out: a vigorous zig-zag over existing ink deletes that ink.
    if (isScribble(points)) {
      const targets = scribbleTargets(points, this.store.all(), a.width);
      if (targets.length > 0) {
        this.history.execute({ label: 'scratch', added: [], removed: targets });
        this.events.onScratch?.(targets.length);
        return;
      }
    }
    const stroke = createStroke({ points, width: a.width, color: a.color, pressure: a.pressure });
    this.history.execute({ label: 'draw', added: [stroke], removed: [] });
  }

  /* ───────────────────────── rendering ───────────────────────── */

  requestFrame(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.renderFrame();
    });
  }

  /** Re-resolve every stroke colour (theme change). */
  invalidate(): void {
    this.fullRedraw = true;
    this.liveDirty = true;
    this.requestFrame();
  }

  private renderFrame(): void {
    const t0 = performance.now();
    const k = this.scale;
    const ink = this.ink;

    if (this.fullRedraw) {
      this.fullRedraw = false;
      this.incremental.length = 0;
      ink.setTransform(1, 0, 0, 1, 0, 0);
      ink.clearRect(0, 0, this.inkCanvas.width, this.inkCanvas.height);
      ink.setTransform(k, 0, 0, k, 0, 0);
      for (const s of this.store.all()) this.fillStroke(ink, s);
    } else if (this.incremental.length > 0) {
      ink.setTransform(k, 0, 0, k, 0, 0);
      for (const s of this.incremental) this.fillStroke(ink, s);
      this.incremental.length = 0;
    }

    if (this.liveDirty) {
      this.liveDirty = false;
      const live = this.live;
      live.setTransform(1, 0, 0, 1, 0, 0);
      live.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height);
      live.setTransform(k, 0, 0, k, 0, 0);
      const a = this.active;
      if (a?.kind === 'pen') {
        const outline = strokeOutline(a.points, a.width, a.pressure, false);
        live.beginPath();
        traceOutline(live, outline);
        live.fillStyle = this.config.resolveColor(a.color);
        live.fill();
      } else if (a?.kind === 'erase') {
        this.drawEraserCursor(a.x, a.y, a.radius, true);
      } else if (this.hover && this.config.tool() !== 'pen') {
        this.drawEraserCursor(this.hover.x, this.hover.y, this.config.eraserRadius(), false);
      }
    }
    this.events.onFrame?.(performance.now() - t0);
  }

  private fillStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
    ctx.fillStyle = this.config.resolveColor(s.color);
    ctx.fill(strokePath2D(s));
  }

  private drawEraserCursor(x: number, y: number, r: number, active: boolean): void {
    const live = this.live;
    live.beginPath();
    live.arc(x, y, r, 0, Math.PI * 2);
    live.fillStyle = active ? 'rgba(120, 120, 120, 0.12)' : 'rgba(120, 120, 120, 0.06)';
    live.fill();
    live.lineWidth = 1;
    live.strokeStyle = 'rgba(90, 90, 90, 0.55)';
    live.setLineDash(this.config.tool() === 'pixel-eraser' ? [3, 3] : []);
    live.stroke();
    live.setLineDash([]);
  }

  /** Points currently being drawn (for tests/diagnostics). */
  get activePointCount(): number {
    return this.active?.kind === 'pen' ? this.active.points.length / POINT_STRIDE : 0;
  }

  dispose(): void {
    for (const c of this.cleanups) c();
    this.container.replaceChildren();
  }
}
