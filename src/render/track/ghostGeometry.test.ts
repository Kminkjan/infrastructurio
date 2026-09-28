import { describe, expect, it } from "vitest";
import { type PieceSpec, resolvePiece } from "../../core/sim/api";
import { palette } from "../art/palette";
import { DASH_OFF_M, DASH_ON_M, RIBBON_LIFT_M, buildRibbons, clipFrames, dashIntervals, elevationMarks, heightTagText } from "./ghostGeometry";
import { type TrackCentreline, sampleCentreline } from "./trackGeometry";
import { GHOST_BORE_EDGE_M, GHOST_DECK_EDGE_M, GHOST_MARK_HALF_M, structureMarks } from "./GhostView";

function line(spec: PieceSpec): TrackCentreline {
  const res = resolvePiece(spec);
  if (!res.ok) throw new Error(res.failure.message);
  return { prims: res.piece.prims, z0M: res.piece.ends[0].node.zMm / 1000, z1M: res.piece.ends[1].node.zMm / 1000 };
}

/** Eight 5 m straights east from (0, 0) at a constant height: a 40 m run. */
function run(zMm: number): TrackCentreline[] {
  return Array.from({ length: 8 }, (_, i) => line({ kind: "straight", from: { q: i, r: 0, zMm }, heading: 0, z1Mm: zMm }));
}

describe("ghost geometry", () => {
  it("dashes 3 m on, 2 m off", () => {
    expect(dashIntervals(12)).toEqual([
      [0, 3],
      [5, 8],
      [10, 12],
    ]);
    expect(DASH_ON_M + DASH_OFF_M).toBe(5);
  });

  it("clips frames with interpolated cuts", () => {
    const frames = sampleCentreline(line({ kind: "straight", from: { q: 0, r: 0, zMm: 0 }, heading: 0, z1Mm: 1000 }));
    const clipped = clipFrames(frames, 1, 4);
    expect(clipped.map((f) => f.sM)).toEqual([1, 4]);
    expect(clipped[0]?.z).toBeCloseTo(0.2, 12);
  });

  it("builds upward-facing ribbons, coloured per piece, and dashes an invalid plan along its whole length", () => {
    const solid = buildRibbons(run(0).map((c) => ({ centreline: c, color: palette.ghostValid })), false);
    const dashed = buildRibbons(run(0).map((c) => ({ centreline: c, color: palette.ghostInvalid })), true);
    expect(solid.vertexCount).toBe(8 * 2 * 2);
    // 40 m: dashes start at 0, 5, … 35, eight of them, each two frames wide.
    expect(dashed.vertexCount).toBe(8 * 2 * 2);
    let maxX = 0;
    for (let i = 0; i < dashed.vertexCount; i++) maxX = Math.max(maxX, dashed.positions[i * 3] ?? 0);
    expect(maxX).toBeCloseTo(38, 6);
    for (let t = 0; t < solid.indices.length; t += 3) {
      const p = (k: number) => [solid.positions[k * 3] ?? 0, solid.positions[k * 3 + 1] ?? 0, solid.positions[k * 3 + 2] ?? 0];
      const [a, b, c] = [p(solid.indices[t] ?? 0), p(solid.indices[t + 1] ?? 0), p(solid.indices[t + 2] ?? 0)];
      const e1 = [(b[0] ?? 0) - (a[0] ?? 0), (b[2] ?? 0) - (a[2] ?? 0)];
      const e2 = [(c[0] ?? 0) - (a[0] ?? 0), (c[2] ?? 0) - (a[2] ?? 0)];
      // World y of (b − a) × (c − a) = e1.z·e2.x − e1.x·e2.z.
      expect((e1[1] ?? 0) * (e2[0] ?? 0) - (e1[0] ?? 0) * (e2[1] ?? 0)).toBeGreaterThan(0);
    }
    expect(solid.positions[1]).toBeCloseTo(RIBBON_LIFT_M, 6);
  });

  it("drops lines every 20 m and tags both ends when the ghost is above the ground", () => {
    const flat = () => 0;
    const high = elevationMarks(run(6000), flat);
    expect(high.elevated).toBe(true);
    // Stations at 0, 20 and 40 m (the end), one segment (two points) each.
    expect(high.dropLines.length).toBe(3 * 2 * 3);
    expect(high.ends.map((e) => e.aboveM)).toEqual([6, 6]);
    const low = elevationMarks(run(300), flat);
    expect(low.elevated).toBe(false);
    expect(low.dropLines.length).toBe(0);
    // Off the map, no line and a zero height.
    expect(elevationMarks(run(6000), () => undefined).dropLines.length).toBe(0);
  });

  it("writes end-height tags", () => {
    expect(heightTagText(6)).toBe("+6 m");
    expect(heightTagText(2.54)).toBe("+2.5 m");
    expect(heightTagText(-1)).toBe("−1 m");
    expect(heightTagText(0.02)).toBe("0 m");
  });

  it("draws bands beside the track with their own width, offset and dash (D4)", () => {
    const c = run(0)[0] as TrackCentreline;
    const band = buildRibbons([{ centreline: c, color: palette.xray, halfWidthM: 0.2, offsetM: 3, liftM: 1 }], false);
    // Heading east, right is south: world z = −y = +3 ± 0.2.
    const zs = Array.from({ length: band.vertexCount }, (_, i) => band.positions[i * 3 + 2] ?? 0);
    expect(Math.min(...zs)).toBeCloseTo(2.8, 6);
    expect(Math.max(...zs)).toBeCloseTo(3.2, 6);
    expect(band.positions[1]).toBeCloseTo(1, 6);
    const dashed = buildRibbons([{ centreline: c, color: palette.xray, dash: [1, 1] }], false);
    // 5 m at 1 on, 1 off: dashes at 0, 2, 4 (the last cut at the end).
    expect(dashed.vertexCount).toBe(3 * 2 * 2);
  });

  it("marks a bridge ghost's deck edges and a tunnel ghost's dashed bore, and nothing for ground", () => {
    const c = run(0)[0] as TrackCentreline;
    const bridge = structureMarks([{ centreline: c, color: palette.ghostValid, structure: "bridge" }]);
    expect(bridge.map((b) => [b.offsetM, b.halfWidthM, b.dash])).toEqual([
      [GHOST_DECK_EDGE_M, GHOST_MARK_HALF_M, undefined],
      [-GHOST_DECK_EDGE_M, GHOST_MARK_HALF_M, undefined],
    ]);
    const tunnel = structureMarks([{ centreline: c, color: palette.ghostInvalid, structure: "tunnel" }]);
    expect(tunnel.map((b) => b.offsetM)).toEqual([GHOST_BORE_EDGE_M, -GHOST_BORE_EDGE_M]);
    expect(tunnel.every((b) => b.dash !== undefined && b.color === palette.ghostInvalid)).toBe(true);
    expect(structureMarks([{ centreline: c, color: palette.ghostValid, structure: "ground" }])).toEqual([]);
  });
});
