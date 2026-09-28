import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { createSim, toWorld } from "../../core/sim/api";
import { ISO_PITCH_RAD, type IsoView, worldToScreen } from "../camera/isoMath";
import { simToWorld } from "../coords";
import { NODE_PICK_RADIUS_PX, PICK_LIFT_M, TRACK_PICK_RADIUS_PX, pickTrack, pickTrackStack } from "./trackPicker";

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
    const s = screenOf(view, p.x, p.y, 3 + PICK_LIFT_M);
    const pick = pickTrack(sim.network(), view, s.x + NODE_PICK_RADIUS_PX - 1, s.y, { x: p.x, y: p.y });
    expect(pick?.kind).toBe("node");
    if (pick?.kind === "node") expect([pick.node.q, pick.node.r, pick.node.kind]).toEqual([14, 20, "buffer"]);
  });

  it("picks a piece's centreline within 10 px and reports its nearer end", () => {
    const { sim, view } = setup();
    const a = toWorld({ q: 11, r: 20 });
    // 2.2 m along the piece from (11, 20) and 9 px off it: outside both nodes' 14 px, within the centreline's 10 px.
    const s = screenOf(view, a.x + 2.2, a.y, 3 + PICK_LIFT_M);
    const pick = pickTrack(sim.network(), view, s.x, s.y + TRACK_PICK_RADIUS_PX - 1, { x: a.x + 2.2, y: a.y });
    expect(pick?.kind).toBe("piece");
    if (pick?.kind === "piece") expect([pick.node.q, pick.node.r]).toEqual([11, 20]);
  });

  it("measures on screen at the track's height, so elevated track picks where it is drawn", () => {
    const { sim, view } = setup();
    const p = toWorld({ q: 2, r: 40 });
    const drawn = screenOf(view, p.x, p.y, 12 + PICK_LIFT_M);
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

  describe("occlusion aids and stacked hits (D4)", () => {
    /**
     * A ground track east at 3 m along r = 20, a bridge due north (heading 3) over it at 12.192 m through (11, 20),
     * and a tunnel at 3 m along r = 30.
     */
    function crossing() {
      const sim = createSim({ terrain: { seed: "d4-pick", columns: 80, rows: 60 } });
      const east = (q0: number, r: number, n: number, zMm: number) =>
        Array.from({ length: n }, (_, i) => ({ kind: "straight", from: { q: q0 + i, r, zMm }, heading: 0, z1Mm: zMm }) as const);
      const north = Array.from({ length: 8 }, (_, i) => ({ kind: "straight", from: { q: 13 - i, r: 16 + 2 * i, zMm: 12_192 }, heading: 3, z1Mm: 12_192 }) as const);
      for (const [pieces, structure] of [
        [east(8, 20, 8, 3000), "ground"],
        [north, "bridge"],
        [east(8, 30, 6, 3000), "tunnel"],
      ] as const) {
        const r = sim.execute({ type: "build-track", structure, pieces });
        expect(r.ok, JSON.stringify(r)).toBe(true);
      }
      const centre = toWorld({ q: 12, r: 22 });
      const view: IsoView = { target: { x: centre.x, z: -centre.y }, ppm: 8, yaw: 0, pitch: ISO_PITCH_RAD, cssWidth: 1000, cssHeight: 800 };
      return { sim, view };
    }

    it("puts a bridge in front of the track it crosses, and C's next level behind it, then the ground", () => {
      const { sim, view } = crossing();
      const cross = toWorld({ q: 11, r: 20 });
      // The bridge point drawn over the crossing node: 9.192 m higher, so 9.192 / tan(pitch) = 13.0 m south of it,
      // half way between two bridge nodes.
      const southM = 9.192 / Math.tan(ISO_PITCH_RAD);
      const s = screenOf(view, cross.x, cross.y - southM, 12.192 + PICK_LIFT_M);
      const ground = { x: cross.x, y: cross.y - southM - 17 };
      const stack = pickTrackStack(sim.network(), view, s.x, s.y, ground);
      expect(stack.map((p) => p.kind)).toEqual(["piece", "node", "ground"]);
      expect(stack[0]?.kind === "piece" && stack[0].piece.structure).toBe("bridge");
      expect(stack[1]?.kind === "node" && [stack[1].node.q, stack[1].node.r, stack[1].node.zMm]).toEqual([11, 20, 3000]);
      // H hides the deck: the track under it comes first.
      const hidden = pickTrackStack(sim.network(), view, s.x, s.y, ground, { visibility: { decks: false, tunnels: false } });
      expect(hidden.map((p) => p.kind)).toEqual(["node", "ground"]);
    });

    it("picks tunnels only under the underground x-ray", () => {
      const { sim, view } = crossing();
      const p = toWorld({ q: 10, r: 30 });
      const s = screenOf(view, p.x + 2.5, p.y, 3 + PICK_LIFT_M);
      const plain = pickTrack(sim.network(), view, s.x, s.y, { x: p.x + 2.5, y: p.y });
      expect(plain?.kind).toBe("ground");
      const xray = pickTrack(sim.network(), view, s.x, s.y, { x: p.x + 2.5, y: p.y }, { visibility: { decks: true, tunnels: true } });
      expect(xray?.kind).toBe("piece");
      if (xray?.kind === "piece") expect(xray.piece.structure).toBe("tunnel");
    });

    it("takes a deck's proxy hit where no centreline is near (a click on the parapet at Close)", () => {
      const { sim, view } = crossing();
      const bridge = sim.network().pieces.find((p) => p.structure === "bridge" && p.nodes.every((id) => (sim.network().nodes[id]?.r ?? 0) >= 26));
      expect(bridge).toBeDefined();
      const far = toWorld({ q: 40, r: 50 });
      const s = screenOf(view, far.x, far.y, 0);
      const pick = pickTrack(sim.network(), view, s.x, s.y, far, { proxies: [{ key: bridge?.key ?? "", zM: 12 }] });
      expect(pick?.kind).toBe("piece");
      if (pick?.kind === "piece") expect(pick.piece.key).toBe(bridge?.key);
      // Under H the deck's proxy is ignored.
      expect(pickTrack(sim.network(), view, s.x, s.y, far, { proxies: [{ key: bridge?.key ?? "", zM: 12 }], visibility: { decks: false, tunnels: false } })?.kind).toBe("ground");
    });
  });
});
