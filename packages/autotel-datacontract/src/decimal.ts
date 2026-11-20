/** Exact decimal arithmetic in BigInt: no value is rounded through a double. */
/** An exact decimal: digits / 10^scale. */
export interface Decimal {
  digits: bigint;
  scale: number;
}

/**
 * The exact decimal a value states: a bigint as itself, an integer number
 * exactly (above 2^53 its shortest text is not exact), a fraction from its
 * shortest decimal text (what JSON or YAML wrote), decimal text as written.
 */
export function decimalOf(x: unknown): Decimal | undefined {
  if (typeof x === 'bigint') return { digits: x, scale: 0 };
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) return undefined;
    if (Number.isInteger(x)) return { digits: BigInt(x), scale: 0 };
    return parseDecimal(String(x));
  }
  return typeof x === 'string' ? parseDecimal(x) : undefined;
}

function parseDecimal(text: string): Decimal | undefined {
  const m = /^([-+]?)(\d*)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!m || (m[2] === '' && m[3] === undefined)) return undefined;
  const fraction = m[3] ?? '';
  let digits = BigInt(`${m[1] === '-' ? '-' : ''}${m[2] || '0'}${fraction}`);
  let scale = fraction.length - Number(m[4] ?? 0);
  if (scale < 0) {
    digits *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { digits, scale };
}

export function aligned(a: Decimal, b: Decimal): [bigint, bigint] {
  const scale = Math.max(a.scale, b.scale);
  return [
    a.digits * 10n ** BigInt(scale - a.scale),
    b.digits * 10n ** BigInt(scale - b.scale),
  ];
}

/** -1, 0 or 1 as a is below, at or above b, exactly. */
export function compareDecimal(a: Decimal, b: Decimal): number {
  const [x, y] = aligned(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** The shortest exact decimal text: trailing zeros dropped (1.50 → 1.5, 2e3 → 2000). */
export function decimalText(d: Decimal): string {
  let { digits, scale } = d;
  while (scale > 0 && digits % 10n === 0n) {
    digits /= 10n;
    scale--;
  }
  if (scale === 0) return digits.toString();
  const negative = digits < 0n;
  const abs = (negative ? -digits : digits).toString().padStart(scale + 1, '0');
  return `${negative ? '-' : ''}${abs.slice(0, -scale)}.${abs.slice(-scale)}`;
}
