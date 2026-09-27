import { describe, expect, it } from "vitest";
import { resolvePiece } from "./piece";
import { arcSagittaM, arcSegmentCount, primLengthM, primitives, samplePiece } from "./sample";
import { CURVE_TEMPLATES, SHIFT_TEMPLATES, STRAIGHT_TEMPLATES } from "./templates";

describe("render sampling", () => {
  it("keeps every arc chord within the requested sagitta", () => {
    for (const t of [...CURVE_TEMPLATES, ...SHIFT_TEMPLATES]) {
      for (const p of t.prims) {
        if (p.kind !== "arc") continue;
        for (const max of [0.05, 0.2, 1]) {
          const n = arcSegmentCount(p.radiusM, p.sweepRad, max);
          expect(arcSagittaM(p.radiusM, p.sweepRad, n)).toBeLessThanOrEqual(max);
          if (n > 1) expect(arcSagittaM(p.radiusM, p.sweepRad, n - 1)).toBeGreaterThan(max);
        }
      }
    }
  });

  it("samples from the start node to the end node with arc length matching the integer length", () => {
    for (const t of [...STRAIGHT_TEMPLATES, ...CURVE_TEMPLATES, ...SHIFT_TEMPLATES]) {
      const pts = samplePiece(t, 0.05);
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (!first || !last) throw new Error("no samples");
      expect(Math.hypot(first.x, first.y)).toBeLessThan(1e-9);
      expect(last.sM * 1000).toBeCloseTo(t.lengthMm, -0.5);
      const total = t.prims.reduce((s, p) => s + primLengthM(p), 0);
      expect(last.sM).toBeCloseTo(total, 9);
      for (let i = 1; i < pts.length; i++) expect((pts[i]?.sM ?? 0) > (pts[i - 1]?.sM ?? 0)).toBe(true);
    }
  });

  it("returns a piece's primitives and samples them in world metres", () => {
    const res = resolvePiece({ kind: "shift", from: { q: 20, r: 10, zMm: 0 }, heading: 0, side: "left", z1Mm: 0 });
    if (!res.ok) throw new Error(res.failure.message);
    expect(primitives(res.piece)).toBe(res.piece.prims);
    const pts = samplePiece(res.piece, 0.05);
    expect(pts[0]?.x).toBeCloseTo(5 * (20 + 5), 9);
    expect(pts[pts.length - 1]?.y).toBeCloseTo(5 * 11 * (Math.sqrt(3) / 2), 9);
    expect(() => samplePiece(res.piece, 0)).toThrow(RangeError);
  });
});
