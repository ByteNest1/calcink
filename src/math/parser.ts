import type { Operator, Token } from './tokenizer';
import { MathSyntaxError } from './tokenizer';
import type { Rational } from './rational';

export type Node =
  | { kind: 'num'; value: Rational }
  | { kind: 'neg'; operand: Node }
  | { kind: 'bin'; op: Operator; left: Node; right: Node };

const MAX_DEPTH = 256;

/**
 * Recursive-descent parser implementing BODMAS/PEMDAS precedence:
 *
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/') unary)*
 *   unary      := ('+' | '-') unary | primary
 *   primary    := NUMBER | '(' expression ')'
 *
 * Binary operators are left-associative, so `8 ÷ 4 ÷ 2 = 1` and
 * `10 − 3 − 2 = 5`. Unary minus supports negative literals anywhere an
 * operand is allowed (`-5 + 3`, `3 × -2`, `--4`).
 */
export function parse(tokens: readonly Token[]): Node {
  let pos = 0;
  let depth = 0;

  const peek = (): Token | undefined => tokens[pos];
  const endIndex = (): number => {
    const last = tokens[tokens.length - 1];
    return last ? last.index + 1 : 0;
  };

  function enter(): void {
    if (++depth > MAX_DEPTH) throw new MathSyntaxError('Expression nested too deeply', peek()?.index ?? 0);
  }

  function expression(): Node {
    enter();
    let left = term();
    for (let t = peek(); t?.type === 'op' && (t.op === '+' || t.op === '-'); t = peek()) {
      pos++;
      left = { kind: 'bin', op: t.op, left, right: term() };
    }
    depth--;
    return left;
  }

  function term(): Node {
    let left = unary();
    for (let t = peek(); t?.type === 'op' && (t.op === '*' || t.op === '/'); t = peek()) {
      pos++;
      left = { kind: 'bin', op: t.op, left, right: unary() };
    }
    return left;
  }

  function unary(): Node {
    const t = peek();
    if (t?.type === 'op' && (t.op === '-' || t.op === '+')) {
      pos++;
      enter();
      const operand = unary();
      depth--;
      return t.op === '-' ? { kind: 'neg', operand } : operand;
    }
    return primary();
  }

  function primary(): Node {
    const t = peek();
    if (!t) throw new MathSyntaxError('Expression ends unexpectedly', endIndex());
    if (t.type === 'number') {
      pos++;
      return { kind: 'num', value: t.value };
    }
    if (t.type === 'lparen') {
      pos++;
      const inner = expression();
      const close = peek();
      if (close?.type !== 'rparen') throw new MathSyntaxError('Missing closing parenthesis', close?.index ?? endIndex());
      pos++;
      return inner;
    }
    if (t.type === 'rparen') throw new MathSyntaxError('Unexpected closing parenthesis', t.index);
    throw new MathSyntaxError(`Operator "${t.op}" is missing an operand`, t.index);
  }

  if (tokens.length === 0) throw new MathSyntaxError('Empty expression', 0);
  const tree = expression();
  const extra = peek();
  if (extra) {
    const msg = extra.type === 'number' ? 'Missing operator between numbers' : 'Unexpected symbol';
    throw new MathSyntaxError(msg, extra.index);
  }
  return tree;
}
