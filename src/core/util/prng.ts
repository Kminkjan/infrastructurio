import { fnv1a32 } from "./hash";

/**
 * Seeded sfc32 generator (ADR 0012, proposed): the only authoritative PRNG
 * in the core, for scenario and test generation. The tick step never draws
 * random numbers; if a later tick system needs any, its state must go into
 * the save and the hash.
 *
 * sfc32 needs only 32-bit adds, xors and shifts, so every engine produces the
 * same stream; the state stays in int32 via `| 0`.
 */
export interface Prng {
  /** Next raw output, a uniform integer in [0, 2^32). */
  nextUint32(): number;
  /** Uniform integer in [0, maxExclusive), 1 ≤ maxExclusive ≤ 2^32. */
  nextInt(maxExclusive: number): number;
}

const TWO_POW_32 = 4294967296;
/** Discarded outputs, so seeds differing in one bit diverge fully. */
const WARM_UP_ROUNDS = 15;

/**
 * Creates a generator from a string seed. The seed's FNV-1a hash fills one
 * state word; the other three are fixed constants (golden ratio, π digits and
 * the usual counter start of 1), so the stream is a pure function of `seed`.
 */
export function createPrng(seed: string): Prng {
  let a = 0x9e3779b9 | 0;
  let b = fnv1a32(seed) | 0;
  let c = 0x243f6a88 | 0;
  let d = 1;

  function nextUint32(): number {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  }

  /**
   * Rejection sampling: `x % max` alone would favour small results whenever
   * max does not divide 2^32, so outputs in the incomplete top band are
   * redrawn. Fewer than half the draws are rejected even in the worst case.
   */
  function nextInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > TWO_POW_32) {
      throw new RangeError(`nextInt needs an integer in [1, 2^32], got ${maxExclusive}`);
    }
    const limit = TWO_POW_32 - (TWO_POW_32 % maxExclusive);
    let x = nextUint32();
    while (x >= limit) x = nextUint32();
    return x % maxExclusive;
  }

  for (let i = 0; i < WARM_UP_ROUNDS; i++) nextUint32();
  return Object.freeze({ nextUint32, nextInt });
}
