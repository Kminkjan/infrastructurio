import { describe, expect, it } from "vitest";
import { type PieceSpec, type Terrain, resolvePiece } from "../../core/sim/api";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import {
  CREST_ROUND_M,
  ChunkPass,
  DAYLIGHT_ROUND_M,
  DrawnHeightfield,
  EARTHWORK_MIN_M,
  FORMATION_HALF_WIDTH_M,
  type PieceInput,
  SIDE_SLOPE_RUN,
  conformRule,
  conformTerrain,
  conformedHeightM,
  earthworkPiece,
  earthworkPotential,
  nearestOnPiece,
  slopeRiseM,
  smoothMin,
} from "./earthworks";

/** A resolved piece as the conform reads it (a `NetworkPiece` has this shape). */
function piece(spec: PieceSpec): PieceInput {
  const res = resolvePiece(spec);
  if (!res.ok) throw new Error(res.failure.message);
  return { key: res.piece.key, prims: res.piece.prims, z0Mm: res.piece.ends[0].node.zMm, z1Mm: res.piece.ends[1].node.zMm };
}

function straight(q: number, r: number, heading: number, zMm: number, z1Mm = zMm): PieceInput {
  return piece({ kind: "straight", from: { q, r, zMm }, heading, z1Mm } as PieceSpec);
}

/** 120 × 80 nodes (2 × 2 chunks), flat at 20 m. */
const flat = makeTerrain(120, 80, () => 200);

/** Index of barycentric sub-vertex (i, j) in a refined triangle's heights (`subIndex` for REFINE = 4). */
const idx = (i: number, j: number) => j * 5 - (j * (j - 1)) / 2 + i;

/** Height of the drawn surface `d` metres to the left of the heading-0 run through row r, at x. */
function across(field: DrawnHeightfield, x: number, y0: number, d: number): number {
  return field.heightAtM(x, y0 + d);
}

describe("earthworks conform: the smooth rule (render pass iteration)", () => {
  it("eases the side slope in: flat on the formation, continuous in value and slope, then 1 : 1.5", () => {
    expect(slopeRiseM(0)).toBe(0);
    expect(slopeRiseM(FORMATION_HALF_WIDTH_M)).toBe(0);
    let previous = 0;
    let previousSlope = 0;
    for (let d = FORMATION_HALF_WIDTH_M; d < 15; d += 0.01) {
      const rise = slopeRiseM(d);
      const slope = (slopeRiseM(d + 1e-6) - rise) / 1e-6;
      expect(rise).toBeGreaterThanOrEqual(previous);
      // No kink: the slope changes by at most its curvature over the step (1 / (b·S) per metre).
      expect(Math.abs(slope - previousSlope)).toBeLessThan(0.01 / (CREST_ROUND_M * SIDE_SLOPE_RUN) + 1e-4);
      expect(slope).toBeLessThanOrEqual(1 / SIDE_SLOPE_RUN + 1e-6);
      previous = rise;
      previousSlope = slope;
    }
    expect((slopeRiseM(12) - slopeRiseM(11)) * SIDE_SLOPE_RUN).toBeCloseTo(1, 9);
  });

  it("smooth minimum: never above the minimum, exact once the arguments differ by the band", () => {
    for (let a = -2; a <= 2; a += 0.13) {
      for (let b = -2; b <= 2; b += 0.17) {
        expect(smoothMin(a, b, 0.6)).toBeLessThanOrEqual(Math.min(a, b));
        if (Math.abs(a - b) >= 0.6) expect(smoothMin(a, b, 0.6)).toBe(Math.min(a, b));
        expect(Math.min(a, b) - smoothMin(a, b, 0.6)).toBeLessThanOrEqual(0.6 / 4 + 1e-12);
      }
    }
    expect(smoothMin(1, 2, 0)).toBe(1);
  });

  it("clamps natural ground between the envelopes: exact on the bed and far from the edges, never outside them", () => {
    for (let n = 10; n <= 30; n += 0.071) {
      // On the formation (u = l = bed) the ground is the bed exactly, whatever the natural height (bar the soft band).
      const onBed = conformRule(n, 20, 20);
      if (Math.abs(n - 20) >= 2 * EARTHWORK_MIN_M) expect(onBed).toBe(20);
      else if (Math.abs(n - 20) <= EARTHWORK_MIN_M) expect(onBed).toBe(n);
      else expect(Math.abs(onBed - 20)).toBeLessThanOrEqual(Math.abs(n - 20));
      for (const half of [0.02, 0.3, 1, 3, 8]) {
        const c = conformRule(n, 20 + half, 20 - half);
        const sharp = Math.min(20 + half, Math.max(n, 20 - half));
        // The soft "leave natural" band may keep up to about 5.4 cm of natural ground above a cut or below a fill.
        expect(c).toBeLessThanOrEqual(Math.max(20 + half, n) + 1e-12);
        expect(c).toBeGreaterThanOrEqual(Math.min(20 - half, n) - 1e-12);
        if (Math.abs(n - 20) < half - DAYLIGHT_ROUND_M) expect(c).toBe(n);
        if (Math.abs(n - 20) > half + DAYLIGHT_ROUND_M + 0.11) expect(c).toBe(sharp);
        // Never more than the band's quarter from the sharp rule (plus the soft band's slack).
        expect(Math.abs(c - sharp)).toBeLessThanOrEqual(DAYLIGHT_ROUND_M / 4 + 1.1 * EARTHWORK_MIN_M);
      }
    }
    // Conflicting envelopes (another track's fill above this track's cut): cuts win.
    expect(conformRule(25, 20, 21)).toBe(20);
    expect(conformRule(25, Infinity, -Infinity)).toBe(25);
    expect(conformRule(Number.NaN, 20, 20)).toBeNaN();
  });

  it("has no steps: a small change of the natural height moves the drawn height by at most a bounded multiple", () => {
    // Round 1's hard 5 cm threshold jumped by 5 cm for a millimetre of natural height; the soft band cannot.
    let worst = 0;
    for (const half of [0, 0.03, 0.2, 1, 4]) {
      for (let n = 17; n < 23; n += 0.0005) {
        const a = conformRule(n, 20 + half, 20 - half);
        const b = conformRule(n + 0.0005, 20 + half, 20 - half);
        worst = Math.max(worst, Math.abs(b - a) / 0.0005);
      }
    }
    expect(worst).toBeLessThan(3);
  });

  it("measures the potential whose zero is the sharp daylight line: positive in cuts and fills, negative between", () => {
    expect(earthworkPotential(25, 22, 18)).toBeCloseTo(3, 12);
    expect(earthworkPotential(15, 22, 18)).toBeCloseTo(3, 12);
    expect(earthworkPotential(20, 22, 18)).toBeCloseTo(-2, 12);
    expect(earthworkPotential(20.5, 20, 20)).toBeCloseTo(0.5, 12);
    expect(earthworkPotential(20, Infinity, -Infinity)).toBe(-Infinity);
    // Conflicting envelopes (the rule draws u): the distance to u, so ground the rule leaves alone is not coloured.
    expect(earthworkPotential(20, 20, 20.3)).toBe(0);
    expect(earthworkPotential(19, 20, 20.3)).toBeCloseTo(1, 12);
    for (let n = 15; n < 25; n += 0.37) expect(earthworkPotential(n, 20, 20)).toBeCloseTo(earthworkPotential(n, 20, 20 - 1e-12), 9);
  });
});

describe("earthworks conform (the rule)", () => {
  it("leaves ground-level track on flat ground untouched", () => {
    const field = conformTerrain(flat, { pieces: [straight(20, 40, 0, 20_000), straight(21, 40, 0, 20_000)] });
    expect(field.triangles.size).toBe(0);
  });

  it("raises an embankment: a 6 m crest at the track height, eased into 1 : 1.5 slopes, natural beyond", () => {
    const run = Array.from({ length: 8 }, (_, i) => straight(10 + i, 40, 0, 22_000));
    const field = conformTerrain(flat, { pieces: run });
    expect(field.triangles.size).toBeGreaterThan(0);
    // Row 40 lies at y = 40 · 4.33 m; the run spans x ≈ 150–190 m. Sample mid-run, square to it.
    const y0 = 40 * 2.5 * Math.sqrt(3);
    const x = 5 * (14 + 20) + 2.5;
    expect(across(field, x, y0, 0)).toBeCloseTo(22, 5);
    expect(across(field, x, y0, 1.5)).toBeCloseTo(22, 5);
    expect(across(field, x, y0, -1.5)).toBeCloseTo(22, 5);
    // Past the crest round-off (3 + 2 m) the slope is straight 1 : 1.5, lagging the kinked one by b/2: at 5.5 m, 1 m
    // down (within a few mm: the containing 1.25 m sub-triangles reach back into the round-off).
    const d = FORMATION_HALF_WIDTH_M + CREST_ROUND_M + 0.5;
    expect(across(field, x, y0, d)).toBeCloseTo(22 - (d - FORMATION_HALF_WIDTH_M - CREST_ROUND_M / 2) / SIDE_SLOPE_RUN, 2);
    expect(across(field, x, y0, -d)).toBeCloseTo(22 - (d - FORMATION_HALF_WIDTH_M - CREST_ROUND_M / 2) / SIDE_SLOPE_RUN, 2);
    // Past the toe (the slope reaches 2 m at 3 + 1 + 3 = 7 m) and its round-off, natural ground.
    expect(across(field, x, y0, 9)).toBeCloseTo(20, 6);
    expect(across(field, x, y0, -9)).toBeCloseTo(20, 6);
    // Natural ground is never lowered by a fill.
    for (let d = -10; d <= 10; d += 0.37) expect(across(field, x, y0, d)).toBeGreaterThanOrEqual(20 - 1e-6);
  });

  it("digs a cutting: a 6 m bed at the track height, eased 1 : 1.5 slopes up to natural", () => {
    const run = Array.from({ length: 8 }, (_, i) => straight(10 + i, 40, 0, 17_000));
    const field = conformTerrain(flat, { pieces: run });
    const y0 = 40 * 2.5 * Math.sqrt(3);
    const x = 5 * (14 + 20) + 2.5;
    expect(across(field, x, y0, 0)).toBeCloseTo(17, 5);
    expect(across(field, x, y0, 2)).toBeCloseTo(17, 5);
    // 6 m out: 3 m past the formation edge, (3 − 1) / 1.5 m up the slope.
    expect(across(field, x, y0, 6)).toBeCloseTo(17 + (3 - CREST_ROUND_M / 2) / SIDE_SLOPE_RUN, 2);
    expect(across(field, x, y0, 12)).toBeCloseTo(20, 6);
    // A cut never raises ground.
    for (let d = -12; d <= 12; d += 0.37) expect(across(field, x, y0, d)).toBeLessThanOrEqual(20 + 1e-6);
  });

  it("matches the analytic rule at sub-lattice vertices and stays within one cell of it elsewhere", () => {
    const pieces = [straight(10, 40, 0, 17_000), straight(11, 40, 0, 17_500), straight(12, 40, 1, 17_500, 19_000)].map((p) => earthworkPiece(flat, p));
    const field = conformTerrain(flat, { pieces: [straight(10, 40, 0, 17_000), straight(11, 40, 0, 17_500), straight(12, 40, 1, 17_500, 19_000)] });
    let worst = 0;
    for (let x = 30; x < 110; x += 0.61) {
      for (let y = 150; y < 200; y += 0.53) {
        const analytic = conformedHeightM(pieces, x, y, 20);
        worst = Math.max(worst, Math.abs(field.heightAtM(x, y) - analytic));
      }
    }
    // Piecewise-linear sampling of slopes of 1 : 1.5 on a 1.25 m lattice, plus the 5 cm "leave natural" band.
    expect(worst).toBeLessThan(1.25 / SIDE_SLOPE_RUN / 2 + EARTHWORK_MIN_M);
  });

  it("continues a fill's slope under the water: no shelf, no cliff, nothing flat at the water plane", () => {
    // Water at 10 m over a bed at 9 m west of column 60; land at 10.5 m east of it. A run at 11 m crosses the shore,
    // so its embankment stands in the water. Round 1 capped the fill 10 cm under the surface, leaving a shelf whose
    // edge dropped over one 1.25 m sub-triangle: a near-vertical step along the shore.
    const wet = makeTerrain(120, 80, (_q, _r, col) => (col < 60 ? 90 : 105));
    const pieces = Array.from({ length: 30 }, (_, i) => straight(20 + i, 40, 0, 11_000));
    const field = conformTerrain(wet, { pieces });
    const prepared = pieces.map((p) => earthworkPiece(wet, p));
    const y0 = 40 * 2.5 * Math.sqrt(3);
    let underwater = 0;
    for (let x = 110; x < 250; x += 0.7) {
      for (let d = -8; d <= 8; d += 0.5) {
        const natural = field.naturalAtM(x, y0 + d);
        if (natural >= 10) continue;
        underwater += 1;
        // Under water the drawn ground follows the same rule as on land (within the sub-lattice's interpolation).
        expect(Math.abs(field.heightAtM(x, y0 + d) - conformedHeightM(prepared, x, y0 + d, natural))).toBeLessThan(1.25 / SIDE_SLOPE_RUN / 2 + EARTHWORK_MIN_M);
      }
    }
    expect(underwater).toBeGreaterThan(100);
    // No drawn sub-triangle steeper than the side slope (the natural step here is 0.3), and none lying flat at the water plane.
    const a = 5 / 4;
    const h = a * (Math.sqrt(3) / 2);
    let steepest = 0;
    let flatAtWater = 0;
    for (const heights of field.triangles.values()) {
      for (let b = 0; b < 4; b++) {
        for (let k = 0; k + b < 4; k++) {
          const tri = (i0: number, j0: number, i1: number, j1: number, i2: number, j2: number) => {
            const z = [heights[idx(i0, j0)]!, heights[idx(i1, j1)]!, heights[idx(i2, j2)]!];
            // Plan positions in the triangle's own frame: sub-vertex (i, j) at i·e1 + j·e2, |e| = a, 60° apart.
            const p = [[i0, j0], [i1, j1], [i2, j2]].map(([i, j]) => [a * (i! + j! / 2), h * j!]);
            const [ax, ay] = [p[1]![0]! - p[0]![0]!, p[1]![1]! - p[0]![1]!];
            const [bx, by] = [p[2]![0]! - p[0]![0]!, p[2]![1]! - p[0]![1]!];
            const [dz1, dz2] = [z[1]! - z[0]!, z[2]! - z[0]!];
            const det = ax * by - ay * bx;
            const gx = (dz1 * by - dz2 * ay) / det;
            const gy = (ax * dz2 - bx * dz1) / det;
            steepest = Math.max(steepest, Math.hypot(gx, gy));
            if (z.every((v) => Math.abs(v - 10) < 0.03)) flatAtWater += 1;
          };
          tri(k, b, k + 1, b, k, b + 1);
          if (k + b + 1 < 4) tri(k + 1, b, k + 1, b + 1, k, b + 1);
        }
      }
    }
    expect(steepest).toBeLessThan((1 / SIDE_SLOPE_RUN) * 1.02);
    expect(flatAtWater).toBe(0);
  });

  it("lets cuts win: a fill never rises over another track", () => {
    // Two parallel runs one row (4.33 m) apart, the northern one 2 m up: its embankment must not bury the southern one.
    const low = Array.from({ length: 8 }, (_, i) => straight(10 + i, 40, 0, 20_000));
    const high = Array.from({ length: 8 }, (_, i) => straight(10 + i, 41, 0, 22_000));
    const field = conformTerrain(flat, { pieces: [...low, ...high] });
    const y0 = 40 * 2.5 * Math.sqrt(3);
    for (let x = 60; x < 90; x += 0.5) expect(field.heightAtM(x, y0)).toBeLessThanOrEqual(20 + 1e-5);
  });

  it("finds the nearest centreline point on lines and arcs", () => {
    const curve = earthworkPiece(flat, piece({ kind: "curve", from: { q: 20, r: 40, zMm: 20_000 }, heading: 0, turn: 2, radiusM: 60, variant: 0, z1Mm: 20_000 } as PieceSpec));
    // Every sampled centreline point is at distance 0 from itself.
    for (const prim of curve.prims) {
      if (prim.kind !== "arc") continue;
      for (let f = 0; f <= 1; f += 0.1) {
        const a = prim.startRad + prim.sweepRad * f;
        const n = nearestOnPiece(curve, prim.cx + prim.radiusM * Math.cos(a), prim.cy + prim.radiusM * Math.sin(a));
        expect(n.d).toBeLessThan(1e-9);
      }
      // A point 5 m outside the arc's middle is 5 m away, at half its arc length (plus any lead-in line).
      const mid = prim.startRad + prim.sweepRad / 2;
      const n = nearestOnPiece(curve, prim.cx + (prim.radiusM + 5) * Math.cos(mid), prim.cy + (prim.radiusM + 5) * Math.sin(mid));
      expect(n.d).toBeCloseTo(5, 9);
    }
  });

  it("returns a fresh nearest point per call unless the caller passes its own scratch", () => {
    // Review finding (PR #83): the result was one module-level object that every call overwrote.
    const a = earthworkPiece(flat, straight(20, 40, 0, 20_000));
    const b = earthworkPiece(flat, straight(18, 44, 0, 20_000));
    const x = 5 * (20 + 20) + 2;
    const y = 41 * 2.5 * Math.sqrt(3);
    const fromA = nearestOnPiece(a, x, y);
    const fromB = nearestOnPiece(b, x, y);
    expect(fromA).not.toBe(fromB);
    expect(fromA.d).toBeCloseTo(2.5 * Math.sqrt(3), 9);
    expect(fromB.d).toBeCloseTo(3 * 2.5 * Math.sqrt(3), 9);
    const scratch = { d: 0, s: 0 };
    expect(nearestOnPiece(a, x, y, scratch)).toBe(scratch);
    expect(scratch).toEqual(fromA);
  });

  it("sizes each piece's reach from the relief around it, round-offs included", () => {
    const reachFor = (relief: number) => FORMATION_HALF_WIDTH_M + CREST_ROUND_M / 2 + SIDE_SLOPE_RUN * (relief + DAYLIGHT_ROUND_M) + 1;
    expect(earthworkPiece(flat, straight(20, 40, 0, 20_000)).reachM).toBeCloseTo(reachFor(2), 9);
    // 8 m of cut: 3 + 1 + 1.5 × (8 + 0.6) + 1 = 17.9 m.
    expect(earthworkPiece(flat, straight(20, 40, 0, 12_000)).reachM).toBeCloseTo(reachFor(8), 9);
  });

  it("returns nothing for a chunk beyond the grid", () => {
    const tiny: Terrain = makeTerrain(2, 2, () => 200);
    expect(new ChunkPass().run(tiny, 1, 0, 0, [])).toBe(false);
  });
});
