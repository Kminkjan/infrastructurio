import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { createSim, toWorld } from "../../core/sim/api";
import { ISO_PITCH_RAD, type IsoView, worldToScreen } from "../camera/isoMath";
import { simToWorld } from "../coords";
import { NODE_PICK_RADIUS_PX, TRACK_PICK_RADIUS_PX, pickTrack } from "./trackPicker";

function setup() {
  const sim = createSim({ terrain: { seed: "d3-pick", columns: 80, rows: 60 } });
  // A 20 m run east from (10, 20) at 3 m, and an elevated run at 12 m further north.
  sim.execute({
    type: "build-track",
    structure: "auto",
    pieces: Array.from({ length: 4 }, (_, i) => ({ kind: "straight", from: { q: 10 + i, r: 20, zMm: 3000 }, heading: 0, z1Mm: 3000 }) as const),
  });
  sim.execute({
    type: "build-track",
    structure: "auto",
    pieces: Array.from({ length: 4 }, (_, i) => ({ kind: "straight", from: { q: 0 + i, r: 40, zMm: 12_000 }, heading: 0, z1Mm: 12_000 }) as const),
  });
  const centre = toWorld({ q: 12, r: 20 });
  const view: IsoView = { target: { x: centre.x, z: -centre.y }, ppm: 6, yaw: 0, pitch: ISO_PITCH_RAD, cssWidth: 1000, cssHeight: 800 };
  return { sim, view };
}

function screenOf(view: IsoView, x: number, y: number, z: number): { x: number; y: number } {
  return worldToScreen(view, simToWorld(x, y, z, new Vector3()));
}

describe("track picker", () => {
  it("picks an existing node within 14 px of where it is drawn", () => {
    const { sim, view } = setup();
    const p = toWorld({ q: 14, r: 20 });
    const s = screenOf(view, p.x, p.y, 3.3);
    const pick = pickTrack(sim.network(), view, s.x + NODE_PICK_RADIUS_PX - 1, s.y, { x: p.x, y: p.y });
    expect(pick?.kind).toBe("node");
    if (pick?.kind === "node") expect([pick.node.q, pick.node.r, pick.node.kind]).toEqual([14, 20, "buffer"]);
  });

  it("picks a piece's centreline within 10 px and reports its nearer end", () => {
    const { sim, view } = setup();
    const a = toWorld({ q: 11, r: 20 });
    // 2.2 m along the piece from (11, 20) and 9 px off it: outside both nodes' 14 px, within the centreline's 10 px.
    const s = screenOf(view, a.x + 2.2, a.y, 3.3);
    const pick = pickTrack(sim.network(), view, s.x, s.y + TRACK_PICK_RADIUS_PX - 1, { x: a.x + 2.2, y: a.y });
    expect(pick?.kind).toBe("piece");
    if (pick?.kind === "piece") expect([pick.node.q, pick.node.r]).toEqual([11, 20]);
  });

  it("measures on screen at the track's height, so elevated track picks where it is drawn", () => {
    const { sim, view } = setup();
    const p = toWorld({ q: 2, r: 40 });
    const drawn = screenOf(view, p.x, p.y, 12.3);
    // The terrain hit under that pixel lies well south of the node's foot; the search radius covers it.
    const pick = pickTrack(sim.network(), view, drawn.x, drawn.y, { x: p.x, y: p.y - 17 });
    expect(pick?.kind).toBe("node");
    if (pick?.kind === "node") expect([pick.node.q, pick.node.r, pick.node.zMm]).toEqual([2, 40, 12_000]);
  });

  it("falls back to the lattice node nearest the terrain hit, and to nothing off the map", () => {
    const { sim, view } = setup();
    const g = toWorld({ q: 30, r: 10 });
    const pick = pickTrack(sim.network(), view, 5, 5, { x: g.x + 0.4, y: g.y - 0.3 });
    expect(pick).toEqual({ kind: "ground", xM: g.x + 0.4, yM: g.y - 0.3, q: 30, r: 10 });
    expect(pickTrack(sim.network(), view, 5, 5, null)).toBeNull();
  });
});
