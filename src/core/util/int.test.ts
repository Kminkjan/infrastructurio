import { describe, expect, it } from "vitest";
import { clampInt, divFloor, isqrt } from "./int";
import { createPrng } from "./prng";

/** Independent BigInt oracle: Newton's method, exact for any size. */
function isqrtBig(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Independent BigInt oracle for floor division (BigInt `/` truncates). */
function divFloorBig(a: bigint, b: bigint): bigint {
  const q = a / b;
  return (a % b !== 0n) && (a < 0n) !== (b < 0n) ? q - 1n : q;
}

const prng = createPrng("int-test");
/** Uniform-ish safe integer in [0, 2^53). */
function randomSafe(): number {
  return prng.nextInt(2 ** 21) * 2 ** 32 + prng.nextUint32();
}

describe("isqrt", () => {
  it("is exact at every perfect square and its neighbours up to 2000²", () => {
    for (let k = 1; k <= 2000; k++) {
      expect(isqrt(k * k - 1)).toBe(k - 1);
      expect(isqrt(k * k)).toBe(k);
      expect(isqrt(k * k + 1)).toBe(k);
    }
    expect(isqrt(0)).toBe(0);
  });

  it("is exact at perfect squares ±1 around the designed 1.2e9 intermediate", () => {
    for (let k = 34_600; k <= 34_700; k++) {
      expect(isqrt(k * k - 1)).toBe(k - 1);
      expect(isqrt(k * k)).toBe(k);
      expect(isqrt(k * k + 1)).toBe(k);
    }
    expect(isqrt(1_200_000_000)).toBe(Number(isqrtBig(1_200_000_000n)));
  });

  it("is exact at perfect squares ±1 just below 2^53", () => {
    const top = Number(isqrtBig(BigInt(Number.MAX_SAFE_INTEGER)));
    for (let k = top - 50; k <= top; k++) {
      expect(isqrt(k * k - 1)).toBe(k - 1);
      expect(isqrt(k * k)).toBe(k);
      expect(isqrt(k * k + 1)).toBe(k);
    }
    expect(isqrt(Number.MAX_SAFE_INTEGER)).toBe(top);
  });

  it("matches the BigInt oracle on seeded values up to 1.2e9 and up to 2^53", () => {
    for (let i = 0; i < 2000; i++) {
      const small = prng.nextInt(1_200_000_001);
      expect(isqrt(small)).toBe(Number(isqrtBig(BigInt(small))));
      const large = randomSafe();
      expect(isqrt(large)).toBe(Number(isqrtBig(BigInt(large))));
    }
  });

  it("rejects negative, fractional and unsafe inputs with a RangeError", () => {
    expect(() => isqrt(-1)).toThrow(RangeError);
    expect(() => isqrt(2.5)).toThrow(RangeError);
    expect(() => isqrt(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => isqrt(Number.NaN)).toThrow(RangeError);
  });
});

describe("divFloor", () => {
  it("rounds toward negative infinity for every sign combination", () => {
    expect(divFloor(7, 2)).toBe(3);
    expect(divFloor(-7, 2)).toBe(-4);
    expect(divFloor(7, -2)).toBe(-4);
    expect(divFloor(-7, -2)).toBe(3);
    expect(divFloor(-6, 2)).toBe(-3);
    expect(divFloor(-1, 1000)).toBe(-1);
    expect(divFloor(999, 1000)).toBe(0);
  });

  it("never returns negative zero", () => {
    expect(Object.is(divFloor(0, -5), 0)).toBe(true);
    expect(Object.is(divFloor(-0, 5), 0)).toBe(true);
    expect(Object.is(divFloor(3, -5), -1)).toBe(true);
  });

  it("matches the BigInt oracle on seeded signed values, including near 2^53", () => {
    for (let i = 0; i < 2000; i++) {
      const a = (prng.nextInt(2) === 0 ? -1 : 1) * randomSafe();
      const b = (prng.nextInt(2) === 0 ? -1 : 1) * (1 + prng.nextInt(i % 2 === 0 ? 1000 : 2 ** 31));
      expect(divFloor(a, b)).toBe(Number(divFloorBig(BigInt(a), BigInt(b))));
    }
    expect(divFloor(Number.MAX_SAFE_INTEGER, 3)).toBe(Number(divFloorBig(BigInt(Number.MAX_SAFE_INTEGER), 3n)));
    expect(divFloor(-Number.MAX_SAFE_INTEGER, 2)).toBe(-(2 ** 52));
  });

  it("rejects a zero divisor and non-integer operands with a RangeError", () => {
    expect(() => divFloor(1, 0)).toThrow(RangeError);
    expect(() => divFloor(1.5, 2)).toThrow(RangeError);
    expect(() => divFloor(4, 0.5)).toThrow(RangeError);
  });
});

describe("clampInt", () => {
  it("clamps into the closed range and leaves inner values alone", () => {
    expect(clampInt(-5, 0, 10)).toBe(0);
    expect(clampInt(15, 0, 10)).toBe(10);
    expect(clampInt(7, 0, 10)).toBe(7);
    expect(clampInt(3, 3, 3)).toBe(3);
  });

  it("rejects an empty range and non-integers with a RangeError", () => {
    expect(() => clampInt(1, 5, 4)).toThrow(RangeError);
    expect(() => clampInt(1.5, 0, 4)).toThrow(RangeError);
  });
});
