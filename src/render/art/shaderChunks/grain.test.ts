import { describe, expect, it } from "vitest";
import { GRAIN_AMOUNT, grainAt } from "./grain";

/** Deterministic sample points spread over the map and a few metres of height. */
function samples(n: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) out.push([(i * 7.31) % 2000, (i * 0.137) % 12, -((i * 3.77) % 1500)]);
  return out;
}

describe("grain", () => {
  it("stays within ±6% luminance", () => {
    for (const [x, y, z] of samples(20_000)) {
      const g = grainAt(x, y, z);
      if (Math.abs(g) > GRAIN_AMOUNT + 1e-12) expect.fail(`grain ${g} at ${x}, ${y}, ${z}`);
    }
  });

  it("averages to about zero and actually varies", () => {
    const values = samples(20_000).map(([x, y, z]) => grainAt(x, y, z));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
    expect(Math.abs(mean)).toBeLessThan(0.1 * GRAIN_AMOUNT);
    expect(sd).toBeGreaterThan(0.1 * GRAIN_AMOUNT);
  });

  it("is anchored to the world: the same point always gives the same grain", () => {
    expect(grainAt(123.4, 5.6, -789.1)).toBe(grainAt(123.4, 5.6, -789.1));
  });

  it("is continuous, so it reads as texture rather than per-pixel noise", () => {
    for (const [x, y, z] of samples(2_000)) {
      expect(Math.abs(grainAt(x + 0.01, y, z) - grainAt(x, y, z))).toBeLessThan(0.2 * GRAIN_AMOUNT);
    }
  });

  it("scales with the amount, and vanishes at zero", () => {
    expect(Math.abs(grainAt(10, 2, -30, 0))).toBe(0);
    expect(grainAt(10, 2, -30, 0.12)).toBeCloseTo(2 * grainAt(10, 2, -30, 0.06), 12);
  });
});
