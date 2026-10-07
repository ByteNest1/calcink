/**
 * Exact rational arithmetic on BigInt.
 *
 * Handwritten arithmetic is evaluated on exact fractions instead of IEEE-754
 * doubles so that results are fully deterministic (`0.1 + 0.2 = 0.3`, not
 * `0.30000000000000004`) and division by zero is detected exactly rather than
 * leaking `Infinity`/`NaN` into the UI.
 */

/** Hard cap on operand size (decimal digits) to keep evaluation bounded. */
export const MAX_DIGITS = 4000;

export class OverflowError extends Error {
  constructor() {
    super('Number too large');
    this.name = 'OverflowError';
  }
}

export class DivisionByZeroError extends Error {
  constructor() {
    super('Division by zero');
    this.name = 'DivisionByZeroError';
  }
}

const abs = (n: bigint): bigint => (n < 0n ? -n : n);

function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

function digitCount(n: bigint): number {
  return abs(n).toString().length;
}

export class Rational {
  readonly num: bigint;
  readonly den: bigint;

  private constructor(num: bigint, den: bigint) {
    this.num = num;
    this.den = den;
  }

  /** Create a normalised fraction (den > 0, gcd(num, den) = 1). */
  static of(num: bigint, den: bigint = 1n): Rational {
    if (den === 0n) throw new DivisionByZeroError();
    if (den < 0n) {
      num = -num;
      den = -den;
    }
    const g = gcd(num, den);
    if (g > 1n) {
      num /= g;
      den /= g;
    }
    if (digitCount(num) > MAX_DIGITS || digitCount(den) > MAX_DIGITS) throw new OverflowError();
    return new Rational(num, den);
  }

  static readonly ZERO = new Rational(0n, 1n);
  static readonly ONE = new Rational(1n, 1n);

  /**
   * Parse an unsigned decimal literal such as `12`, `3.75`, `.5` or `7.`.
   * Returns `null` for anything that is not a well-formed literal.
   */
  static parseDecimal(text: string): Rational | null {
    if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return null;
    const [intPart = '', fracPart = ''] = text.split('.');
    const digits = (intPart + fracPart).replace(/^0+(?=\d)/, '') || '0';
    if (digits.length > MAX_DIGITS) throw new OverflowError();
    return Rational.of(BigInt(digits), 10n ** BigInt(fracPart.length));
  }

  add(o: Rational): Rational {
    return Rational.of(this.num * o.den + o.num * this.den, this.den * o.den);
  }

  sub(o: Rational): Rational {
    return Rational.of(this.num * o.den - o.num * this.den, this.den * o.den);
  }

  mul(o: Rational): Rational {
    return Rational.of(this.num * o.num, this.den * o.den);
  }

  div(o: Rational): Rational {
    if (o.num === 0n) throw new DivisionByZeroError();
    return Rational.of(this.num * o.den, this.den * o.num);
  }

  neg(): Rational {
    return new Rational(-this.num, this.den);
  }

  isZero(): boolean {
    return this.num === 0n;
  }

  isInteger(): boolean {
    return this.den === 1n;
  }

  equals(o: Rational): boolean {
    return this.num === o.num && this.den === o.den;
  }

  /** True when the value has a finite decimal expansion (den = 2^a·5^b). */
  isTerminating(): boolean {
    let d = this.den;
    while (d % 2n === 0n) d /= 2n;
    while (d % 5n === 0n) d /= 5n;
    return d === 1n;
  }

  toNumber(): number {
    return Number(this.num) / Number(this.den);
  }

  toFractionString(): string {
    return this.isInteger() ? this.num.toString() : `${this.num}/${this.den}`;
  }
}
