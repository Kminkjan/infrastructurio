import { describe, expect, it } from "vitest";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { simOn } from "../../../tests/support/simOn";
import { type Piece, type PieceSpec, resolvePiece } from "../geometry/piece";
import { type Heading, toWorld } from "../lattice";
import type { Command } from "../sim/api";
import { generateTerrain, heightDmAt, nodeOfOffset } from "../terrain";
import {
  ABUTMENT_DIP_MM,
  ABUTMENT_ZONE_MM,
  GROUND_BAND_MM,
  STRUCTURE_SAMPLE_STEP_M,
  TUNNEL_COVER_MM,
  TUNNEL_MIN_PEAK_COVER_MM,
  clearances,
  inferStructure,
  isAbutment,
  isPortal,
  pieceGround,
  structureFault,
  terrainMmAtPoint,
} from "./structure";

function piece(spec: PieceSpec): Piece {
  const res = resolvePiece(spec);
  if (!res.ok) throw new Error(res.failure.message);
  return res.piece;
}

function straight(q: number, r: number, heading: Heading, zMm = 0, z1Mm = zMm): PieceSpec {
  return { kind: "straight", from: { q, r, zMm }, heading, z1Mm };
}

/** Flat dry land at 0 m (water level −2 m) with a lake (bed −6 m) at columns 30–39, rows 0–20. */
const LAND = makeTerrain(60, 40, (_q, _r, col, row) => (col >= 30 && col <= 39 && row <= 20 ? -60 : 0), -20);
const WATER_MM = -2000;

describe("terrain under a piece", () => {
  it("interpolates the terrain on the lattice triangles, exactly at nodes and linearly between", () => {
    const t = generateTerrain({ seed: "structure-terrain", columns: 40, rows: 30 });
    for (const [q, r] of [
      [10, 10],
      [3, 20],
      [12, 5],
    ] as const) {
      const w = toWorld({ q, r });
      expect(terrainMmAtPoint(t, w.x, w.y)).toBeCloseTo((heightDmAt(t, { q, r }) ?? 0) * 100, 6);
      // The midpoint of an edge is the mean of its two nodes.
      const e = toWorld({ q: q + 1, r });
      expect(terrainMmAtPoint(t, (w.x + e.x) / 2, (w.y + e.y) / 2)).toBeCloseTo((((heightDmAt(t, { q, r }) ?? 0) + (heightDmAt(t, { q: q + 1, r }) ?? 0)) * 100) / 2, 6);
    }
  });

  it("decides straights exactly: a primary one at its nodes, a secondary one also at the edge it crosses", () => {
    const t = generateTerrain({ seed: "structure-terrain", columns: 40, rows: 30 });
    const mm = (q: number, r: number) => (heightDmAt(t, { q, r }) ?? 0) * 100;
    const primary = pieceGround(t, piece(straight(10, 10, 0)));
    expect(primary.f).toEqual([0, 1]);
    expect(primary.hMm).toEqual([mm(10, 10), mm(11, 10)]);
    // Heading 1 steps (1, 1) and crosses the edge from (11, 10) to (10, 11) at its midpoint.
    const secondary = pieceGround(t, piece(straight(10, 10, 1)));
    expect(secondary.f).toEqual([0, 0.5, 1]);
    expect(secondary.hMm).toEqual([mm(10, 10), (mm(11, 10) + mm(10, 11)) / 2, mm(11, 11)]);
  });

  it("samples curves every half metre of arc, with the exact node heights at both ends", () => {
    const t = generateTerrain({ seed: "structure-terrain", columns: 40, rows: 30 });
    const curve = piece({ kind: "curve", from: { q: 5, r: 5, zMm: 0 }, heading: 0, turn: 1, radiusM: 60, variant: 0, z1Mm: 0 });
    const g = pieceGround(t, curve);
    expect(g.f.length).toBeGreaterThanOrEqual(Math.ceil(curve.lengthMm / 1000 / STRUCTURE_SAMPLE_STEP_M));
    expect(g.f[0]).toBe(0);
    expect(g.f[g.f.length - 1]).toBe(1);
    expect(g.hMm[0]).toBe((heightDmAt(t, curve.ends[0].node) ?? 0) * 100);
    expect(g.hMm[g.hMm.length - 1]).toBe((heightDmAt(t, curve.ends[1].node) ?? 0) * 100);
    for (let i = 1; i < g.f.length; i++) expect(((g.f[i] ?? 0) - (g.f[i - 1] ?? 0)) * (curve.lengthMm / 1000)).toBeLessThanOrEqual(STRUCTURE_SAMPLE_STEP_M + 1e-6);
  });

  it("marks samples over water where the terrain lies below the water level", () => {
    const lakeRow = 10;
    const shore = nodeOfOffset(29, lakeRow);
    const g = pieceGround(LAND, piece(straight(shore.q, shore.r, 0)));
    expect(g.wet).toEqual([false, true]);
    expect(g.anyWet).toBe(true);
    expect(pieceGround(LAND, piece(straight(shore.q - 2, shore.r, 0))).anyWet).toBe(false);
  });
});

describe("structure inference and rules", () => {
  const dry = pieceGround(LAND, piece(straight(5, 5, 0)));
  const lake = nodeOfOffset(33, 10);
  const wet = pieceGround(LAND, piece(straight(lake.q, lake.r, 0)));
  const noPortal = () => Number.POSITIVE_INFINITY;

  it("infers ground within ±8 m on dry land, a bridge above it or in or over water, a tunnel below it or under water", () => {
    // D4 thresholds (owner decision 2026-09-28 "M2"): the band was ±4 m.
    expect(GROUND_BAND_MM).toBe(8000);
    expect(inferStructure(dry, GROUND_BAND_MM, GROUND_BAND_MM)).toBe("ground");
    expect(inferStructure(dry, -GROUND_BAND_MM, -GROUND_BAND_MM)).toBe("ground");
    expect(inferStructure(dry, 0, GROUND_BAND_MM + 1)).toBe("bridge");
    expect(inferStructure(dry, -GROUND_BAND_MM - 1, 0)).toBe("tunnel");
    // In the water (between the bed at −6 m and the surface at −2 m) or above it: a bridge; below the bed: a tunnel.
    expect(inferStructure(wet, -5000, -5000)).toBe("bridge");
    expect(inferStructure(wet, 3000, 3000)).toBe("bridge");
    expect(inferStructure(wet, -7000, -7000)).toBe("tunnel");
  });

  it("checks ground against the band and water", () => {
    expect(structureFault(dry, 8500, 8500, 5000, "ground", WATER_MM, noPortal)).toEqual({ code: "needs-bridge", aboveMm: 8500, overWater: false });
    expect(structureFault(dry, -8500, -8500, 5000, "ground", WATER_MM, noPortal)).toMatchObject({ code: "needs-tunnel", belowMm: 8500, underWater: false });
    expect(structureFault(wet, 0, 0, 5000, "ground", WATER_MM, noPortal)).toMatchObject({ code: "needs-bridge", overWater: true });
    expect(structureFault(wet, -7000, -7000, 5000, "ground", WATER_MM, noPortal)).toMatchObject({ code: "needs-tunnel", underWater: true });
    expect(structureFault(dry, 8000, -8000, 5000, "ground", WATER_MM, noPortal)).toBeNull();
  });

  it("checks a bridge's deck against the terrain and the water level + 4.0 m", () => {
    expect(structureFault(dry, 0, 0, 5000, "bridge", WATER_MM, noPortal)).toBeNull();
    expect(structureFault(wet, 1999, 1999, 5000, "bridge", WATER_MM, noPortal)).toEqual({ code: "bridge-too-low-over-water", missingMm: 1 });
    expect(structureFault(wet, 2000, 2000, 5000, "bridge", WATER_MM, noPortal)).toBeNull();
  });

  it("lets a deck dip up to 2 m below the terrain within 15 m of an abutment, and nowhere else (M2)", () => {
    expect([ABUTMENT_DIP_MM, ABUTMENT_ZONE_MM]).toEqual([2000, 15_000]);
    // No abutment within 15 m: any dip fails, as before the owner decision.
    expect(structureFault(dry, -1, 0, 5000, "bridge", WATER_MM, noPortal)).toEqual({ code: "bridge-below-ground", belowMm: 1, abutmentMm: Number.POSITIVE_INFINITY });
    // End 0 is an abutment: 2 m below passes there, 1 mm more fails and names it.
    const atEnd0 = (end: 0 | 1) => (end === 0 ? 0 : Number.POSITIVE_INFINITY);
    expect(structureFault(dry, -ABUTMENT_DIP_MM, 0, 5000, "bridge", WATER_MM, atEnd0)).toBeNull();
    expect(structureFault(dry, -ABUTMENT_DIP_MM - 1, 0, 5000, "bridge", WATER_MM, atEnd0)).toEqual({ code: "bridge-below-ground", belowMm: 2001, abutmentMm: 0 });
    // A 1 m dip at end 1 of a 5 m piece: 10 m behind end 0 puts it 15 m from the abutment and passes; 1 mm more fails.
    const behind = (mm: number) => (end: 0 | 1) => (end === 0 ? mm : Number.POSITIVE_INFINITY);
    expect(structureFault(dry, 0, -1000, 5000, "bridge", WATER_MM, behind(10_000))).toBeNull();
    expect(structureFault(dry, 0, -1000, 5000, "bridge", WATER_MM, behind(10_001))).toEqual({ code: "bridge-below-ground", belowMm: 1000, abutmentMm: Number.POSITIVE_INFINITY });
    // The reach is only asked for when the deck dips.
    let asked = 0;
    expect(structureFault(dry, 500, 0, 5000, "bridge", WATER_MM, () => (asked++, 0))).toBeNull();
    expect(asked).toBe(0);
  });

  it("finds abutments on dry land within the band only", () => {
    expect(isAbutment(LAND, { q: 5, r: 5, zMm: GROUND_BAND_MM })).toBe(true);
    expect(isAbutment(LAND, { q: 5, r: 5, zMm: -GROUND_BAND_MM })).toBe(true);
    expect(isAbutment(LAND, { q: 5, r: 5, zMm: GROUND_BAND_MM + 1 })).toBe(false);
    expect(isAbutment(LAND, { q: 5, r: 5, zMm: -GROUND_BAND_MM - 1 })).toBe(false);
    // A node over the lake (bed −6 m under water at −2 m) with the deck 7 m over the bed is not an abutment.
    expect(isAbutment(LAND, { q: lake.q, r: lake.r, zMm: 1000 })).toBe(false);
  });

  it("checks a tunnel's cover, except within 10 m of a portal, and rejects one no deeper than a cutting", () => {
    expect(structureFault(dry, -GROUND_BAND_MM, -GROUND_BAND_MM, 5000, "tunnel", WATER_MM, noPortal)).toMatchObject({ code: "tunnel-too-shallow", shallowOnly: true });
    // At ±8 m a tunnel 5 m down is a cutting (it was a shallow tunnel at ±4 m).
    expect(structureFault(dry, -5000, -5000, 5000, "tunnel", WATER_MM, noPortal)).toMatchObject({ code: "tunnel-too-shallow", coverMm: 5000, shallowOnly: true });
    // 9 m down at end 0 and 5 m at end 1: deeper than the band, but 5 m of cover with no portal near.
    expect(structureFault(dry, -9000, -5000, 5000, "tunnel", WATER_MM, noPortal)).toMatchObject({ code: "tunnel-too-shallow", coverMm: 5000, shallowOnly: false });
    expect(structureFault(dry, -9000, -TUNNEL_COVER_MM, 5000, "tunnel", WATER_MM, noPortal)).toBeNull();
    // 5 m of cover at end 1 passes when a portal lies within 10 m of it: 5 m beyond end 1, not 5,001 mm.
    expect(structureFault(dry, -9000, -5000, 5000, "tunnel", WATER_MM, (end) => (end === 1 ? 5000 : Number.POSITIVE_INFINITY))).toBeNull();
    expect(structureFault(dry, -5000, -9000, 5000, "tunnel", WATER_MM, (end) => (end === 1 ? 5001 : Number.POSITIVE_INFINITY))).toMatchObject({ code: "tunnel-too-shallow" });
    expect(isPortal(LAND, { q: 5, r: 5, zMm: -GROUND_BAND_MM })).toBe(true);
    expect(isPortal(LAND, { q: 5, r: 5, zMm: -GROUND_BAND_MM - 1 })).toBe(false);
  });
});

/**
 * A secondary run (heading 1, nodes (q0 + i, r0 + i)) whose midpoints sample other ground than its nodes: from row
 * `fromRow` on, the nodes on the run's line stand at `lineDm` and the nodes beside it (the ends of the edge each
 * midpoint crosses) at `sideDm`; before that row everything is `flatDm`. Since the band (8 m) is deeper than the 6 m
 * cover, a node with less cover is itself a portal, and a node where a deck dips 2 m or less is itself an abutment,
 * so only such midpoints (and curves) need the walk along the track (owner decision 2026-09-28 "M2").
 */
function ridgeRun(lineDm: number, sideDm: number, flatDm: number, fromRow: number) {
  const q0 = 10;
  const r0 = fromRow - 3;
  const line = q0 - r0;
  const terrain = makeTerrain(40, 30, (q, r) => (r < fromRow ? flatDm : q - r === line ? lineDm : sideDm), -20);
  const specs = (count: number, zMm: number, first = 0): PieceSpec[] => Array.from({ length: count - first }, (_, i) => straight(q0 + first + i, r0 + first + i, 1, zMm));
  return { terrain, specs };
}

describe("walks along the track to the nearest portal or abutment", () => {
  const build = (pieces: PieceSpec[]): Command => ({ type: "build-track", pieces, structure: "auto" });

  it("counts the distance to a portal through the tunnel pieces before it", () => {
    // Track at 0 m under an 11 m ridge line with 5 m ground beside it: nodes under 11 m of cover (not portals),
    // midpoints under 5 m. The first ridge piece's midpoint lies 4.3 m from the portal on the flat (cover 2.5 m)
    // and passes; the next one's lies 13 m from it, walking back through the first, and fails. (The ridge was 9 m
    // until the owner decision 2026-09-28, "Needs 10 m somewhere", which makes such a run a cutting.)
    const { terrain, specs } = ridgeRun(110, 50, 0, 8);
    const sim = simOn(terrain);
    const three = sim.preview(build(specs(3, 0)));
    expect(three.ok && three.diff.added.map((r) => r.structure).sort()).toEqual(["ground", "ground", "tunnel"]);
    const four = sim.preview(build(specs(4, 0)));
    expect(!four.ok && four.reason.code).toBe("tunnel-too-shallow");
    expect(!four.ok && four.reason.message).toContain("5 m of cover 13 m from the nearest portal");
    // Built piece by piece the same: a new piece walks back through the tunnel piece already built.
    const stepwise = simOn(terrain);
    expect(stepwise.execute(build(specs(3, 0))).ok).toBe(true);
    const next = stepwise.preview(build(specs(4, 0, 3)));
    expect(!next.ok && next.reason.message).toContain("5 m of cover 13 m from the nearest portal");
    // Alone, with nothing to walk through, no portal lies within 10 m.
    const alone = simOn(terrain).preview(build(specs(4, 0, 3)));
    expect(!alone.ok && alone.reason.message).toContain("5 m of cover with no portal within 10 m");
    // With 7 m beside the ridge the midpoints keep 6 m of cover, so any length passes.
    expect(simOn(ridgeRun(120, 70, 0, 8).terrain).preview(build(specs(10, 0))).ok).toBe(true);
  });

  it("counts the distance to an abutment through the bridge pieces before it (M2)", () => {
    // A deck at 9 m over a trench line at 0 m (nodes 9 m up: not abutments) with banks at 10.5 m beside it
    // (midpoints 1.5 m above the deck), from a flat at the deck's height (nodes on it: abutments). The midpoints lie
    // 4.3 m, 13 m and 21.7 m from the last abutment: the first two pass, walking back through the bridge; the third fails.
    const { terrain, specs } = ridgeRun(0, 105, 90, 8);
    const sim = simOn(terrain);
    const four = sim.preview(build(specs(4, 9000)));
    expect(four.ok && four.diff.added.map((r) => r.structure).sort()).toEqual(["bridge", "bridge", "ground", "ground"]);
    const five = sim.preview(build(specs(5, 9000)));
    expect(!five.ok && five.reason.code).toBe("bridge-below-ground");
    expect(!five.ok && five.reason.message).toBe(
      "Bridge piece 5 dips 1.5 m below the terrain with no abutment within 15 m (only there may a deck sit up to 2 m in the bank); raise the deck or build on the ground.",
    );
    // Built piece by piece the same, through the bridge pieces already built.
    const stepwise = simOn(terrain);
    expect(stepwise.execute(build(specs(3, 9000))).ok).toBe(true);
    expect(stepwise.execute(build(specs(4, 9000, 3))).ok).toBe(true);
    expect(stepwise.preview(build(specs(5, 9000, 4))).ok).toBe(false);
    // Near an abutment the dip may not pass 2 m: banks at 11.5 m put the second midpoint 2.5 m above the deck.
    const deep = simOn(ridgeRun(0, 115, 90, 8).terrain).preview(build(specs(4, 9000)));
    expect(!deep.ok && deep.reason.message).toBe(
      "Bridge piece 4 dips 2.5 m below the terrain 13 m from an abutment, more than the 2 m a deck may sit in the bank; raise the deck or build on the ground.",
    );
  });
});

describe('a tunnel needs 10 m somewhere (owner decision 2026-09-28, "Needs 10 m somewhere")', () => {
  /** Level straights east along row 20 at `zMm` from q0: `n` of them. */
  const east = (q0: number, n: number, zMm = 0): PieceSpec[] => Array.from({ length: n }, (_, i) => straight(q0 + i, 20, 0, zMm));
  const auto = (pieces: PieceSpec[]): Command => ({ type: "build-track", pieces, structure: "auto" });
  /** A hill by column along row 20 (col = q + 10), dm: flat 0 outside, the given heights from column 21 on. */
  const hill = (profileDm: readonly number[], waterDm = -100) => makeTerrain(60, 40, (_q, _r, col) => profileDm[col - 21] ?? 0, waterDm);
  /** Structures in command order, one letter each. */
  const kinds = (specs: readonly PieceSpec[], result: ReturnType<ReturnType<typeof simOn>["preview"]>): string => {
    if (!result.ok) return `${result.reason.code}: ${result.reason.message}`;
    const by = new Map(result.diff.added.map((a) => [a.key, a.structure[0]]));
    return specs.map((s) => by.get(piece(s).key) ?? "=").join("");
  };

  it("makes a run that never reaches 10 m of cover a cutting up to 10 m deep, and keeps one that does a tunnel", () => {
    expect(TUNNEL_MIN_PEAK_COVER_MM).toBe(10_000);
    // A crest 9.9 m over the track for four nodes: four pieces deeper than the band, 9.9 m at most.
    const crest = hill([50, 99, 99, 99, 99, 50]);
    const specs = east(8, 12);
    const shallow = simOn(crest).preview(auto(specs));
    expect(kinds(specs, shallow)).toBe("gggggggggggg");
    // The same crest 10 m up: a tunnel through it, with a portal at each end (cover 5 m ≤ 8 m there).
    const deep = hill([50, 100, 100, 100, 100, 50]);
    const through = simOn(deep).preview(auto(specs));
    expect(kinds(specs, through)).toBe("gggtttttgggg");
    expect(isPortal(deep, { q: 11, r: 20, zMm: 0 }) && isPortal(deep, { q: 16, r: 20, zMm: 0 })).toBe(true);
    // Under the rule a 9.9 m cutting is ground; forced ground keeps the ±8 m band (no tool forces a structure).
    const forced = simOn(crest).preview({ type: "build-track", pieces: specs, structure: "ground" });
    expect(!forced.ok && forced.reason.code).toBe("needs-tunnel");
    expect(!forced.ok && forced.reason.message).toContain("runs 9.9 m below the terrain, deeper than the 8 m a cutting takes");
  });

  it("decides a single piece by its own depth: 9.999 m down is a cutting, 10 m a tunnel, and forced ground fails at 10.2 m", () => {
    const flat = makeTerrain(60, 40, () => 0, -100);
    expect(kinds([straight(10, 10, 0, -9999)], simOn(flat).preview(auto([straight(10, 10, 0, -9999)])))).toBe("g");
    expect(kinds([straight(10, 10, 0, -10_000)], simOn(flat).preview(auto([straight(10, 10, 0, -10_000)])))).toBe("t");
    const deep = simOn(flat).preview({ type: "build-track", pieces: [straight(10, 10, 0, -10_200)], structure: "ground" });
    expect(!deep.ok && deep.reason.code).toBe("needs-tunnel");
    const nine = simOn(flat).preview({ type: "build-track", pieces: [straight(10, 10, 0, -9000)], structure: "ground" });
    expect(!nine.ok && nine.reason.code).toBe("needs-tunnel");
  });

  it("leaves a run that joins a committed tunnel a tunnel, whatever its own depth", () => {
    // 5 m at column 21, 9 m at 22, 12 m over columns 23–26, then 9 m over columns 27–32.
    const terrain = hill([50, 90, 120, 120, 120, 120, 90, 90, 90, 90, 90, 90]);
    const sim = simOn(terrain);
    // Into the hill to (17, 20) (column 27, 9 m of cover): a tunnel under 12 m, ending at a buffer.
    const first = east(5, 12);
    const built = sim.execute(auto(first));
    expect(kinds(first, built)).toBe("ggggggtttttt");
    // On from the buffer under 9 m only: it joins the tunnel, so it is one.
    const on = east(17, 5);
    expect(kinds(on, sim.preview(auto(on)))).toBe("ttttt");
    // Alone, the same run is a 9 m cutting.
    expect(kinds(on, simOn(terrain).preview(auto(on)))).toBe("ggggg");
  });

  it("leaves a run under water and a run with a piece more than 8 m above the terrain a tunnel", () => {
    // A lake with its bed at −6 m under water at −2 m over columns 21–30: track at −15 m, 9 m under the bed.
    const lake = hill(Array(10).fill(-60), -20);
    const under = east(12, 8, -15_000);
    expect(kinds(under, simOn(lake).preview(auto(under)))).toBe("tttttttt");
    // A piece from an 8.5 m deep pit (column 21) to a 9 m cliff (column 22): 8.5 m above and 9 m below the terrain.
    const cliff = hill([-85, 90, 90], -200);
    const leap = [straight(11, 20, 0)];
    const result = simOn(cliff).preview(auto(leap));
    expect(kinds(leap, result)).toBe("t");
    // Made ground it would need a bridge.
    const forced = simOn(cliff).preview({ type: "build-track", pieces: leap, structure: "ground" });
    expect(!forced.ok && forced.reason.code).toBe("needs-bridge");
  });

  it("rebuilds the diagnosis scene s208 as one continuous cutting: a Straight line under an 8.13 m crest", () => {
    // (208, 146) → (232, 146) with the Straight line tool on the diorama: until the rule, 15 ground pieces, a 20 m
    // tunnel whose deepest natural cover was 8.13 m (8.125 m), and 5 ground pieces.
    const terrain = generateTerrain({ seed: "baltic-diorama", columns: 400, rows: 346 });
    const sim = simOn(terrain);
    const from = { q: 208, r: 146, zMm: sim.groundMm(208, 146) ?? 0 };
    const to = toWorld({ q: 232, r: 146 });
    const plan = sim.planTrack({ from, to: { xMm: Math.round(to.x * 1000), yMm: Math.round(to.y * 1000) }, dzMm: (sim.groundMm(232, 146) ?? 0) - from.zMm, magnetism: true, heightMode: "straight" });
    expect(plan.pieces).toHaveLength(24);
    const preview = sim.preview(auto([...plan.pieces]));
    expect(kinds(plan.pieces, preview)).toBe("g".repeat(24));
    // The deepest piece lies 8.125 m under the natural crest.
    const deepest = Math.max(...plan.pieces.map((s) => { const p = piece(s); return clearances(pieceGround(terrain, p), p.ends[0].node.zMm, p.ends[1].node.zMm).belowMm; }));
    expect(deepest).toBe(8125);
    // Preview equals execute, and the cutting builds.
    expect(sim.execute(auto([...plan.pieces]))).toEqual(preview);
    expect(sim.network().pieces.every((p) => p.structure === "ground")).toBe(true);
  });

  it("does not depend on the command's order", () => {
    const deep = hill([50, 100, 100, 100, 100, 50, 0, 0, 50, 99, 99, 50]);
    const specs = east(8, 20);
    const forward = simOn(deep).preview(auto(specs));
    const backward = simOn(deep).preview(auto([...specs].reverse()));
    expect(forward.ok && backward.ok).toBe(true);
    if (!forward.ok || !backward.ok) return;
    expect(kinds(specs, forward)).toBe("gggtttttgggggggggggg");
    expect(new Map(backward.diff.added.map((a) => [a.key, a.structure]))).toEqual(new Map(forward.diff.added.map((a) => [a.key, a.structure])));
  });
});
