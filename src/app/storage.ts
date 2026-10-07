import { createStroke } from '../ink/StrokeStore';
import type { Stroke } from '../ink/types';

const KEY = 'calcink:notebook:v1';
const PREFS_KEY = 'calcink:prefs:v1';

interface SavedStroke {
  i: string;
  s: number;
  w: number;
  c: string;
  p: 0 | 1;
  /** Points rounded to 0.1 px / 0.01 pressure */
  d: number[];
}

/** Serialise strokes compactly (rounded coordinates keep localStorage small). */
export function serialize(strokes: readonly Stroke[]): string {
  const out: SavedStroke[] = strokes.map((st) => ({
    i: st.id,
    s: st.seq,
    w: Math.round(st.width * 10) / 10,
    c: st.color,
    p: st.pressure ? 1 : 0,
    d: Array.from(st.points, (v, k) => (k % 3 === 2 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10)),
  }));
  return JSON.stringify({ v: 1, strokes: out });
}

export function deserialize(json: string): Stroke[] {
  const data = JSON.parse(json) as { v: number; strokes: SavedStroke[] };
  if (data?.v !== 1 || !Array.isArray(data.strokes)) return [];
  return data.strokes
    .filter((s) => Array.isArray(s.d) && s.d.length >= 3 && s.d.length % 3 === 0 && s.d.every(Number.isFinite))
    .map((s) =>
      createStroke({
        id: String(s.i),
        seq: Number(s.s) || undefined,
        width: Number(s.w) || 3,
        color: typeof s.c === 'string' ? s.c : 'ink',
        pressure: s.p === 1,
        points: Float32Array.from(s.d),
      }),
    );
}

/** localStorage can throw (private mode, quota, disabled storage) — never let that break the app. */
export function loadNotebook(): Stroke[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? deserialize(raw) : [];
  } catch {
    return [];
  }
}

export function saveNotebook(strokes: readonly Stroke[]): void {
  try {
    if (strokes.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, serialize(strokes));
  } catch {
    /* quota or disabled storage — the page still works */
  }
}

export interface Prefs {
  penWidth: number;
  eraserRadius: number;
  ink: string;
  sound: boolean;
  theme: 'auto' | 'light' | 'dark';
}

export const DEFAULT_PREFS: Prefs = { penWidth: 4, eraserRadius: 14, ink: 'ink', sound: true, theme: 'auto' };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
