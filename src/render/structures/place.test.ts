import { describe, expect, it } from "vitest";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { solidsFacingIn, windingMismatches } from "../../../tests/support/geometry";
import { type NetworkView, type PieceSpec } from "../../core/sim/api";
import { createWorld } from "../../core/sim/world";
import { GeometrySink, bend, place } from "./place";
import { RunPath } from "./runPath";
import { structureRuns } from "./runs";
import { StructureBuilder } from "./structureBuilder";
import { buildArchSpan, buildPier } from "./assets";

function curvedPath(): RunPath {
  const world = createWorld(makeTerrain(80, 60, () => 200));
  const curve: PieceSpec = { kind: "curve", from: { q: 20, r: 20, zMm: 30_000 }, heading: 0, turn: 3, radiusM: 60, variant: 0, z1Mm: 31_000 };
  const r = world.run({ type: "build-track", pieces: [curve], structure: "bridge" }, true);
  expect(r.ok).toBe(true);
  const run = structureRuns(world.network() as NetworkView)[0];
  if (!run) throw new Error("no run");
  return RunPath.ofRun(run.pieces);
}

describe("bending and placing structure templates", () => {
  it("keeps every convex solid facing outward when bent along a tight curve, both ways", () => {
    const path = curvedPath();
    for (const dir of [1, -1] as const) {
      const sb = new StructureBuilder();
      sb.use("walls", 0x808080);
      // Bars across the deck's full width, every 3 m along the curve.
      for (let x = 0; x + 2.5 < path.lengthM; x += 3) sb.bar(x, x + 2.5, -2, 1, -3.2, 3.2, { y0: true });
      const g = sb.build().walls;
      if (!g) throw new Error("no geometry");
      const sink = new GeometrySink();
      bend(sink, g, path, dir === 1 ? 0 : path.lengthM, dir);
      const out = sink.build();
      expect(sink.triangleCount).toBe(g.getAttribute("position").count / 3);
      expect(windingMismatches(out)).toBe(0);
      expect(solidsFacingIn(out, sb.solids)).toBe(0);
    }
  });

  it("bends a whole arch span along the curve without turning a triangle inward", () => {
    const path = curvedPath();
    const sb = buildArchSpan(12, 5.1, 0);
    const slots = sb.build();
    for (const slot of ["walls", "trim"] as const) {
      const g = slots[slot];
      if (!g) continue;
      const sink = new GeometrySink();
      bend(sink, g, path, 2, 1);
      expect(solidsFacingIn(sink.build(), sb.solids.filter((s) => s.slot === slot))).toBe(0);
    }
  });

  it("places a pier square to the tangent: model +X along it, +Z to its right, y = 0 at the given height", () => {
    const sb = buildPier(10, false);
    const g = sb.build().walls;
    if (!g) throw new Error("no geometry");
    const sink = new GeometrySink();
    // Tangent north (0, 1): +X points north (world −Z), right is east (world +X).
    place(sink, g, { x: 50, y: 60, z: 5, tx: 0, ty: 1 });
    const out = sink.build();
    out.computeBoundingBox();
    const box = out.boundingBox;
    expect(box?.min.y).toBeCloseTo(5, 4);
    // The pier is wider across (east–west, world x) than along (north–south, world z).
    expect((box?.max.x ?? 0) - (box?.min.x ?? 0)).toBeGreaterThan((box?.max.z ?? 0) - (box?.min.z ?? 0));
    expect(solidsFacingIn(out, sb.solids.filter((s) => s.slot === "walls"))).toBe(0);
  });
});
