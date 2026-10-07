import { Rational } from './rational';

export interface FormatOptions {
  /** Maximum digits after the decimal point. */
  maxFractionDigits: number;
  /** Maximum significant digits shown in fixed notation. */
  maxSignificantDigits: number;
  /** Integers with more digits than this switch to scientific notation. */
  maxIntegerDigits: number;
}

export const DEFAULT_FORMAT: FormatOptions = {
  maxFractionDigits: 10,
  maxSignificantDigits: 12,
  maxIntegerDigits: 15,
};

export interface FormattedNumber {
  /** ASCII representation, e.g. `-12.5`, `0.3333333333`, `1.234567e+20`. */
  text: string;
  /** False when rounding was required to produce `text`. */
  exact: boolean;
}

/** Round |num/den| * 10^k half away from zero, returning a non-negative BigInt. */
function scaledRound(num: bigint, den: bigint, k: number): bigint {
  const n = num < 0n ? -num : num;
  const scale = 10n ** BigInt(k);
  return (2n * n * scale + den) / (2n * den);
}

function trimFraction(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

function scientific(r: Rational, sig: number): FormattedNumber {
  const n = r.num < 0n ? -r.num : r.num;
  const d = r.den;
  // Find exponent e such that 10^e <= n/d < 10^(e+1).
  let e = n.toString().length - d.toString().length;
  const ge = (exp: number): boolean =>
    exp >= 0 ? n >= d * 10n ** BigInt(exp) : n * 10n ** BigInt(-exp) >= d;
  while (!ge(e)) e--;
  while (ge(e + 1)) e++;
  // mantissa digits = round(n/d * 10^(sig-1-e))
  const shift = sig - 1 - e;
  let m =
    shift >= 0
      ? (2n * n * 10n ** BigInt(shift) + d) / (2n * d)
      : (2n * n + d * 10n ** BigInt(-shift)) / (2n * d * 10n ** BigInt(-shift));
  if (m.toString().length > sig) {
    m /= 10n;
    e++;
  }
  const ms = m.toString();
  const mantissa = trimFraction(`${ms[0]}.${ms.slice(1)}`);
  const exact =
    shift >= 0 ? m * d === n * 10n ** BigInt(shift) : m * 10n ** BigInt(-shift) * d === n;
  const sign = r.num < 0n ? '-' : '';
  return { text: `${sign}${mantissa}e${e >= 0 ? '+' : ''}${e}`, exact };
}

/** Human-friendly decimal rendering of an exact rational. */
export function formatRational(r: Rational, opts: FormatOptions = DEFAULT_FORMAT): FormattedNumber {
  if (r.isZero()) return { text: '0', exact: true };

  const absNum = r.num < 0n ? -r.num : r.num;
  const intPart = absNum / r.den;
  const intDigits = intPart === 0n ? 0 : intPart.toString().length;

  if (intDigits > opts.maxIntegerDigits) return scientific(r, 10);

  const fracDigits = Math.max(0, Math.min(opts.maxFractionDigits, opts.maxSignificantDigits - intDigits));
  const scaled = scaledRound(r.num, r.den, fracDigits);

  if (scaled === 0n) return scientific(r, 10); // |x| too small for fixed notation

  let digits = scaled.toString();
  let text: string;
  if (fracDigits === 0) {
    text = digits;
  } else {
    digits = digits.padStart(fracDigits + 1, '0');
    text = trimFraction(`${digits.slice(0, -fracDigits)}.${digits.slice(-fracDigits)}`);
  }
  const exact = scaled * r.den === absNum * 10n ** BigInt(fracDigits);
  return { text: (r.num < 0n ? '-' : '') + text, exact };
}

/** Typographic version for on-canvas display (true minus sign). */
export function toDisplay(text: string): string {
  return text.replace(/^-/, '−').replace(/e\+?(-?)(\d+)$/, (_m, s: string, d: string) => `×10${toSuperscript(s + d)}`);
}

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
};

function toSuperscript(s: string): string {
  return [...s].map((c) => SUP[c] ?? c).join('');
}
