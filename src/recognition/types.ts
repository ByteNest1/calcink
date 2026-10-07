import type { BBox } from '../ink/types';

/** Minimal stroke data shipped to the recognition worker. */
export interface StrokeData {
  id: string;
  /** Flat `[x, y, p, …]` in world coordinates. */
  points: Float32Array;
  bbox: BBox;
}

/** Characters the recogniser can emit. */
export type Glyph =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | '+' | '−' | '×' | '÷' | '=' | '.';

export const DIGITS: readonly Glyph[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export interface Alternative {
  char: Glyph;
  p: number;
}

export interface SymbolResult {
  char: Glyph;
  /** Calibrated-ish confidence in [0, 1]. */
  confidence: number;
  /** Which stage decided: the neural model or the stroke-geometry analyser. */
  source: 'model' | 'geometry';
  /** Runner-up classes (model only). */
  alternatives: Alternative[];
  bbox: BBox;
  strokeIds: string[];
}

export type AnswerStatus = 'value' | 'undefined' | 'error' | 'correct' | 'incorrect' | 'invalid';

export interface AnswerSummary {
  status: AnswerStatus;
  /** Text to project on the canvas (already typographic, e.g. "−12.5"). */
  text: string;
  /** Exact decimal or not (1 ÷ 3 is shown rounded). */
  exact: boolean;
  /** Exact fraction form when not an integer, e.g. "1/3". */
  fraction?: string;
  /** Human-readable explanation for errors / Undefined. */
  message?: string;
}

export interface LineResult {
  /** Stable identity across edits (derived from the "=" strokes when present). */
  key: string;
  bbox: BBox;
  /** Typical symbol height on this line (px). */
  refHeight: number;
  /** Median top / bottom of full-height symbols — the writing band. */
  bandTop: number;
  bandBottom: number;
  symbols: SymbolResult[];
  /** Recognised text, e.g. "18+4×3=" */
  text: string;
  /** Box the answer is anchored to (the "=" sign, or the last symbol when checking). */
  anchor: BBox | null;
  answer: AnswerSummary | null;
  /** Lowest symbol confidence on the line. */
  confidence: number;
}

export interface RecognitionStats {
  strokes: number;
  symbols: number;
  modelRuns: number;
  cacheHits: number;
  segmentMs: number;
  inferMs: number;
  totalMs: number;
}

export interface RecognitionOutput {
  lines: LineResult[];
  stats: RecognitionStats;
}
