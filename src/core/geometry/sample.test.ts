import { describe, expect, it } from "vitest";
import { resolvePiece } from "./piece";
import { arcSagittaM, arcSegmentCount, centrelineIndex, nearestOnCentreline, primLengthM, primitives, sampleCentrelineEvery, samplePiece, sweepOffsetRad } from "./sample";
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

  it("indexes a centreline: prim start lengths, arc end points and a tight plan box", () => {
    for (const t of [...STRAIGHT_TEMPLATES, ...CURVE_TEMPLATES, ...SHIFT_TEMPLATES]) {
      const c = centrelineIndex(t);
      expect(c.prims).toBe(t.prims);
      let s = 0;
      t.prims.forEach((p, i) => {
        expect(c.primStartM[i]).toBe(s);
        s += primLengthM(p);
        if (p.kind !== "arc") return;
        const end = p.startRad + p.sweepRad;
        expect(c.arcEnds[4 * i]).toBeCloseTo(p.cx + p.radiusM * Math.cos(p.startRad), 12);
        expect(c.arcEnds[4 * i + 1]).toBeCloseTo(p.cy + p.radiusM * Math.sin(p.startRad), 12);
        expect(c.arcEnds[4 * i + 2]).toBeCloseTo(p.cx + p.radiusM * Math.cos(end), 12);
        expect(c.arcEnds[4 * i + 3]).toBeCloseTo(p.cy + p.radiusM * Math.sin(end), 12);
      });
      expect(c.lengthM).toBe(s);
      // The box holds every densely sampled point and is tight to within the sampling's sagitta.
      const pts = samplePiece(t, 1e-4);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      for (const [edge, extreme, sign] of [
        [c.minX, Math.min(...xs), -1],
        [c.minY, Math.min(...ys), -1],
        [c.maxX, Math.max(...xs), 1],
        [c.maxY, Math.max(...ys), 1],
      ] as const) {
        expect(sign * (edge - extreme)).toBeGreaterThanOrEqual(-1e-9);
        expect(sign * (edge - extreme)).toBeLessThan(1e-3);
      }
    }
  });

  it("measures an angle's offset along an arc's sweep, either way round", () => {
    const ccw = { kind: "arc", cx: 0, cy: 0, radiusM: 10, startRad: 0.5, sweepRad: 1 } as const;
    const cw = { ...ccw, sweepRad: -1 };
    expect(sweepOffsetRad(ccw, 0.5)).toBe(0);
    expect(sweepOffsetRad(ccw, 1.25)).toBeCloseTo(0.75, 12);
    expect(sweepOffsetRad(ccw, 0.25)).toBeCloseTo(2 * Math.PI - 0.25, 12);
    expect(sweepOffsetRad(cw, 0.25)).toBeCloseTo(0.25, 12);
    expect(sweepOffsetRad(cw, 1.25)).toBeCloseTo(2 * Math.PI - 0.75, 12);
  });

  it("finds the nearest centreline point: on it, beside it and past its ends, agreeing with dense sampling", () => {
    const out = { d: 0, s: 0 };
    // Every template on all 12 headings (PR #83 re-review: only headings 0 and 1 were checked, and the others are
    // rotations only up to the sweep-angle wrapping `sweepOffsetRad` does).
    for (const t of [...STRAIGHT_TEMPLATES, ...CURVE_TEMPLATES, ...SHIFT_TEMPLATES]) {
      const c = centrelineIndex(t);
      const pts = samplePiece(t, 1e-4);
      // Every sampled point lies on the centreline, at its own arc length (checked in aggregate: thousands per piece).
      let offLine = 0;
      let offLength = 0;
      for (const p of pts) {
        if (nearestOnCentreline(c, p.x, p.y, out) !== out) throw new Error("the result is not the caller's scratch");
        offLine = Math.max(offLine, out.d);
        offLength = Math.max(offLength, Math.abs(out.s - p.sM));
      }
      expect(offLine).toBeLessThan(1e-9);
      expect(offLength).toBeLessThan(5e-7);
      // Off the centreline, the distance and arc length match a 2 cm sampling of every prim.
      const dense: { x: number; y: number; s: number }[] = [];
      let s0 = 0;
      for (const p of t.prims) {
        const len = primLengthM(p);
        const n = Math.max(1, Math.ceil(len / 0.02));
        for (let i = 0; i <= n; i++) {
          const f = i / n;
          const a = p.kind === "arc" ? p.startRad + p.sweepRad * f : 0;
          dense.push(
            p.kind === "line"
              ? { x: p.x0 + (p.x1 - p.x0) * f, y: p.y0 + (p.y1 - p.y0) * f, s: s0 + len * f }
              : { x: p.cx + p.radiusM * Math.cos(a), y: p.cy + p.radiusM * Math.sin(a), s: s0 + len * f },
          );
        }
        s0 += len;
      }
      // 24 points off the centreline on headings 0 and 1, 8 on the other ten (the brute force is what costs).
      for (let k = 0; k < (t.heading < 2 ? 24 : 8); k++) {
        const x = c.minX - 8 + ((c.maxX - c.minX + 16) * ((k * 7919) % 40)) / 40;
        const y = c.minY - 8 + ((c.maxY - c.minY + 16) * ((k * 104729) % 37)) / 37;
        let best = Infinity;
        let bestS = 0;
        for (const p of dense) {
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < best) {
            best = d;
            bestS = p.s;
          }
        }
        nearestOnCentreline(c, x, y, out);
        expect(out.d).toBeLessThanOrEqual(best + 1e-9);
        // The nearest 2 cm sample lies within 1 cm of the true nearest point along the centreline.
        expect(out.d).toBeGreaterThan(best - 0.01);
        if (best > 1e-2) expect(Math.abs(out.s - bestS)).toBeLessThan(0.05);
      }
      // Past the end, along the last tangent: the end point.
      const last = pts[pts.length - 1];
      const before = pts[pts.length - 2];
      if (!last || !before) throw new Error("no samples");
      const tx = last.x - before.x;
      const ty = last.y - before.y;
      const l = Math.hypot(tx, ty);
      nearestOnCentreline(c, last.x + (3 * tx) / l, last.y + (3 * ty) / l, out);
      expect(out.d).toBeCloseTo(3, 3);
      expect(out.s).toBeCloseTo(c.lengthM, 9);
    }
  });

  it("samples a centreline at most a step apart along it, on the arcs themselves, both ends included", () => {
    const out = { d: 0, s: 0 };
    for (const t of [...STRAIGHT_TEMPLATES, ...CURVE_TEMPLATES, ...SHIFT_TEMPLATES]) {
      const c = centrelineIndex(t);
      const pts = sampleCentrelineEvery(t, 0.5);
      const ends = samplePiece(t, 0.01);
      expect(pts[0]?.sM).toBe(0);
      expect(pts[pts.length - 1]?.sM).toBeCloseTo(c.lengthM, 9);
      expect(Math.hypot((pts[0]?.x ?? 0) - (ends[0]?.x ?? 0), (pts[0]?.y ?? 0) - (ends[0]?.y ?? 0))).toBeLessThan(1e-9);
      const last = ends[ends.length - 1];
      expect(Math.hypot((pts[pts.length - 1]?.x ?? 0) - (last?.x ?? 0), (pts[pts.length - 1]?.y ?? 0) - (last?.y ?? 0))).toBeLessThan(1e-9);
      let worstStep = 0;
      let worstOff = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!p) continue;
        if (i > 0) worstStep = Math.max(worstStep, p.sM - (pts[i - 1]?.sM ?? 0));
        nearestOnCentreline(c, p.x, p.y, out);
        worstOff = Math.max(worstOff, out.d, Math.abs(out.s - p.sM));
      }
      expect(worstStep).toBeLessThanOrEqual(0.5 + 1e-12);
      expect(worstOff).toBeLessThan(1e-6);
    }
    expect(() => sampleCentrelineEvery(STRAIGHT_TEMPLATES[0]!, 0)).toThrow(RangeError);
  });

  it("measures an arc's centre and the edges of its sweep exactly, on all 12 headings", () => {
    const out = { d: 0, s: 0 };
    let arcs = 0;
    for (const t of [...CURVE_TEMPLATES, ...SHIFT_TEMPLATES]) {
      const c = centrelineIndex(t);
      let s0 = 0;
      for (const p of t.prims) {
        const len = primLengthM(p);
        if (p.kind === "arc") {
          arcs += 1;
          const k = t.prims.indexOf(p);
          const arcOnly = { prims: [p], primStartM: new Float64Array([s0]), arcEnds: c.arcEnds.slice(4 * k, 4 * k + 4) };
          // At the centre every arc point lies one radius away; the piece's other prims are no farther.
          nearestOnCentreline(arcOnly, p.cx, p.cy, out);
          expect(out.d).toBeCloseTo(p.radiusM, 9);
          nearestOnCentreline(c, p.cx, p.cy, out);
          expect(out.d).toBeLessThanOrEqual(p.radiusM + 1e-9);
          // On the rays through the sweep's start and end, 2 m inside and outside the arc: the end point, 2 m away.
          for (const [angle, s] of [
            [p.startRad, s0],
            [p.startRad + p.sweepRad, s0 + len],
          ] as const) {
            for (const dr of [-2, 2]) {
              const x = p.cx + (p.radiusM + dr) * Math.cos(angle);
              const y = p.cy + (p.radiusM + dr) * Math.sin(angle);
              nearestOnCentreline(c, x, y, out);
              expect(out.d).toBeCloseTo(2, 6);
              // Where a line prim continues the arc at that end, the nearest point may lie on it at the same place.
              expect(Math.abs(out.s - s)).toBeLessThan(1e-6);
            }
            // Just past the sweep's edge, on the arc's circle: the arc's nearest point is its end, one chord away.
            const beyond = angle + (angle === p.startRad ? -1 : 1) * Math.sign(p.sweepRad) * 0.02;
            nearestOnCentreline(arcOnly, p.cx + p.radiusM * Math.cos(beyond), p.cy + p.radiusM * Math.sin(beyond), out);
            expect(out.d).toBeCloseTo(2 * p.radiusM * Math.sin(0.01), 6);
            expect(out.s).toBeCloseTo(s, 9);
            // Just inside it, on the circle: on the arc itself.
            const inside = angle - (angle === p.startRad ? -1 : 1) * Math.sign(p.sweepRad) * 0.02;
            nearestOnCentreline(arcOnly, p.cx + p.radiusM * Math.cos(inside), p.cy + p.radiusM * Math.sin(inside), out);
            expect(out.d).toBeLessThan(1e-9);
            expect(Math.abs(out.s - s)).toBeCloseTo(0.02 * p.radiusM, 6);
          }
        }
        s0 += len;
      }
    }
    expect(arcs).toBeGreaterThan(100);
  });
});
