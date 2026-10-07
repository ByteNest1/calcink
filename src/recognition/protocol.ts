import type { RecognitionOutput, StrokeData } from './types';

/** Messages from the UI thread to the recognition worker. */
export type ToWorker =
  | { type: 'init'; modelUrl: string; wasmUrl: string }
  | { type: 'sync'; add: StrokeData[]; remove: string[]; reset?: boolean }
  | { type: 'recognize'; rev: number };

/** Messages from the worker back to the UI thread. */
export type FromWorker =
  | { type: 'ready'; backend: string; loadMs: number; warmupMs: number }
  | { type: 'model-error'; message: string }
  | { type: 'result'; rev: number; output: RecognitionOutput }
  | { type: 'error'; rev: number; message: string };
