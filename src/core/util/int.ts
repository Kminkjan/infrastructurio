/**
 * Exact integer helpers for the deterministic core (ADR 0012, proposed).
 *
 * Core quantities are plain Numbers holding safe integers, so every helper
 * here is exact for any safe-integer input and throws a RangeError for
 * anything else: a float sneaking into integer state is a programmer error,
 * and failing loudly beats rounding differently on another engine.
 */

/** Converts a -0 result to +0 so canonical JSON and `Object.is` stay stable. */
function noNegativeZero(n: number): number {
  return n + 0;
}

/**
 * Exact floor(√n) for a safe integer n ≥ 0.
 *
 * `Math.sqrt` is only a first guess; the two correction loops make the
 * result exact even if an engine's root were an ulp off. The comparisons stay
 * exact near 2^53 too: rounding is monotone, so a square above n can never
 * round down to n or below.
 */
export function isqrt(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`isqrt needs a safe integer >= 0, got ${n}`);
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r -= 1;
  while ((r + 1) * (r + 1) <= n) r += 1;
  return r;
}

/**
 * Floor division (rounds toward −∞) for safe integers, b ≠ 0.
 *
 * The float quotient `a / b` can round across an integer boundary for large
 * operands, so it is never used directly: `%` is exact on doubles, `a - rem`
 * is then an exact multiple of `b`, and dividing an exact multiple needs no
 * rounding at all.
 */
export function divFloor(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || b === 0) {
    throw new RangeError(`divFloor needs safe integers and b != 0, got ${a} / ${b}`);
  }
  const rem = a % b;
  let q = (a - rem) / b;
  if (rem !== 0 && rem < 0 !== b < 0) q -= 1;
  return noNegativeZero(q);
}

/** Clamps a safe integer into [lo, hi]; throws if the range is empty. */
export function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isSafeInteger(v) || !Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || lo > hi) {
    throw new RangeError(`clampInt needs safe integers with lo <= hi, got ${v} in [${lo}, ${hi}]`);
  }
  return noNegativeZero(v < lo ? lo : v > hi ? hi : v);
}
