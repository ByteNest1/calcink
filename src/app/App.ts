import { AnswerLayer, type AnswerPalette } from '../canvas/AnswerLayer';
import { InkSurface } from '../canvas/InkSurface';
import { History } from '../ink/History';
import { StrokeStore } from '../ink/StrokeStore';
import type { Tool } from '../ink/types';
import { RecognizerClient, type ModelState } from '../recognition/RecognizerClient';
import type { LineResult, RecognitionStats } from '../recognition/types';
import { Feedback } from './feedback';
import { HoverCard } from './HoverCard';
import { ICONS } from './icons';
import { PerfHud } from './PerfHud';
import { DEFAULT_PREFS, loadNotebook, loadPrefs, saveNotebook, savePrefs, type Prefs } from './storage';

const INKS = [
  { key: 'ink', label: 'Ink', cssVar: '--ink' },
  { key: 'blue', label: 'Blue', cssVar: '--ink-blue' },
  { key: 'red', label: 'Red', cssVar: '--ink-red' },
] as const;

const PEN_RANGE = { min: 1.5, max: 12 };
const ERASER_RANGE = { min: 6, max: 48 };

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

/** Wires the store, history, canvas, recogniser and chrome together. */
export class App {
  readonly store = new StrokeStore();
  readonly history = new History(this.store);
  private readonly prefs: Prefs = loadPrefs();
  private tool: Tool = 'pen';
  private readonly feedback = new Feedback(this.prefs.sound);
  private readonly perf = new PerfHud($('#perf'));
  private readonly hover = new HoverCard($('#hovercard'));
  private readonly root = $<HTMLDivElement>('#app');
  private readonly status = $<HTMLDivElement>('#status');
  private readonly toastEl = $<HTMLDivElement>('#toast');
  private readonly help = $<HTMLDialogElement>('#help');
  private colors = new Map<string, string>();
  private surface!: InkSurface;
  private answers!: AnswerLayer;
  private recognizer!: RecognizerClient;
  private insight = false;
  private lastLines: LineResult[] = [];
  private lastStats: RecognitionStats | null = null;
  private lastRtt: number | null = null;
  private resultCount = 0;
  private offlineReady = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private buttons: Record<string, HTMLButtonElement> = {};
  private sizeInput!: HTMLInputElement;
  private sizeDot!: HTMLElement;

  start(): void {
    this.applyTheme();
    this.readPalette();

    // Restore the last notebook before anything subscribes, so it is one batch.
    const saved = loadNotebook();
    if (saved.length) this.store.apply(saved, []);

    this.surface = new InkSurface(
      $('#paper'),
      this.store,
      this.history,
      {
        tool: () => this.tool,
        penWidth: () => this.prefs.penWidth,
        eraserRadius: () => this.prefs.eraserRadius,
        inkKey: () => this.prefs.ink,
        resolveColor: (k) => this.colors.get(k) ?? this.colors.get('ink') ?? '#222',
      },
      {
        onPenDown: () => {
          this.feedback.unlock();
          this.recognizer.setPenDown(true);
          this.hover.hide();
        },
        onPenUp: () => this.recognizer.setPenDown(false),
        onScratch: (n) => {
          this.feedback.erased();
          this.toast(`Scratched out ${n} stroke${n === 1 ? '' : 's'}`, 'Undo', () => this.history.undo());
        },
        onHover: (x, y, cx, cy) => {
          const p = this.answers.hitTest(x, y);
          if (p) this.hover.show(p, cx, cy, this.lastRtt);
          else this.hover.hide();
        },
        onHoverEnd: () => this.hover.hide(),
        onFrame: (ms) => this.perf.recordFrame(ms),
        onResize: (_w, _h, scale) => this.answers?.resize(scale),
      },
    );
    this.answers = new AnswerLayer(this.surface.answerCanvas, this.answerPalette());
    this.answers.resize(this.surface.scale);

    this.recognizer = new RecognizerClient(this.store, {
      onResult: (output, rtt) => this.onResult(output.lines, output.stats, rtt),
      onModelState: (s) => this.renderStatus(s),
    });

    this.store.subscribe(() => {
      this.updateHint();
      this.scheduleSave();
    });
    this.history.subscribe(() => this.updateHistoryButtons());

    this.buildToolbar();
    this.bindKeys();
    this.bindSystem();
    this.updateHint();
    this.setTool('pen');
    this.renderStatus(this.recognizer.state);

    if (new URLSearchParams(location.search).has('perf')) this.togglePerf(true);
    this.exposeTestHooks();
  }

  /* ───────────────────────── recognition results ───────────────────────── */

  private onResult(lines: LineResult[], stats: RecognitionStats, rtt: number): void {
    this.lastLines = lines;
    this.lastStats = stats;
    this.lastRtt = rtt;
    this.perf.recordRecognition(stats, rtt);
    const changed = this.answers.update(lines);
    // No chime for answers restored on page load.
    if (this.resultCount++ > 0 && changed.length > 0) this.feedback.answer(changed[changed.length - 1]!.status);
  }

  /* ───────────────────────── theme ───────────────────────── */

  private applyTheme(): void {
    const t = this.prefs.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  private readPalette(): void {
    const cs = getComputedStyle(document.documentElement);
    this.colors = new Map(INKS.map((i) => [i.key, cs.getPropertyValue(i.cssVar).trim()]));
  }

  private answerPalette(): AnswerPalette {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string): string => cs.getPropertyValue(n).trim();
    return { answer: v('--answer'), ok: v('--ok'), bad: v('--bad'), warn: v('--warn'), muted: v('--muted'), insight: v('--insight') };
  }

  private refreshTheme(): void {
    this.readPalette();
    this.answers.setPalette(this.answerPalette());
    this.surface.invalidate();
    const meta = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
    meta.forEach((m) => {
      if (this.prefs.theme !== 'auto') m.content = paper;
    });
    this.buildSwatchColors();
  }

  private toggleTheme(): void {
    const dark =
      this.prefs.theme === 'dark' || (this.prefs.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    this.prefs.theme = dark ? 'light' : 'dark';
    savePrefs(this.prefs);
    this.applyTheme();
    this.refreshTheme();
  }

  /* ───────────────────────── toolbar ───────────────────────── */

  private button(id: string, icon: string, label: string, onClick: () => void, pressed?: boolean): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tb-btn';
    b.innerHTML = icon;
    b.title = label;
    b.setAttribute('aria-label', label.replace(/\s*\(.*\)$/, ''));
    if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', onClick);
    b.dataset.id = id;
    this.buttons[id] = b;
    return b;
  }

  private group(...children: HTMLElement[]): HTMLDivElement {
    const g = document.createElement('div');
    g.className = 'tb-group';
    g.append(...children);
    return g;
  }

  private sep(): HTMLDivElement {
    const s = document.createElement('div');
    s.className = 'tb-sep';
    return s;
  }

  private buildToolbar(): void {
    const bar = $('#toolbar');
    const tools = this.group(
      this.button('pen', ICONS.pen, 'Pen (P)', () => this.setTool('pen'), true),
      this.button('stroke-eraser', ICONS.strokeEraser, 'Stroke eraser (E)', () => this.setTool('stroke-eraser'), false),
      this.button('pixel-eraser', ICONS.pixelEraser, 'Pixel eraser (X)', () => this.setTool('pixel-eraser'), false),
    );

    const size = document.createElement('label');
    size.className = 'tb-size';
    size.title = 'Size ([ and ])';
    size.innerHTML = '<span class="tb-size-dot"><i></i></span><input type="range" step="0.5" aria-label="Stroke width" />';
    this.sizeInput = size.querySelector('input')!;
    this.sizeDot = size.querySelector('i')!;
    this.sizeInput.addEventListener('input', () => this.setSize(Number(this.sizeInput.value)));

    const swatches = this.group(
      ...INKS.map((ink) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tb-swatch';
        b.title = `${ink.label} ink`;
        b.setAttribute('aria-label', `${ink.label} ink`);
        b.setAttribute('aria-pressed', String(this.prefs.ink === ink.key));
        b.dataset.ink = ink.key;
        b.innerHTML = '<span></span>';
        b.addEventListener('click', () => {
          this.prefs.ink = ink.key;
          savePrefs(this.prefs);
          bar.querySelectorAll<HTMLElement>('.tb-swatch').forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.ink === ink.key)));
          if (this.tool !== 'pen') this.setTool('pen');
        });
        return b;
      }),
    );

    const edit = this.group(
      this.button('undo', ICONS.undo, 'Undo (Ctrl+Z)', () => this.history.undo()),
      this.button('redo', ICONS.redo, 'Redo (Ctrl+Shift+Z)', () => this.history.redo()),
      this.button('clear', ICONS.clear, 'Clear page (Shift+Delete)', () => this.clear()),
    );

    const view = this.group(
      this.button('insight', ICONS.insight, 'Show what CalcInk sees (I)', () => this.toggleInsight(), false),
      this.button('sound', this.prefs.sound ? ICONS.soundOn : ICONS.soundOff, 'Sound & haptics', () => this.toggleSound(), this.prefs.sound),
      this.button('theme', ICONS.theme, 'Light / dark paper', () => this.toggleTheme()),
      this.button('perf', ICONS.perf, 'Performance monitor (F)', () => this.togglePerf(), false),
      this.button('help', ICONS.help, 'Help (?)', () => this.help.showModal()),
    );

    bar.append(tools, this.sep(), size, swatches, this.sep(), edit, this.sep(), view);
    this.buildSwatchColors();
    this.updateHistoryButtons();
  }

  private buildSwatchColors(): void {
    document.querySelectorAll<HTMLElement>('.tb-swatch').forEach((s) => {
      s.style.setProperty('--sw', this.colors.get(s.dataset.ink ?? 'ink') ?? '#222');
    });
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.root.dataset.tool = tool;
    for (const id of ['pen', 'stroke-eraser', 'pixel-eraser']) this.buttons[id]?.setAttribute('aria-pressed', String(id === tool));
    const pen = tool === 'pen';
    const range = pen ? PEN_RANGE : ERASER_RANGE;
    this.sizeInput.min = String(range.min);
    this.sizeInput.max = String(range.max);
    this.sizeInput.value = String(pen ? this.prefs.penWidth : this.prefs.eraserRadius);
    this.sizeInput.setAttribute('aria-label', pen ? 'Pen width' : 'Eraser size');
    this.updateSizeDot();
    this.surface.invalidate();
  }

  private setSize(v: number): void {
    if (this.tool === 'pen') this.prefs.penWidth = Math.min(PEN_RANGE.max, Math.max(PEN_RANGE.min, v));
    else this.prefs.eraserRadius = Math.min(ERASER_RANGE.max, Math.max(ERASER_RANGE.min, v));
    this.sizeInput.value = String(this.tool === 'pen' ? this.prefs.penWidth : this.prefs.eraserRadius);
    this.updateSizeDot();
    savePrefs(this.prefs);
  }

  private updateSizeDot(): void {
    const px = this.tool === 'pen' ? this.prefs.penWidth * 1.2 : 6 + (this.prefs.eraserRadius / ERASER_RANGE.max) * 14;
    this.sizeDot.style.width = this.sizeDot.style.height = `${Math.max(3, Math.min(20, px))}px`;
  }

  private updateHistoryButtons(): void {
    if (this.buttons.undo) this.buttons.undo.disabled = !this.history.canUndo;
    if (this.buttons.redo) this.buttons.redo.disabled = !this.history.canRedo;
    if (this.buttons.clear) this.buttons.clear.disabled = this.store.size === 0;
  }

  private clear(): void {
    if (this.store.size === 0) return;
    this.history.execute({ label: 'clear', added: [], removed: [...this.store.all()] });
    this.toast('Page cleared', 'Undo', () => this.history.undo());
  }

  private toggleInsight(): void {
    this.insight = !this.insight;
    this.answers.setInsight(this.insight);
    this.buttons.insight?.setAttribute('aria-pressed', String(this.insight));
  }

  private toggleSound(): void {
    this.prefs.sound = !this.prefs.sound;
    this.feedback.enabled = this.prefs.sound;
    savePrefs(this.prefs);
    const b = this.buttons.sound!;
    b.innerHTML = this.prefs.sound ? ICONS.soundOn : ICONS.soundOff;
    b.setAttribute('aria-pressed', String(this.prefs.sound));
  }

  private togglePerf(force?: boolean): void {
    const on = this.perf.toggle(force);
    this.buttons.perf?.setAttribute('aria-pressed', String(on));
  }

  /* ───────────────────────── chrome ───────────────────────── */

  private updateHint(): void {
    $('#hint').hidden = this.store.size > 0;
    this.updateHistoryButtons();
  }

  private renderStatus(s: ModelState): void {
    const text = this.status.querySelector('.status-text')!;
    this.status.dataset.state = s.kind;
    if (s.kind === 'loading') text.textContent = 'Loading on-device model…';
    else if (s.kind === 'error') text.textContent = 'Model unavailable — operators only';
    else if (!navigator.onLine) text.textContent = 'Offline · running on-device';
    else text.textContent = this.offlineReady ? 'On-device · works offline' : 'On-device model ready';
    this.status.title =
      s.kind === 'ready'
        ? `MNIST-12 CNN via ONNX Runtime Web (${s.backend}) in a Web Worker · loaded in ${s.loadMs.toFixed(0)} ms`
        : s.kind === 'error'
          ? s.message
          : '';
  }

  setOfflineReady(): void {
    this.offlineReady = true;
    this.renderStatus(this.recognizer.state);
  }

  private toast(message: string, action?: string, onAction?: () => void): void {
    const el = this.toastEl;
    el.replaceChildren();
    const span = document.createElement('span');
    span.textContent = message;
    el.append(span);
    if (action && onAction) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = action;
      b.addEventListener('click', () => {
        onAction();
        el.hidden = true;
      });
      el.append(b);
    }
    el.hidden = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (el.hidden = true), 4000);
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => saveNotebook(this.store.all()), 500);
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (this.help.open) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.history.redo();
        else this.history.undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        this.history.redo();
      } else if (mod || e.altKey) {
        return;
      } else if (k === 'p') this.setTool('pen');
      else if (k === 'e') this.setTool('stroke-eraser');
      else if (k === 'x') this.setTool('pixel-eraser');
      else if (k === 'i') this.toggleInsight();
      else if (k === 'f') this.togglePerf();
      else if (k === '[') this.setSize(Number(this.sizeInput.value) - (this.tool === 'pen' ? 0.5 : 2));
      else if (k === ']') this.setSize(Number(this.sizeInput.value) + (this.tool === 'pen' ? 0.5 : 2));
      else if (e.key === '?') this.help.showModal();
      else if (e.key === 'Delete' && e.shiftKey) this.clear();
    });
  }

  private bindSystem(): void {
    const update = (): void => this.renderStatus(this.recognizer.state);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (this.prefs.theme === 'auto') this.refreshTheme();
    });
    // Persist immediately when the tab is hidden (mobile browsers may kill it).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveNotebook(this.store.all());
    });
  }

  /** Read-only hooks for automated E2E tests and debugging from the console. */
  private exposeTestHooks(): void {
    (window as unknown as { __calcink: unknown }).__calcink = {
      lines: () => this.lastLines.map((l) => ({ text: l.text, answer: l.answer, confidence: l.confidence, anchor: l.anchor })),
      stats: () => this.lastStats,
      model: () => this.recognizer.state,
      strokes: () => this.store.size,
      history: () => this.history.depth,
      perf: () => (window as unknown as { __calcinkPerf: () => unknown }).__calcinkPerf(),
      startPerfSampling: () => this.perf.startSampling(),
      resetPerf: () => this.perf.resetCounters(),
      setTool: (t: Tool) => this.setTool(t),
      reset: () => {
        this.store.apply([], [...this.store.all()]);
        this.history.reset();
        Object.assign(this.prefs, DEFAULT_PREFS);
      },
    };
  }
}
