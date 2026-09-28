import { describe, expect, it } from "vitest";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { simOn } from "../../../tests/support/simOn";
import { type Piece, type PieceSpec, resolvePiece } from "../geometry/piece";
import { type Heading, toWorld } from "../lattice";
import type { Command } from "../sim/api";
import { generateTerrain, heightDmAt, nodeOfOffset } from "../terrain";
import {
  GROUND_BAND_MM,
  STRUCTURE_SAMPLE_STEP_M,
  TUNNEL_COVER_MM,
  inferStructure,
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

  it("infers ground within ±4 m on dry land, a bridge above it or in or over water, a tunnel below it or under water", () => {
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
    expect(structureFault(dry, 4500, 4500, 5000, "ground", WATER_MM, noPortal)).toEqual({ code: "needs-bridge", aboveMm: 4500, overWater: false });
    expect(structureFault(dry, -4500, -4500, 5000, "ground", WATER_MM, noPortal)).toMatchObject({ code: "needs-tunnel", belowMm: 4500, underWater: false });
    expect(structureFault(wet, 0, 0, 5000, "ground", WATER_MM, noPortal)).toMatchObject({ code: "needs-bridge", overWater: true });
    expect(structureFault(wet, -7000, -7000, 5000, "ground", WATER_MM, noPortal)).toMatchObject({ code: "needs-tunnel", underWater: true });
    expect(structureFault(dry, 4000, -4000, 5000, "ground", WATER_MM, noPortal)).toBeNull();
  });

  it("checks a bridge's deck against the terrain and the water level + 4.0 m", () => {
    expect(structureFault(dry, -1, 0, 5000, "bridge", WATER_MM, noPortal)).toEqual({ code: "bridge-below-ground", belowMm: 1 });
    expect(structureFault(dry, 0, 0, 5000, "bridge", WATER_MM, noPortal)).toBeNull();
    expect(structureFault(wet, 1999, 1999, 5000, "bridge", WATER_MM, noPortal)).toEqual({ code: "bridge-too-low-over-water", missingMm: 1 });
    expect(structureFault(wet, 2000, 2000, 5000, "bridge", WATER_MM, noPortal)).toBeNull();
  });

  it("checks a tunnel's cover, except within 10 m of a portal, and rejects one no deeper than a cutting", () => {
    expect(structureFault(dry, -4000, -4000, 5000, "tunnel", WATER_MM, noPortal)).toMatchObject({ code: "tunnel-too-shallow", shallowOnly: true });
    expect(structureFault(dry, -5000, -5000, 5000, "tunnel", WATER_MM, noPortal)).toMatchObject({ code: "tunnel-too-shallow", coverMm: 5000, shallowOnly: false });
    expect(structureFault(dry, -TUNNEL_COVER_MM, -TUNNEL_COVER_MM, 5000, "tunnel", WATER_MM, noPortal)).toBeNull();
    // 5 m of cover passes when a portal lies within 10 m of every sample: 5 m behind end 0 reaches 10 m at end 1.
    expect(structureFault(dry, -5000, -5000, 5000, "tunnel", WATER_MM, (end) => (end === 0 ? 5000 : Number.POSITIVE_INFINITY))).toBeNull();
    expect(structureFault(dry, -5000, -5000, 5000, "tunnel", WATER_MM, (end) => (end === 0 ? 5001 : Number.POSITIVE_INFINITY))).toMatchObject({ code: "tunnel-too-shallow" });
    expect(isPortal(LAND, { q: 5, r: 5, zMm: -GROUND_BAND_MM })).toBe(true);
    expect(isPortal(LAND, { q: 5, r: 5, zMm: -GROUND_BAND_MM - 1 })).toBe(false);
  });
});

describe("tunnel portals along the track", () => {
  /** Flat land at 0 m, and from column 20 east a plateau `plateauDm` high (a cliff between columns 19 and 20). */
  const cliff = (plateauDm: number) => makeTerrain(40, 20, (_q, _r, col) => (col >= 20 ? plateauDm : 0), -20);
  const row = 10;
  const q0 = nodeOfOffset(15, row).q;
  const run = (count: number): Command => ({
    type: "build-track",
    pieces: Array.from({ length: count }, (_, i) => straight(q0 + i, row, 0)),
    structure: "auto",
  });

  it("counts the distance to the portal through the tunnel pieces before it", () => {
    // Under 5.5 m of plateau: the portal is column 19 (cover 0). Two tunnel pieces reach 10 m in and pass; a third
    // reaches 15 m and fails.
    const shallow = cliff(55);
    const sim = simOn(shallow);
    const two = sim.preview(run(6));
    expect(two.ok && two.diff.added.map((r) => r.structure)).toEqual(["ground", "ground", "ground", "ground", "tunnel", "tunnel"]);
    const three = sim.preview(run(7));
    expect(!three.ok && three.reason.code).toBe("tunnel-too-shallow");
    expect(!three.ok && three.reason.message).toContain("5.5 m of cover 15 m from the nearest portal");
    // Built piece by piece the same: a new piece walks back through the tunnel pieces already built.
    const stepwise = simOn(shallow);
    expect(stepwise.execute(run(5)).ok).toBe(true);
    expect(stepwise.execute({ type: "build-track", pieces: [straight(q0 + 5, row, 0)], structure: "auto" }).ok).toBe(true);
    const third = stepwise.preview({ type: "build-track", pieces: [straight(q0 + 6, row, 0)], structure: "auto" });
    expect(!third.ok && third.reason.code).toBe("tunnel-too-shallow");
    // Under 8 m of plateau the cover reaches 6 m within 5 m of the portal, so any length passes.
    expect(simOn(cliff(80)).preview(run(15)).ok).toBe(true);
  });
});
