import { describe, expect, it } from "vitest";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { forAll } from "../../../tests/support/forall";
import { type Command, type NetworkView, type PieceSpec, type Structure, toWorld } from "../../core/sim/api";
import { createWorld } from "../../core/sim/world";
import { CUTWATER_M, PIER_HALF_WIDTH_M, PIER_THICKNESS_M, PIER_TRACK_CLEARANCE_M } from "./dimensions";
import { type LayoutEnv, layoutBridge } from "./layout";
import { RunPath } from "./runPath";
import { type StructureRun, isPortalEnd, structureRuns } from "./runs";

/**
 * Flat dry land at 20 m, with a 30 m hill on rows 8–12 from q = 25 east and a 35 m one on rows 28–32 from q = 35 east
 * for the tunnels: since D4 a tunnel must lie deeper than a cutting (8 m, owner decision 2026-09-28 "M2").
 */
const terrain = makeTerrain(90, 60, (q, r) => (r >= 8 && r <= 12 && q >= 25 ? 300 : r >= 28 && r <= 32 && q >= 35 ? 350 : 200));

function world() {
  return createWorld(terrain);
}

/** Straights east (heading 0) from (q0, r) over `count` nodes at height zMm. */
function straights(q0: number, r: number, count: number, zMm: number): PieceSpec[] {
  return Array.from({ length: count }, (_, i) => ({ kind: "straight", from: { q: q0 + i, r, zMm }, heading: 0, z1Mm: zMm }) as const);
}

function build(pieces: readonly PieceSpec[], structure: Structure): Command {
  return { type: "build-track", pieces, structure };
}

function execute(w: ReturnType<typeof world>, cmd: Command): void {
  const result = w.run(cmd, true);
  expect(result.ok, JSON.stringify(result)).toBe(true);
}

describe("structure runs", () => {
  it("groups a chain's bridge and tunnel pieces into runs and names what lies beyond each end", () => {
    const w = world();
    // On row 10, the tunnel under the 30 m hill (10 m of cover) from its foot at q = 24.
    execute(w, build(straights(10, 10, 5, 20_000), "ground"));
    execute(w, build(straights(15, 10, 6, 20_000), "bridge"));
    execute(w, build(straights(21, 10, 3, 20_000), "ground"));
    execute(w, build(straights(24, 10, 4, 20_000), "tunnel"));
    const runs = structureRuns(w.network() as NetworkView);
    expect(runs.map((r) => [r.structure, r.pieces.length, r.ends])).toEqual([
      ["bridge", 6, ["ground", "ground"]],
      ["tunnel", 4, ["ground", "buffer"]],
    ]);
    const bridge = runs[0] as StructureRun;
    // Travel order runs from one end to the other, whichever way the section is walked.
    const qs = bridge.pieces.map((p) => (p.forward ? p.piece.nodes[0] : p.piece.nodes[1]));
    const nodes = w.network().nodes;
    const order = qs.map((id) => nodes[id]?.q);
    expect(order).toEqual([...order].sort((a, b) => (order[0] === 15 ? (a ?? 0) - (b ?? 0) : (b ?? 0) - (a ?? 0))));
    expect(bridge.key.startsWith("bridge:")).toBe(true);
    // A tunnel end at a buffer opens to daylight only under less than 12 m of ground (here: 10 m).
    const tunnel = runs[1] as StructureRun;
    expect([isPortalEnd(terrain, tunnel, 0), isPortalEnd(terrain, tunnel, 1)]).toEqual([true, true]);
    expect(isPortalEnd(terrain, bridge, 0)).toBe(false);
  });

  it("opens no portal at a deep dead end, and treats a closed loop of one structure as endless", () => {
    const w = world();
    // Level into the 35 m hill from its foot at q = 34 (until D4 it fell 15 m in 15 m, which the 35‰ rule rejects).
    execute(w, build(straights(30, 30, 4, 20_000), "ground"));
    execute(w, build(straights(34, 30, 4, 20_000), "tunnel"));
    const run = structureRuns(w.network() as NetworkView)[0] as StructureRun;
    expect(run.ends).toEqual(["ground", "buffer"]);
    // The buffer lies 15 m under the 35 m hill: a dead end inside it.
    expect([isPortalEnd(terrain, run, 0), isPortalEnd(terrain, run, 1)]).toEqual([true, false]);
  });
});

describe("run path", () => {
  it("follows a straight run east, with right to the south and signed offsets", () => {
    const w = world();
    // 2 m over the 20 m ground (until D4 at 12 m, a deck under the ground, which D4 rejects).
    execute(w, build(straights(15, 20, 4, 22_000), "bridge"));
    const run = structureRuns(w.network() as NetworkView)[0] as StructureRun;
    const path = RunPath.ofRun(run.pieces);
    expect(path.lengthM).toBeCloseTo(20, 9);
    const start = toWorld(run.nodes[0]);
    const p = path.toSim(0, 3, 1, { x: 0, y: 0, z: 0 });
    const eastward = run.nodes[0].q === 15;
    expect(p.z).toBeCloseTo(23, 9);
    expect(p.x).toBeCloseTo(start.x, 9);
    expect(p.y).toBeCloseTo(start.y + (eastward ? -3 : 3), 9);
    const near = path.nearest(start.x + (eastward ? 7 : -7), start.y - 2, { s: 0, d: 0 });
    expect(near.s).toBeCloseTo(7, 9);
    expect(near.d).toBeCloseTo(eastward ? 2 : -2, 9);
    // Beyond the ends the path runs straight on.
    const beyond = path.at(-2, { x: 0, y: 0, z: 0, tx: 0, ty: 0 });
    expect(Math.hypot(beyond.x - start.x, beyond.y - start.y)).toBeCloseTo(2, 9);
  });

  it("follows a curve with exact end tangents", () => {
    const w = world();
    const curve: PieceSpec = { kind: "curve", from: { q: 20, r: 20, zMm: 22_000 }, heading: 0, turn: 1, radiusM: 60, variant: 0, z1Mm: 22_000 };
    execute(w, build([curve], "bridge"));
    const run = structureRuns(w.network() as NetworkView)[0] as StructureRun;
    const path = RunPath.ofRun(run.pieces);
    const piece = run.pieces[0]?.piece;
    expect(path.lengthM).toBeCloseTo((piece?.lengthMm ?? 0) / 1000, 1);
    const a = path.at(0, { x: 0, y: 0, z: 0, tx: 0, ty: 0 });
    const b = path.at(path.lengthM, { x: 0, y: 0, z: 0, tx: 0, ty: 0 });
    // Walked forward the run leaves east (0°) and ends heading 30°; walked back it leaves at −150° and ends at 180°.
    const deg = (tx: number, ty: number) => Math.round((Math.atan2(ty, tx) * 180) / Math.PI);
    const ends = [deg(a.tx, a.ty), deg(b.tx, b.ty)];
    expect(run.pieces[0]?.forward ? ends : ends.map((d) => (d === -180 ? 180 : d))).toEqual(run.pieces[0]?.forward ? [0, 30] : [-150, 180]);
    expect(Math.hypot(a.tx, a.ty)).toBeCloseTo(1, 9);
  });
});

/** A level east–west path of `lengthM` at height z, as a bridge run over a synthetic site. */
function levelPath(lengthM: number, z = 20): { path: RunPath; x0: number; y0: number } {
  const w = world();
  const n = Math.round(lengthM / 5);
  execute(w, build(straights(10, 20, n, z * 1000), "bridge"));
  const run = structureRuns(w.network() as NetworkView)[0] as StructureRun;
  const path = RunPath.ofRun(run.pieces);
  const s0 = path.at(0, { x: 0, y: 0, z: 0, tx: 0, ty: 0 });
  return { path, x0: s0.x, y0: s0.y };
}

function env(groundBelow: (s: number) => number, path: RunPath, options: { wet?: (s: number) => boolean; others?: number[] } = {}): LayoutEnv {
  const near = { s: 0, d: 0 };
  return {
    groundM: (x, y) => {
      path.nearest(x, y, near);
      const p = path.at(near.s, { x: 0, y: 0, z: 0, tx: 0, ty: 0 });
      return p.z - groundBelow(near.s);
    },
    wetAt: (x, y) => options.wet?.(path.nearest(x, y, near).s) ?? false,
    waterLevelM: 12,
    others: Float64Array.from(options.others ?? []),
  };
}

/** Samples every 0.5 m of a straight other track from (x0, y0) to (x1, y1) at height z. */
function otherTrack(x0: number, y0: number, x1: number, y1: number, z: number): number[] {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.5);
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, z);
  return out;
}

/** Least plan distance from a pier's footprint rectangle to any sample of the other tracks (0 when one lies inside it). */
function footprintClearance(footprint: Float64Array, others: readonly number[]): number {
  const xs = [0, 2, 4, 6].map((i) => footprint[i] ?? 0);
  const ys = [1, 3, 5, 7].map((i) => footprint[i] ?? 0);
  let best = Infinity;
  for (let k = 0; k + 2 < others.length; k += 3) {
    const px = others[k] ?? 0;
    const py = others[k + 1] ?? 0;
    let insideAll = true;
    let d = Infinity;
    for (let i = 0; i < 4; i++) {
      const ax = xs[i] ?? 0;
      const ay = ys[i] ?? 0;
      const bx = xs[(i + 1) % 4] ?? 0;
      const by = ys[(i + 1) % 4] ?? 0;
      const ex = bx - ax;
      const ey = by - ay;
      const len2 = ex * ex + ey * ey;
      const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / len2));
      d = Math.min(d, Math.hypot(px - ax - ex * t, py - ay - ey * t));
      const cross = ex * (py - ay) - ey * (px - ax);
      if (cross < 0) insideAll = false;
    }
    best = Math.min(best, insideAll ? 0 : d);
  }
  return best;
}

describe("the structure-choice rule", () => {
  it("builds a stone arch viaduct over land 4–20 m below, in spans of 8–16 m between masonry piers", () => {
    const { path } = levelPath(100);
    const layout = layoutBridge(path, ["ground", "ground"], env(() => 12, path));
    expect(layout.spans.every((s) => s.type === "arch" && s.rule === "land")).toBe(true);
    for (const s of layout.spans) {
      expect(s.b - s.a).toBeGreaterThanOrEqual(8);
      expect(s.b - s.a).toBeLessThanOrEqual(16);
      // Semicircular where it fits: the rise is half the opening, in whole decimetres.
      expect(s.riseM).toBeCloseTo(Math.floor(((s.b - s.a - PIER_THICKNESS_M) / 2) * 10) / 10, 9);
    }
    expect(layout.supports.map((s) => s.kind)).toEqual(["abutment", ...Array(layout.spans.length - 1).fill("pier"), "abutment"]);
    // A pier's top meets its arches' springings.
    for (const [i, p] of layout.supports.entries()) {
      if (p.kind !== "pier") continue;
      const left = layout.spans[i - 1];
      const right = layout.spans[i];
      expect(p.topV).toBeCloseTo(Math.max(-1.1 - (left?.riseM ?? 0), -1.1 - (right?.riseM ?? 0)), 9);
      expect(p.footZ).toBeCloseTo(20 - 12 - 1.2, 6);
    }
  });

  it("spans water with a steel Warren truss on dry bank piers, with viaduct approaches", () => {
    const { path } = levelPath(120);
    const wet = (s: number) => s > 45 && s < 75;
    const layout = layoutBridge(path, ["ground", "ground"], env((s) => (wet(s) ? 14 : 10), path, { wet }));
    const water = layout.spans.filter((s) => s.overWater);
    expect(water).toHaveLength(1);
    expect(water[0]?.type).toBe("truss");
    expect(water[0]?.rule).toBe("water");
    expect(water[0]?.a).toBeLessThanOrEqual(45);
    expect(water[0]?.b).toBeGreaterThanOrEqual(75);
    expect(layout.spans.filter((s) => !s.overWater).every((s) => s.type === "arch")).toBe(true);
    for (const p of layout.supports) if (p.kind === "pier") expect(p.wet).toBe(false);
  });

  it("puts river piers in wide water, with cutwaters", () => {
    const { path } = levelPath(200);
    const wet = (s: number) => s > 20 && s < 180;
    const layout = layoutBridge(path, ["ground", "ground"], env(() => 14, path, { wet }));
    const trusses = layout.spans.filter((s) => s.type === "truss");
    expect(trusses.length).toBeGreaterThanOrEqual(3);
    for (const t of trusses) expect(t.b - t.a).toBeLessThanOrEqual(64 + 1e-9);
    expect(layout.supports.some((p) => p.kind === "pier" && p.wet)).toBe(true);
  });

  it("crosses another track with a plate-girder span whose piers stand clear of it", () => {
    const { path, x0, y0 } = levelPath(90);
    const track = otherTrack(x0 + 45, y0 - 40, x0 + 45, y0 + 40, 12);
    const layout = layoutBridge(path, ["ground", "ground"], env(() => 8, path, { others: track }));
    const over = layout.spans.filter((s) => s.overTrack);
    expect(over).toHaveLength(1);
    expect(over[0]?.type).toBe("girder");
    expect(over[0]?.rule).toBe("over-track");
    for (const p of layout.supports) if (p.kind === "pier") expect(footprintClearance(p.footprint, track)).toBeGreaterThanOrEqual(PIER_TRACK_CLEARANCE_M - 1e-6);
  });

  it("makes a clear span over 30 m a truss, even over track", () => {
    const { path, x0, y0 } = levelPath(90);
    // Five tracks under the deck, 7 m apart: no pier fits between them, so one span clears them all.
    const others = [0, 7, 14, 21, 28].flatMap((dx) => otherTrack(x0 + 33 + dx, y0 - 40, x0 + 33 + dx, y0 + 40, 12));
    const layout = layoutBridge(path, ["ground", "ground"], env(() => 8, path, { others }));
    const over = layout.spans.filter((s) => s.overTrack);
    expect(over).toHaveLength(1);
    expect(over[0]?.type).toBe("truss");
    expect(over[0]?.rule).toBe("long-span");
    expect((over[0]?.b ?? 0) - (over[0]?.a ?? 0)).toBeGreaterThan(30);
  });

  it("carries a deck over 20 m above land on trusses between tall masonry piers", () => {
    const { path } = levelPath(160, 40);
    const layout = layoutBridge(path, ["ground", "ground"], env(() => 26, path));
    // Spans near 40 m match rule 2 (over 30 m) before rule 4 (over 20 m high); both make trusses.
    expect(layout.spans.every((s) => s.type === "truss" && (s.rule === "long-span" || s.rule === "tall"))).toBe(true);
    expect(layout.supports.filter((p) => p.kind === "pier").length).toBeGreaterThanOrEqual(2);
  });

  it("flattens low arches and closes a deck near the ground into a solid wall", () => {
    const { path } = levelPath(60);
    const low = layoutBridge(path, ["ground", "ground"], env(() => 4.5, path));
    for (const s of low.spans) {
      expect(s.type).toBe("arch");
      expect(s.riseM).toBeGreaterThan(0);
      expect(s.riseM).toBeLessThan((s.b - s.a - PIER_THICKNESS_M) / 2);
    }
    const ground = layoutBridge(path, ["buffer", "buffer"], env(() => 0.8, path));
    expect(ground.spans.every((s) => s.type === "arch" && s.riseM === 0 && s.solidDepthM > 0.8)).toBe(true);
  });

  it("never stands a pier on or beside another track (property, 150 random crossings)", () => {
    forAll(
      { seed: "pier clearance", runs: 150 },
      (prng) => {
        const angle = (20 + prng.nextInt(141)) * (Math.PI / 180);
        const at = 15 + prng.nextInt(90);
        const offset = prng.nextInt(9) - 4;
        return { angle, at, offset, wet: prng.nextInt(3) === 0 };
      },
      ({ angle, at, offset, wet }) => {
        const { path, x0, y0 } = levelPath(120);
        const cx = x0 + at;
        const cy = y0 + offset;
        const track = otherTrack(cx - 60 * Math.cos(angle), cy - 60 * Math.sin(angle), cx + 60 * Math.cos(angle), cy + 60 * Math.sin(angle), 11);
        const layout = layoutBridge(path, ["ground", "ground"], env(() => 9, path, { others: track, ...(wet ? { wet: (s: number) => s > at - 12 && s < at + 12 } : {}) }));
        for (const p of layout.supports) if (p.kind === "pier") expect(footprintClearance(p.footprint, track)).toBeGreaterThanOrEqual(PIER_TRACK_CLEARANCE_M - 1e-6);
        expect(layout.spans.some((s) => s.overTrack)).toBe(true);
      },
    );
  });

  it("widens a water pier's footprint by its cutwaters", () => {
    const { path } = levelPath(200);
    const layout = layoutBridge(path, ["ground", "ground"], env(() => 14, path, { wet: (s) => s > 20 && s < 180 }));
    const pier = layout.supports.find((p) => p.kind === "pier" && p.wet);
    const f = pier?.footprint ?? new Float64Array(8);
    const across = Math.hypot((f[4] ?? 0) - (f[2] ?? 0), (f[5] ?? 0) - (f[3] ?? 0));
    expect(across).toBeCloseTo(2 * (PIER_HALF_WIDTH_M + CUTWATER_M), 6);
  });
});
