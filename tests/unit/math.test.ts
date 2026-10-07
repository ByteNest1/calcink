import { describe, expect, it } from 'vitest';
import { analyzeEquation, evaluateExpression, formatRational, Rational, toDisplay, tokenize } from '../../src/math';

const value = (src: string): string => {
  const r = evaluateExpression(src);
  if (r.kind !== 'value') throw new Error(`expected value for "${src}", got ${JSON.stringify(r)}`);
  return r.text;
};

describe('tokenizer', () => {
  it('reads multi-digit integers and decimals', () => {
    const t = tokenize('18+4.25');
    expect(t.map((x) => x.type)).toEqual(['number', 'op', 'number']);
    expect(t[2]).toMatchObject({ text: '4.25' });
  });

  it('normalises operator glyphs from the recogniser', () => {
    const ops = tokenize('1×2÷3−4·5x6').filter((t) => t.type === 'op');
    expect(ops.map((t) => (t.type === 'op' ? t.op : ''))).toEqual(['*', '/', '-', '*', '*']);
  });

  it('accepts leading and trailing decimal points', () => {
    expect(value('.5+5.')).toBe('5.5');
  });

  it('rejects numbers with two decimal points', () => {
    expect(() => tokenize('1.2.3')).toThrow(/Malformed/);
  });

  it('rejects unknown symbols', () => {
    expect(() => tokenize('2$3')).toThrow(/Unexpected symbol/);
  });
});

describe('operator precedence (BODMAS / PEMDAS)', () => {
  it.each([
    ['18+4×3', '30'],
    ['2+3×4−5', '9'],
    ['10−4÷2', '8'],
    ['8÷4÷2', '1'],
    ['10−3−2', '5'],
    ['2×3+4×5', '26'],
    ['100÷10×2', '20'],
    ['(2+3)×4', '20'],
    ['2×(3+4)×5', '70'],
    ['1+2×3−4÷2', '5'],
  ])('%s = %s', (src, expected) => {
    expect(value(src)).toBe(expected);
  });
});

describe('numbers', () => {
  it('handles multi-digit integers', () => {
    expect(value('123456+654321')).toBe('777777');
  });

  it('handles floating point decimals exactly', () => {
    expect(value('0.1+0.2')).toBe('0.3');
    expect(value('1.5×1.5')).toBe('2.25');
    expect(value('7.25−0.25')).toBe('7');
  });

  it('handles negative numbers via unary minus', () => {
    expect(value('-5+3')).toBe('-2');
    expect(value('3×-2')).toBe('-6');
    expect(value('-3×-3')).toBe('9');
    expect(value('--4')).toBe('4');
    expect(value('5−-5')).toBe('10');
    expect(value('-(2+3)')).toBe('-5');
  });

  it('rounds non-terminating results and flags them as inexact', () => {
    const r = evaluateExpression('1÷3');
    expect(r).toMatchObject({ kind: 'value', text: '0.3333333333', exact: false });
    expect(value('2÷3')).toBe('0.6666666667');
  });

  it('keeps exact flag for terminating results', () => {
    expect(evaluateExpression('1÷8')).toMatchObject({ text: '0.125', exact: true });
  });

  it('uses scientific notation for huge and tiny values', () => {
    expect(value('12345678901×98765432109')).toBe('1.219326311e+21');
    expect(value('99999999999×99999999999')).toBe('1e+22'); // rounds up correctly
    expect(value('1÷30000000000000')).toMatch(/^3\.333333333e-14$/);
  });
});

describe('edge cases & fault tolerance', () => {
  it('reports division by zero as Undefined', () => {
    expect(evaluateExpression('5÷0')).toMatchObject({ kind: 'undefined', reason: 'division-by-zero' });
    expect(evaluateExpression('1÷(2−2)')).toMatchObject({ kind: 'undefined' });
    expect(evaluateExpression('0÷0')).toMatchObject({ kind: 'undefined' });
  });

  it.each(['', '   ', '+', '3+', '×3', '3××4', '3+×4', '(1+2', '1+2)', '()', '1 2', '.', '1..2'])(
    'never throws on malformed input %j',
    (src) => {
      const r = evaluateExpression(src);
      expect(r.kind).toBe('error');
    },
  );

  it('reports the error position', () => {
    const r = evaluateExpression('12+×4');
    expect(r).toMatchObject({ kind: 'error', code: 'syntax', index: 3 });
  });

  it('guards against pathological nesting', () => {
    const r = evaluateExpression('('.repeat(5000) + '1' + ')'.repeat(5000));
    expect(r.kind).toBe('error');
  });

  it('guards against absurdly long expressions', () => {
    expect(evaluateExpression('1+'.repeat(2000) + '1')).toMatchObject({ kind: 'error', code: 'too-long' });
  });

  it('does not use eval', () => {
    // Anything JS-like is rejected by the tokenizer rather than executed.
    expect(evaluateExpression('alert(1)').kind).toBe('error');
    expect(evaluateExpression('1;2').kind).toBe('error');
  });
});

describe('formatRational', () => {
  it('formats integers, negatives and zero', () => {
    expect(formatRational(Rational.of(42n)).text).toBe('42');
    expect(formatRational(Rational.of(-7n, 2n)).text).toBe('-3.5');
    expect(formatRational(Rational.ZERO).text).toBe('0');
  });

  it('limits significant digits', () => {
    expect(formatRational(Rational.parseDecimal('123456789.123456789')!).text).toBe('123456789.123');
  });

  it('rounds half away from zero', () => {
    expect(formatRational(Rational.of(-2n, 3n)).text).toBe('-0.6666666667');
  });

  it('renders display text with a true minus sign and superscripts', () => {
    expect(toDisplay('-12')).toBe('−12');
    expect(toDisplay('1.5e+21')).toBe('1.5×10²¹');
    expect(toDisplay('3e-14')).toBe('3×10⁻¹⁴');
  });
});

describe('analyzeEquation', () => {
  it('computes when the line ends with =', () => {
    const a = analyzeEquation('18+4×3=');
    expect(a.mode).toBe('compute');
    if (a.mode === 'compute') expect(a.result).toMatchObject({ kind: 'value', text: '30' });
  });

  it('does nothing without =', () => {
    expect(analyzeEquation('18+4').mode).toBe('none');
  });

  it('checks a user-written answer', () => {
    expect(analyzeEquation('2+2=4')).toMatchObject({ mode: 'check', correct: true });
    expect(analyzeEquation('2+2=5')).toMatchObject({ mode: 'check', correct: false });
    expect(analyzeEquation('1÷3=0.3333333333')).toMatchObject({ mode: 'check', correct: true });
  });

  it('flags multiple equals signs', () => {
    expect(analyzeEquation('1=2=').mode).toBe('invalid');
  });

  it('propagates Undefined for division by zero', () => {
    const a = analyzeEquation('9÷0=');
    expect(a.mode === 'compute' && a.result.kind).toBe('undefined');
  });
});
