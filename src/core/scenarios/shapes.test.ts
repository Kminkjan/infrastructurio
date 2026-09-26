import { describe, expect, it } from "vitest";
import { simplifyPath, smoothPath, stationsAlong } from "./roads";
import {
  DIR_PERMILLE,
  type Obb,
  distanceMm,
  obbContains,
  obbCorners,
  obbOverlap,
  offsetAlong,
  segmentDistanceMm,
  valueNoise,
} from "./shapes";

const box = (xMm: number, yMm: number, heading: number, halfLengthMm: number, halfWidthMm: number): Obb => ({
  xMm,
  yMm,
  heading,
  halfLengthMm,
  halfWidthMm,
});

describe("scenery shapes", () => {
  it("tables unit lattice directions in per-mille, 30° apart", () => {
    expect(DIR_PERMILLE).toHaveLength(12);
    DIR_PERMILLE.forEach(([x, y], h) => {
      expect(Math.hypot(x, y)).toBeCloseTo(1000, -1);
      expect(x).toBeCloseTo(1000 * Math.cos((h * Math.PI) / 6), -1);
      expect(y).toBeCloseTo(1000 * Math.sin((h * Math.PI) / 6), -1);
    });
  });

  it("moves along a heading and to its left", () => {
    expect(offsetAlong({ xMm: 0, yMm: 0 }, 0, 10_000, 2_000)).toEqual({ xMm: 10_000, yMm: 2_000 });
    expect(offsetAlong({ xMm: 0, yMm: 0 }, 3, 10_000)).toEqual({ xMm: 0, yMm: 10_000 });
  });

  it("detects overlap between rotated boxes and allows wall-to-wall rows", () => {
    expect(obbOverlap(box(0, 0, 0, 5_000, 5_000), box(9_000, 0, 0, 5_000, 5_000))).toBe(true);
    // Touching faces are allowed with a little slack.
    expect(obbOverlap(box(0, 0, 0, 5_000, 5_000), box(10_000, 0, 0, 5_000, 5_000), 300)).toBe(false);
    // A 45°-ish rotated box whose corner pokes in, versus one kept clear.
    expect(obbOverlap(box(0, 0, 0, 5_000, 5_000), box(11_000, 0, 1, 5_000, 5_000))).toBe(true);
    expect(obbOverlap(box(0, 0, 0, 5_000, 5_000), box(13_000, 0, 1, 5_000, 5_000))).toBe(false);
  });

  it("puts corners on the box outline and contains its centre", () => {
    const b = box(1_000, 2_000, 2, 6_000, 3_000);
    for (const c of obbCorners(b)) {
      expect(obbContains(b, c, 2)).toBe(true);
      expect(obbContains(b, c, -50)).toBe(false);
    }
    expect(obbContains(b, b)).toBe(true);
  });

  it("measures point-to-segment distance, clamping to the ends", () => {
    const a = { xMm: 0, yMm: 0 };
    const b = { xMm: 10_000, yMm: 0 };
    expect(segmentDistanceMm({ xMm: 5_000, yMm: 3_000 }, a, b)).toBe(3_000);
    expect(segmentDistanceMm({ xMm: -4_000, yMm: 3_000 }, a, b)).toBe(5_000);
    expect(segmentDistanceMm({ xMm: 5_000, yMm: 0 }, a, a)).toBe(5_000);
    // A 1.8 km segment stays exact enough (the fraction is scaled down, not overflowed).
    const far = { xMm: 1_800_000, yMm: 900_000 };
    expect(Math.abs(segmentDistanceMm({ xMm: 900_000, yMm: 450_000 + 10_000 }, a, far) - 8_944)).toBeLessThan(600);
  });

  it("keeps value noise in range and deterministic", () => {
    for (let i = 0; i < 200; i++) {
      const n = valueNoise(123, 7, 50_000, i * 3_371, i * 7_919);
      expect(n).toBeGreaterThanOrEqual(-1000);
      expect(n).toBeLessThanOrEqual(1000);
      expect(valueNoise(123, 7, 50_000, i * 3_371, i * 7_919)).toBe(n);
    }
  });
});

describe("road paths", () => {
  it("drops straight-on points and keeps turns", () => {
    const pts = [
      { xMm: 0, yMm: 0 },
      { xMm: 10, yMm: 0 },
      { xMm: 20, yMm: 0 },
      { xMm: 20, yMm: 10 },
    ];
    expect(simplifyPath(pts)).toEqual([pts[0], pts[2], pts[3]]);
  });

  it("cuts corners but keeps both ends", () => {
    const pts = [
      { xMm: 0, yMm: 0 },
      { xMm: 40_000, yMm: 0 },
      { xMm: 40_000, yMm: 40_000 },
    ];
    const smooth = smoothPath(pts, 2);
    expect(smooth[0]).toEqual(pts[0]);
    expect(smooth[smooth.length - 1]).toEqual(pts[2]);
    expect(smooth.every((p) => !(p.xMm === 40_000 && p.yMm === 0))).toBe(true);
  });

  it("spaces stations by arc length, half a spacing in, offset to the left", () => {
    const line = [
      { xMm: 0, yMm: 0 },
      { xMm: 60_000, yMm: 0 },
      { xMm: 200_000, yMm: 0 },
    ];
    const stations = stationsAlong(line, 50_000, 5_000);
    expect(stations.map((s) => s.xMm)).toEqual([25_000, 75_000, 125_000, 175_000]);
    for (const s of stations) {
      expect(s.yMm).toBe(5_000);
      expect([s.dirX, s.dirY]).toEqual([1000, 0]);
    }
    for (let i = 1; i < stations.length; i++) expect(distanceMm(stations[i - 1]!, stations[i]!)).toBe(50_000);
  });
});
