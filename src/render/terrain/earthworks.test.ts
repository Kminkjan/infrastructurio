import { describe, expect, it } from "vitest";
import { type PieceSpec, type Terrain, resolvePiece } from "../../core/sim/api";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import {
  ChunkPass,
  DrawnHeightfield,
  EARTHWORK_MIN_M,
  FORMATION_HALF_WIDTH_M,
  type PieceInput,
  SIDE_SLOPE_RUN,
  WATER_FILL_CLEARANCE_M,
  conformTerrain,
  conformedHeightM,
  earthworkPiece,
  nearestOnPiece,
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

/** Height of the drawn surface `d` metres to the left of the heading-0 run through row r, at x. */
function across(field: DrawnHeightfield, x: number, y0: number, d: number): number {
  return field.heightAtM(x, y0 + d);
}

describe("earthworks conform (the rule)", () => {
  it("leaves ground-level track on flat ground untouched", () => {
    const field = conformTerrain(flat, { pieces: [straight(20, 40, 0, 20_000), straight(21, 40, 0, 20_000)] });
    expect(field.triangles.size).toBe(0);
  });

  it("raises an embankment: a 6 m crest at the track height, 1 : 1.5 slopes, natural beyond", () => {
    const run = Array.from({ length: 8 }, (_, i) => straight(10 + i, 40, 0, 22_000));
    const field = conformTerrain(flat, { pieces: run });
    expect(field.triangles.size).toBeGreaterThan(0);
    // Row 40 lies at y = 40 · 4.33 m; the run spans x ≈ 150–190 m. Sample mid-run, square to it.
    const y0 = 40 * 2.5 * Math.sqrt(3);
    const x = 5 * (14 + 20) + 2.5;
    expect(across(field, x, y0, 0)).toBeCloseTo(22, 5);
    expect(across(field, x, y0, 1.5)).toBeCloseTo(22, 5);
    expect(across(field, x, y0, -1.5)).toBeCloseTo(22, 5);
    // Mid-slope: 1.5 m past the crest edge is 1 m down.
    expect(across(field, x, y0, FORMATION_HALF_WIDTH_M + 1.5)).toBeCloseTo(21, 4);
    expect(across(field, x, y0, -(FORMATION_HALF_WIDTH_M + 1.5))).toBeCloseTo(21, 4);
    // Past the toe (3 + 2 × 1.5 = 6 m), natural ground.
    expect(across(field, x, y0, 8)).toBeCloseTo(20, 6);
    expect(across(field, x, y0, -8)).toBeCloseTo(20, 6);
    // Natural ground is never lowered by a fill.
    for (let d = -10; d <= 10; d += 0.37) expect(across(field, x, y0, d)).toBeGreaterThanOrEqual(20 - 1e-6);
  });

  it("digs a cutting: a 6 m bed at the track height, 1 : 1.5 slopes up to natural", () => {
    const run = Array.from({ length: 8 }, (_, i) => straight(10 + i, 40, 0, 17_000));
    const field = conformTerrain(flat, { pieces: run });
    const y0 = 40 * 2.5 * Math.sqrt(3);
    const x = 5 * (14 + 20) + 2.5;
    expect(across(field, x, y0, 0)).toBeCloseTo(17, 5);
    expect(across(field, x, y0, 2)).toBeCloseTo(17, 5);
    expect(across(field, x, y0, FORMATION_HALF_WIDTH_M + 3)).toBeCloseTo(19, 4);
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
        const analytic = conformedHeightM(pieces, x, y, 20, 10);
        worst = Math.max(worst, Math.abs(field.heightAtM(x, y) - analytic));
      }
    }
    // Piecewise-linear sampling of slopes of 1 : 1.5 on a 1.25 m lattice, plus the 5 cm "leave natural" band.
    expect(worst).toBeLessThan(1.25 / SIDE_SLOPE_RUN / 2 + EARTHWORK_MIN_M);
  });

  it("stops a fill 10 cm under the water surface, so it never z-fights the water plane", () => {
    // Water at 10 m over a bed at 9 m west of column 60; land at 10.5 m east of it.
    const wet = makeTerrain(120, 80, (_q, _r, col) => (col < 60 ? 90 : 105));
    const field = conformTerrain(wet, { pieces: Array.from({ length: 30 }, (_, i) => straight(20 + i, 40, 0, 11_000)) });
    const y0 = 40 * 2.5 * Math.sqrt(3);
    let underwater = 0;
    for (let x = 110; x < 250; x += 0.7) {
      for (let d = -8; d <= 8; d += 0.5) {
        const natural = field.naturalAtM(x, y0 + d);
        const drawn = field.heightAtM(x, y0 + d);
        if (natural < 10) {
          underwater += 1;
          expect(drawn).toBeLessThanOrEqual(10 - WATER_FILL_CLEARANCE_M + 1e-5);
        }
      }
    }
    expect(underwater).toBeGreaterThan(100);
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

  it("sizes each piece's reach from the relief around it", () => {
    expect(earthworkPiece(flat, straight(20, 40, 0, 20_000)).reachM).toBeLessThan(FORMATION_HALF_WIDTH_M + 2 * SIDE_SLOPE_RUN + 1e-9);
    const deep = earthworkPiece(flat, straight(20, 40, 0, 12_000));
    // 8 m of cut: 3 + 1.5 × 8 + 1 = 16 m.
    expect(deep.reachM).toBeCloseTo(16, 9);
  });

  it("returns nothing for a chunk beyond the grid", () => {
    const tiny: Terrain = makeTerrain(2, 2, () => 200);
    expect(new ChunkPass().run(tiny, 1, 0, 0, [])).toBe(false);
  });
});
