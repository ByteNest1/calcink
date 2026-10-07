/// <reference lib="webworker" />
/**
 * Recognition worker — everything heavy lives here, off the UI thread:
 * segmentation, rasterisation, ONNX Runtime (WASM) inference and evaluation.
 * The UI thread only streams stroke deltas in and draws results out, so the
 * pen stays at 60 FPS no matter what the model is doing.
 */
import * as ort from 'onnxruntime-web/wasm';
import { RecognitionEngine, type DigitClassifier } from './engine';
import { createOrtClassifier, MNIST_INPUT } from './ortClassifier';
import type { FromWorker, ToWorker } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const post = (msg: FromWorker): void => self.postMessage(msg);

let resolveClassifier!: (c: DigitClassifier) => void;
const classifierReady = new Promise<DigitClassifier>((r) => (resolveClassifier = r));

/** Uniform "don't know" scores, used if the model cannot be loaded at all. */
const fallbackClassifier: DigitClassifier = async (images) => images.map(() => new Float32Array(10).fill(0.1));

const engine = new RecognitionEngine(async (images) => (await classifierReady)(images));

async function loadModel(modelUrl: string, wasmUrl: string): Promise<void> {
  const t0 = performance.now();
  try {
    // Single-threaded WASM: needs no cross-origin isolation, so it runs on
    // any static host (GitHub Pages, Netlify…). The model is tiny anyway.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = { wasm: wasmUrl };
    const bytes = new Uint8Array(await (await fetch(modelUrl)).arrayBuffer());
    const session = await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    const loadMs = performance.now() - t0;
    // Warm-up run so the first real stroke doesn't pay JIT/allocation costs.
    const t1 = performance.now();
    const warm = new ort.Tensor('float32', new Float32Array(784), [1, 1, 28, 28]);
    const res = await session.run({ [MNIST_INPUT]: warm });
    warm.dispose();
    for (const t of Object.values(res)) t.dispose();
    resolveClassifier(createOrtClassifier(ort, session));
    post({ type: 'ready', backend: 'wasm', loadMs, warmupMs: performance.now() - t1 });
  } catch (err) {
    resolveClassifier(fallbackClassifier);
    post({ type: 'model-error', message: err instanceof Error ? err.message : String(err) });
  }
}

// Messages are processed strictly in order; bursts of recognise requests
// coalesce into one run against the latest stroke state.
let chain: Promise<void> = Promise.resolve();
let latestRev = -1;
let recognizeQueued = false;

self.onmessage = (e: MessageEvent<ToWorker>): void => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      chain = chain.then(() => {
        void loadModel(msg.modelUrl, msg.wasmUrl);
      });
      break;
    case 'sync':
      chain = chain.then(() => {
        if (msg.reset) engine.reset();
        engine.sync(msg.add, msg.remove);
      });
      break;
    case 'recognize':
      latestRev = msg.rev;
      if (recognizeQueued) break;
      recognizeQueued = true;
      chain = chain.then(async () => {
        recognizeQueued = false;
        const rev = latestRev;
        try {
          post({ type: 'result', rev, output: await engine.recognize() });
        } catch (err) {
          post({ type: 'error', rev, message: err instanceof Error ? err.message : String(err) });
        }
      });
      break;
  }
};
