import { describe, expect, it } from "vitest";
import { fnv1a32 } from "./hash";
import { createPrng } from "./prng";

/**
 * Independent sfc32 oracle in BigInt arithmetic, seeded the way prng.ts
 * documents (golden ratio, fnv1a32(seed), π digits, counter 1, 15 warm-up
 * rounds). It shares no int32 tricks with the implementation.
 */
function referenceSfc32(seed: string, count: number): number[] {
  const M = 0xffffffffn;
  let a = 0x9e3779b9n;
  let b = BigInt(fnv1a32(seed));
  let c = 0x243f6a88n;
  let d = 1n;
  const next = (): number => {
    const t = (a + b + d) & M;
    d = (d + 1n) & M;
    a = b ^ (b >> 9n);
    b = (c + (c << 3n)) & M;
    c = ((c << 21n) | (c >> 11n)) & M;
    c = (c + t) & M;
    return Number(t);
  };
  for (let i = 0; i < 15; i++) next();
  return Array.from({ length: count }, next);
}

describe("createPrng (sfc32)", () => {
  it("produces the golden sequence for a fixed seed", () => {
    const prng = createPrng("baltic-diorama");
    const seq = Array.from({ length: 8 }, () => prng.nextUint32());
    expect(seq).toEqual([3899231381, 3046910933, 1241845667, 71374168, 3841980035, 426705221, 2063260885, 2544958577]);
  });

  it("matches an independent BigInt sfc32 over a long run", () => {
    for (const seed of ["", "baltic-diorama", "seed-2"]) {
      const prng = createPrng(seed);
      const got = Array.from({ length: 1000 }, () => prng.nextUint32());
      expect(got).toEqual(referenceSfc32(seed, 1000));
    }
  });

  it("gives the same sequence for the same seed and a different one for another seed", () => {
    const one = createPrng("repeatable");
    const two = createPrng("repeatable");
    const other = createPrng("repeatable!");
    const a = Array.from({ length: 64 }, () => one.nextUint32());
    const b = Array.from({ length: 64 }, () => two.nextUint32());
    const c = Array.from({ length: 64 }, () => other.nextUint32());
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("keeps nextInt in range and deterministic, with golden values", () => {
    const prng = createPrng("baltic-diorama");
    expect(Array.from({ length: 8 }, () => prng.nextInt(100))).toEqual([81, 33, 67, 68, 35, 21, 85, 77]);
    const wide = createPrng("range");
    for (const max of [1, 2, 3, 7, 1000, 2 ** 31 + 1, 2 ** 32]) {
      for (let i = 0; i < 200; i++) {
        const v = wide.nextInt(max);
        expect(Number.isInteger(v) && v >= 0 && v < max).toBe(true);
      }
    }
  });

  it("samples nextInt without modulo bias where plain modulo would show it", () => {
    // max = 3·2^30: a plain `x % max` would hit [0, 2^30) twice as often as
    // the rest, i.e. with probability 1/2 instead of 1/3.
    const prng = createPrng("bias");
    const max = 3 * 2 ** 30;
    let low = 0;
    const n = 30_000;
    for (let i = 0; i < n; i++) if (prng.nextInt(max) < 2 ** 30) low += 1;
    expect(Math.abs(low / n - 1 / 3)).toBeLessThan(0.02);
  });

  it("rejects an empty or oversized range with a RangeError", () => {
    const prng = createPrng("x");
    expect(() => prng.nextInt(0)).toThrow(RangeError);
    expect(() => prng.nextInt(2.5)).toThrow(RangeError);
    expect(() => prng.nextInt(2 ** 32 + 1)).toThrow(RangeError);
  });
});
