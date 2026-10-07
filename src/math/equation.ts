import { evaluateExpression, type EvalResult } from './evaluate';

export type EquationAnalysis =
  /** No terminal equals sign yet — nothing to project. */
  | { mode: 'none'; lhs: string }
  /** `18+4×3=` — compute and project the answer. */
  | { mode: 'compute'; lhs: string; result: EvalResult }
  /** `2+2=5` — the user wrote their own answer; check it. */
  | { mode: 'check'; lhs: string; rhs: string; result: EvalResult; written: EvalResult; correct: boolean | null }
  /** More than one `=` (e.g. `1=2=`). */
  | { mode: 'invalid'; lhs: string; message: string };

const EQUALS = /=/g;

/**
 * Split a recognised line on `=` and decide what to do with it.
 * The input is the recognised symbol string, e.g. `"18+4×3="`.
 */
export function analyzeEquation(line: string): EquationAnalysis {
  const count = (line.match(EQUALS) ?? []).length;
  if (count === 0) return { mode: 'none', lhs: line };
  if (count > 1) return { mode: 'invalid', lhs: line, message: 'Too many "=" signs' };

  const at = line.indexOf('=');
  const lhs = line.slice(0, at);
  const rhs = line.slice(at + 1).trim();
  const result = evaluateExpression(lhs);
  if (rhs === '') return { mode: 'compute', lhs, result };

  const written = evaluateExpression(rhs);
  const correct =
    result.kind === 'value' && written.kind === 'value' ? result.value.equals(written.value) || result.text === written.text : null;
  return { mode: 'check', lhs, rhs, result, written, correct };
}
