import { describe, expect, it } from "vitest";
import { createPrng } from "../core/util/prng";
import { smoothstep } from "./math";

/** The two forms the eight former private copies took (PR #83 review), kept here as the reference. */
function minMaxCopy(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function clampCopy(e0: number, e1: number, x: number): number {
  const u = (x - e0) / (e1 - e0);
  const t = u < 0 ? 0 : u > 1 ? 1 : u;
  return t * t * (3 - 2 * t);
}
/** The former `splat.ts` `smoothstep01`. */
function unitCopy(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

describe("render maths", () => {
  it("smoothstep is GLSL's: 0 below the first edge, 1 above the second, 3t² − 2t³ between", () => {
    expect(smoothstep(1, 3, 0)).toBe(0);
    expect(smoothstep(1, 3, 1)).toBe(0);
    expect(smoothstep(1, 3, 2)).toBe(0.5);
    expect(smoothstep(1, 3, 3)).toBe(1);
    expect(smoothstep(1, 3, 9)).toBe(1);
    expect(smoothstep(3, 1, 2.5)).toBeCloseTo(0.15625, 12);
    for (let x = 0; x < 1; x += 0.01) expect(smoothstep(0, 1, x + 0.01)).toBeGreaterThanOrEqual(smoothstep(0, 1, x));
  });

  it("returns exactly what every former copy returned, edge cases included", () => {
    const prng = createPrng("smoothstep-copies");
    const specials = [0, -0, 1, -1, 0.5, 1e-300, Number.NaN, Infinity, -Infinity];
    const cases: [number, number, number][] = [];
    for (const a of specials) for (const b of specials) for (const x of specials) cases.push([a, b, x]);
    for (let k = 0; k < 20_000; k++) cases.push([prng.nextInt(2001) / 100 - 10, prng.nextInt(2001) / 100 - 10, prng.nextInt(4001) / 100 - 20]);
    for (const [a, b, x] of cases) {
      const s = smoothstep(a, b, x);
      expect(Object.is(s, minMaxCopy(a, b, x)), `${a}, ${b}, ${x}`).toBe(true);
      expect(Object.is(s, clampCopy(a, b, x)), `${a}, ${b}, ${x}`).toBe(true);
    }
    for (const x of [...specials, ...cases.map((c) => c[2] / 7)]) expect(Object.is(smoothstep(0, 1, x), unitCopy(x)), String(x)).toBe(true);
  });
});
