import wasmAssetUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import type { StrokeStore } from '../ink/StrokeStore';
import type { Stroke } from '../ink/types';
import type { FromWorker, ToWorker } from './protocol';
import type { RecognitionOutput, StrokeData } from './types';

export type ModelState =
  | { kind: 'loading' }
  | { kind: 'ready'; loadMs: number; warmupMs: number; backend: string }
  | { kind: 'error'; message: string };

export interface RecognizerEvents {
  onResult(output: RecognitionOutput, roundTripMs: number): void;
  onModelState(state: ModelState): void;
}

/** Default pause after the pen lifts before recognising (ms). */
export const SETTLE_DELAY = 260;

function toData(s: Stroke): StrokeData {
  // Copy: the worker gets its own buffer, which we can transfer for free.
  return { id: s.id, points: s.points.slice(), bbox: { ...s.bbox } };
}

/**
 * UI-thread proxy for the recognition worker.
 *
 * Streams *deltas* (added strokes / removed ids) rather than the whole page,
 * debounces requests while the user is writing, and drops stale results by
 * revision number so the canvas never flickers back to an older answer.
 */
export class RecognizerClient {
  private readonly worker: Worker;
  private readonly pendingAdd = new Map<string, Stroke>();
  private readonly pendingRemove = new Set<string>();
  private rev = 0;
  private appliedRev = -1;
  private readonly sentAt = new Map<number, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private penDown = false;
  private readonly unsubscribe: () => void;
  state: ModelState = { kind: 'loading' };

  constructor(
    store: StrokeStore,
    private readonly events: RecognizerEvents,
  ) {
    this.worker = new Worker(new URL('./recognizer.worker.ts', import.meta.url), { type: 'module', name: 'calcink-recognizer' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.handle(e.data);
    this.worker.onerror = (e) => {
      this.setState({ kind: 'error', message: e.message || 'Recognition worker failed to start' });
    };
    const base = document.baseURI;
    this.post({
      type: 'init',
      modelUrl: new URL('models/mnist-12.onnx', base).href,
      wasmUrl: new URL(wasmAssetUrl, base).href,
    });

    for (const s of store.all()) this.pendingAdd.set(s.id, s);
    this.unsubscribe = store.subscribe(({ added, removed }) => {
      for (const s of removed) {
        if (this.pendingAdd.has(s.id)) this.pendingAdd.delete(s.id);
        else this.pendingRemove.add(s.id);
      }
      for (const s of added) {
        this.pendingRemove.delete(s.id);
        this.pendingAdd.set(s.id, s);
      }
      this.schedule(SETTLE_DELAY);
    });
    if (store.size > 0) this.schedule(0);
  }

  /** While the pen is down we hold off: recognising half a glyph is wasted work. */
  setPenDown(down: boolean): void {
    this.penDown = down;
    if (!down && (this.pendingAdd.size || this.pendingRemove.size)) this.schedule(SETTLE_DELAY);
  }

  /** Force a recognition pass soon (e.g. after undo). */
  schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.penDown) return; // re-scheduled on pen up
      this.flush();
    }, delay);
  }

  private flush(): void {
    if (this.pendingAdd.size || this.pendingRemove.size) {
      const add = [...this.pendingAdd.values()].map(toData);
      const remove = [...this.pendingRemove];
      this.pendingAdd.clear();
      this.pendingRemove.clear();
      this.post({ type: 'sync', add, remove }, add.map((s) => s.points.buffer as ArrayBuffer));
    }
    const rev = ++this.rev;
    this.sentAt.set(rev, performance.now());
    this.post({ type: 'recognize', rev });
  }

  private handle(msg: FromWorker): void {
    switch (msg.type) {
      case 'ready':
        this.setState({ kind: 'ready', loadMs: msg.loadMs, warmupMs: msg.warmupMs, backend: msg.backend });
        break;
      case 'model-error':
        this.setState({ kind: 'error', message: msg.message });
        break;
      case 'result': {
        const started = this.sentAt.get(msg.rev) ?? performance.now();
        for (const r of this.sentAt.keys()) if (r <= msg.rev) this.sentAt.delete(r);
        if (msg.rev <= this.appliedRev) return;
        this.appliedRev = msg.rev;
        this.events.onResult(msg.output, performance.now() - started);
        break;
      }
      case 'error':
        console.warn('[CalcInk] recognition error', msg.message);
        break;
    }
  }

  private setState(s: ModelState): void {
    this.state = s;
    this.events.onModelState(s);
  }

  private post(msg: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.unsubscribe();
    this.worker.terminate();
  }
}
