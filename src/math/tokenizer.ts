import { Rational } from './rational';

export type Operator = '+' | '-' | '*' | '/';

export type Token =
  | { type: 'number'; value: Rational; text: string; index: number }
  | { type: 'op'; op: Operator; index: number }
  | { type: 'lparen'; index: number }
  | { type: 'rparen'; index: number };

export class MathSyntaxError extends Error {
  readonly index: number;
  constructor(message: string, index: number) {
    super(message);
    this.name = 'MathSyntaxError';
    this.index = index;
  }
}

/**
 * Canonicalise the many glyphs a recogniser (or a human) might produce for
 * the same operator: − – — → '-', × x · * → '*', ÷ / : → '/'.
 */
const OPERATOR_ALIASES: Record<string, Operator> = {
  '+': '+',
  '-': '-',
  '−': '-',
  '–': '-',
  '—': '-',
  '*': '*',
  '×': '*',
  '·': '*',
  '⋅': '*',
  x: '*',
  X: '*',
  '/': '/',
  '÷': '/',
  ':': '/',
};

const isDigit = (c: string): boolean => c >= '0' && c <= '9';

/** Convert an expression string into tokens. Throws {@link MathSyntaxError}. */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n') {
      i++;
      continue;
    }
    if (isDigit(c) || c === '.' || c === ',') {
      const start = i;
      let text = '';
      while (i < src.length && (isDigit(src[i]!) || src[i] === '.' || src[i] === ',')) {
        text += src[i] === ',' ? '.' : src[i];
        i++;
      }
      if ((text.match(/\./g) ?? []).length > 1) {
        throw new MathSyntaxError(`Malformed number "${text}"`, start);
      }
      const value = Rational.parseDecimal(text);
      if (!value) throw new MathSyntaxError(`Malformed number "${text}"`, start);
      tokens.push({ type: 'number', value, text, index: start });
      continue;
    }
    const op = OPERATOR_ALIASES[c];
    if (op) {
      tokens.push({ type: 'op', op, index: i });
      i++;
      continue;
    }
    if (c === '(' || c === '[') {
      tokens.push({ type: 'lparen', index: i++ });
      continue;
    }
    if (c === ')' || c === ']') {
      tokens.push({ type: 'rparen', index: i++ });
      continue;
    }
    throw new MathSyntaxError(`Unexpected symbol "${c}"`, i);
  }
  return tokens;
}
