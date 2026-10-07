import { DivisionByZeroError, OverflowError, Rational } from './rational';
import { MathSyntaxError, tokenize } from './tokenizer';
import { parse, type Node } from './parser';
import { formatRational } from './format';

export const MAX_TOKENS = 1000;

export type EvalResult =
  | {
      kind: 'value';
      value: Rational;
      /** ASCII decimal text (`-12.5`) */
      text: string;
      /** False if `text` is a rounded approximation (e.g. 1 ÷ 3). */
      exact: boolean;
    }
  | { kind: 'undefined'; reason: 'division-by-zero'; message: string }
  | {
      kind: 'error';
      code: 'empty' | 'syntax' | 'overflow' | 'too-long' | 'internal';
      message: string;
      index?: number;
    };

function evalNode(node: Node): Rational {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'neg':
      return evalNode(node.operand).neg();
    case 'bin': {
      const a = evalNode(node.left);
      const b = evalNode(node.right);
      switch (node.op) {
        case '+':
          return a.add(b);
        case '-':
          return a.sub(b);
        case '*':
          return a.mul(b);
        case '/':
          return a.div(b);
      }
    }
  }
}

/**
 * Safely evaluate an arithmetic expression. Never throws and never calls
 * `eval()` / `Function()`: input is tokenised, parsed into an AST and folded
 * over exact rationals.
 */
export function evaluateExpression(src: string): EvalResult {
  try {
    if (src.trim() === '') return { kind: 'error', code: 'empty', message: 'Nothing to evaluate' };
    const tokens = tokenize(src);
    if (tokens.length > MAX_TOKENS) return { kind: 'error', code: 'too-long', message: 'Expression too long' };
    const value = evalNode(parse(tokens));
    const { text, exact } = formatRational(value);
    return { kind: 'value', value, text, exact };
  } catch (err) {
    if (err instanceof DivisionByZeroError) {
      return { kind: 'undefined', reason: 'division-by-zero', message: 'Division by zero is undefined' };
    }
    if (err instanceof MathSyntaxError) {
      return { kind: 'error', code: 'syntax', message: err.message, index: err.index };
    }
    if (err instanceof OverflowError) {
      return { kind: 'error', code: 'overflow', message: 'Number too large' };
    }
    if (err instanceof RangeError) {
      return { kind: 'error', code: 'too-long', message: 'Expression too complex' };
    }
    return { kind: 'error', code: 'internal', message: 'Could not evaluate expression' };
  }
}
