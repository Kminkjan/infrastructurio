import { describe, expect, it } from "vitest";
import { SWAY_AMPLITUDE_M, swayOffset } from "./windSway";

describe("wind sway", () => {
  it("leaves the base of the trunk planted", () => {
    for (const t of [0, 0.4, 3.7, 100]) {
      const o = swayOffset(0, t, 12, -40);
      expect(o.x).toBe(0);
      expect(o.z).toBe(0);
      expect(swayOffset(-1, t, 12, -40).x).toBe(0);
    }
  });

  it("grows with the square of height, bounded by the amplitude at 10 m", () => {
    let max10 = 0;
    for (let t = 0; t < 20; t += 0.05) {
      const o = swayOffset(10, t, 3, 7);
      max10 = Math.max(max10, Math.abs(o.x), Math.abs(o.z));
      const o5 = swayOffset(5, t, 3, 7);
      expect(Math.abs(o5.x)).toBeCloseTo(Math.abs(o.x) / 4, 12);
    }
    expect(max10).toBeLessThanOrEqual(SWAY_AMPLITUDE_M + 1e-12);
    expect(max10).toBeGreaterThan(0.9 * SWAY_AMPLITUDE_M);
  });

  it("stops entirely at zero amplitude (reduced motion)", () => {
    const o = swayOffset(14, 2.5, 100, -200, 0);
    expect(o.x === 0 && o.z === 0).toBe(true);
  });

  it("is out of phase between trees at different places", () => {
    const a = swayOffset(10, 1, 0, 0);
    const b = swayOffset(10, 1, 37, -11);
    expect(Math.abs(a.x - b.x) + Math.abs(a.z - b.z)).toBeGreaterThan(0.01);
  });

  it("moves smoothly at the 30 fps ambient rate", () => {
    const dt = 1 / 30;
    for (let t = 0; t < 10; t += dt) {
      const a = swayOffset(12, t, 5, 5);
      const b = swayOffset(12, t + dt, 5, 5);
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.02);
    }
  });
});
