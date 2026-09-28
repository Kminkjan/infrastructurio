import { describe, expect, it } from "vitest";
import { type Mesh, MeshBasicMaterial, Ray, Vector3 } from "three";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { windingMismatches } from "../../../tests/support/geometry";
import { type Command, type NetworkView, type PieceSpec, type Structure, toWorld } from "../../core/sim/api";
import { createWorld } from "../../core/sim/world";
import { AssetRegistry } from "../art/AssetRegistry";
import { PICK_LAYER, pickMask } from "../picking/layers";
import { waterPlane } from "../terrain/heightfieldRay";
import { computeTerrainShading } from "../terrain/terrainShading";
import { StructureView } from "./StructureView";
import { registerStructureAssets } from "./assets";
import { PIER_TRACK_CLEARANCE_M } from "./dimensions";

/**
 * A valley site: 110 × 70 nodes, ground at 30 m falling to a 12 m valley floor around column 55 (a river
 * below the 10 m water level in its middle), and a hill rising to 45 m in the north-west for a tunnel.
 */
const terrain = makeTerrain(110, 70, (_q, _r, col, row) => {
  const valley = Math.max(0, 1 - Math.abs(col - 55) / 22);
  const river = Math.abs(col - 55) < 3 ? 40 : 0;
  const hill = row > 45 && col < 40 ? Math.max(0, 150 - Math.hypot(col - 20, row - 58) * 12) : 0;
  return 300 - valley * 180 - river + hill;
});
const shading = computeTerrainShading(terrain);
const material = new MeshBasicMaterial();

function straights(q0: number, r: number, count: number, zMm: number, heading: 0 | 2 = 0): PieceSpec[] {
  const [dq, dr] = heading === 0 ? [1, 0] : [0, 1];
  return Array.from({ length: count }, (_, i) => ({ kind: "straight", from: { q: q0 + dq * i, r: r + dr * i, zMm }, heading, z1Mm: zMm }) as const);
}

function setup(options: { clockStepMs?: number; groundM?: (x: number, y: number) => number } = {}) {
  const world = createWorld(terrain);
  const registry = new AssetRegistry();
  registerStructureAssets(registry);
  let t = 0;
  let frames = 0;
  const view = new StructureView({
    terrain,
    registry,
    material,
    plugMaterial: material,
    shading,
    water: waterPlane(terrain, shading.waterDistance),
    requestFrame: () => {
      frames += 1;
    },
    now: () => (t += options.clockStepMs ?? 0),
    ...(options.groundM ? { groundM: options.groundM } : {}),
  });
  const run = (cmd: Command) => {
    const result = world.run(cmd, true);
    expect(result.ok, JSON.stringify(result)).toBe(true);
  };
  const build = (pieces: PieceSpec[], structure: Structure) => run({ type: "build-track", pieces, structure });
  const settle = () => {
    for (let i = 0; i < 100 && (view.sync(world.network() as NetworkView) || view.busy); i++);
    expect(view.stats.appliedRev).toBe(world.network().rev);
  };
  return {
    world,
    view,
    registry,
    run,
    build,
    settle,
    get frames() {
      return frames;
    },
  };
}

/** The viaduct across the valley at 30 m (row 30), with ground approaches, and a tunnel through the hill at 30 m. */
function scene(s: ReturnType<typeof setup>) {
  // Row 30: q = col − 15. Columns 20–90 span the valley.
  s.build(straights(5, 30, 6, 30_000), "ground");
  s.build(straights(11, 30, 64, 30_000), "bridge");
  s.build(straights(75, 30, 6, 30_000), "ground");
  // Row 58: q = col − 29; the hill peaks at column 20.
  s.build(straights(-25, 58, 5, 30_000), "ground");
  s.build(straights(-20, 58, 20, 30_000), "tunnel");
  s.build(straights(0, 58, 5, 30_000), "ground");
}

function meshes(view: StructureView): Mesh[] {
  const out: Mesh[] = [];
  view.group.traverse((o) => {
    if ((o as Mesh).isMesh && (o as Mesh).geometry.getAttribute("position")?.count) out.push(o as Mesh);
  });
  return out;
}

describe("structure view", () => {
  it("builds a bridge run and a tunnel run with portals, hill plugs and pick proxies", () => {
    const s = setup();
    scene(s);
    s.settle();
    const stats = s.view.stats;
    expect(stats.bridges).toBe(1);
    expect(stats.tunnels).toBe(1);
    expect(stats.portals).toBe(2);
    expect(stats.abutments).toBe(2);
    expect(stats.spans.truss).toBeGreaterThanOrEqual(1);
    expect(stats.spans.arch).toBeGreaterThanOrEqual(2);
    expect(stats.piers).toBeGreaterThan(3);
    expect(stats.topZ).toBeGreaterThan(30);
    // One structure mesh per run and a plug per portal; every triangle's winding agrees with its normal.
    const all = meshes(s.view).filter((m) => m.name !== "hill plug" && !m.parent?.name.includes("x-ray") && !m.parent?.name.includes("hidden"));
    expect(all.length).toBeGreaterThanOrEqual(2);
    for (const m of all) expect(windingMismatches(m.geometry)).toBe(0);
    expect(meshes(s.view).filter((m) => m.name === "hill plug")).toHaveLength(2);
    // One proxy per 5 m straight: 64 deck proxies and 20 bore proxies.
    expect(s.view.pickScene.children).toHaveLength(64 + 20);
  });

  it("keeps every pier clear of a track passing under the deck, and spans it with a girder", () => {
    const s = setup();
    scene(s);
    // A track across the valley side under the viaduct: heading 2 from (32, 20), 14 m under the deck where it crosses.
    s.build(straights(32, 20, 16, 16_000, 2), "ground");
    s.settle();
    const bridge = s.view.layouts[0];
    expect(bridge?.layout.spans.some((sp) => sp.overTrack && (sp.type === "girder" || sp.type === "truss"))).toBe(true);
    // Every pier's footprint corner stays at least the clearance from that track's centreline.
    const a = toWorld({ q: 32, r: 20 });
    const b = toWorld({ q: 32, r: 36 });
    let piers = 0;
    for (const p of bridge?.layout.supports ?? []) {
      if (p.kind !== "pier") continue;
      piers += 1;
      for (let k = 0; k < 8; k += 2) {
        const x = p.footprint[k] ?? 0;
        const y = p.footprint[k + 1] ?? 0;
        const d = Math.abs((b.x - a.x) * (a.y - y) - (a.x - x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y);
        expect(d).toBeGreaterThanOrEqual(PIER_TRACK_CLEARANCE_M - 1e-6);
      }
    }
    expect(piers).toBeGreaterThan(3);
  });

  it("slices its rebuild over frames and asks for them, a run at a time past the budget", () => {
    const s = setup({ clockStepMs: 20 });
    scene(s);
    const network = s.world.network() as NetworkView;
    expect(s.view.sync(network)).toBe(true);
    expect(s.view.busy).toBe(true);
    expect(s.frames).toBe(1);
    expect(s.view.stats.appliedRev).toBe(-1);
    s.view.sync(network);
    expect(s.view.busy).toBe(false);
    expect(s.view.stats.appliedRev).toBe(network.rev);
    expect(s.view.stats.lastRebuild.slices).toBe(2);
  });

  it("removes and disposes a run's meshes and proxies on undo, and rebuilds only what changed", () => {
    const s = setup();
    scene(s);
    s.settle();
    const before = meshes(s.view).length;
    s.run({ type: "undo" });
    s.run({ type: "undo" });
    s.run({ type: "undo" });
    s.settle();
    // The tunnel went (its approach ground pieces too); the bridge stayed without being rebuilt.
    expect(s.view.stats.tunnels).toBe(0);
    expect(s.view.stats.lastRebuild.runs).toBe(0);
    expect(meshes(s.view).length).toBeLessThan(before);
    for (let i = 0; i < 3; i++) s.run({ type: "undo" });
    s.settle();
    expect(s.view.stats.bridges).toBe(0);
    expect(s.view.pickScene.children).toHaveLength(0);
    expect(meshes(s.view).filter((m) => !m.parent?.name.includes("x-ray") && !m.parent?.name.includes("hidden"))).toHaveLength(0);
  });

  it("lays a bridge out the same whether built at once or edited toward it", () => {
    const fresh = setup();
    scene(fresh);
    fresh.build(straights(40, 45, 4, 20_000), "ground");
    fresh.settle();
    const edited = setup();
    scene(edited);
    edited.settle();
    edited.build(straights(40, 45, 4, 20_000), "ground");
    edited.settle();
    const spans = (s: ReturnType<typeof setup>) => s.view.layouts.map((l) => l.layout.spans.map((sp) => [sp.a, sp.b, sp.type, sp.riseM]));
    expect(spans(edited)).toEqual(spans(fresh));
  });

  it("hides decks under H and shows tunnels under U, as presentation only", () => {
    const s = setup();
    scene(s);
    s.settle();
    const named = (name: string) => {
      let found: { visible: boolean } | undefined;
      s.view.group.traverse((o) => {
        if (o.name === name) found = o;
      });
      return found;
    };
    expect(named("bridges")?.visible).toBe(true);
    expect(named("hidden decks")?.visible).toBe(false);
    expect(named("tunnel x-ray")?.visible).toBe(false);
    s.view.setDecksHidden(true);
    expect(named("bridges")?.visible).toBe(false);
    expect(named("hidden decks")?.visible).toBe(true);
    s.view.setXray(true);
    expect(named("tunnel x-ray")?.visible).toBe(true);
    // The portals and plugs stay: they are not decks.
    expect(named("tunnels")?.visible).toBe(true);
    s.view.setDecksHidden(false);
    s.view.setXray(false);
    expect(named("bridges")?.visible).toBe(true);
  });

  it("picks decks and bores through the proxies' layers only", () => {
    const s = setup();
    scene(s);
    s.settle();
    const down = new Vector3(0, -1, 0);
    const over = (q: number, r: number) => {
      const p = toWorld({ q, r });
      return new Ray(new Vector3(p.x, 200, -p.y), down);
    };
    // Mid-piece, so one piece's proxy holds the point.
    const deck = s.view.pickProxies(over(40.5, 30), pickMask(PICK_LAYER.DECK));
    expect(deck).toHaveLength(1);
    expect(deck[0]?.zM).toBeCloseTo(30, 6);
    expect(s.view.pickProxies(over(40.5, 30), pickMask(PICK_LAYER.TUNNEL))).toHaveLength(0);
    const bore = s.view.pickProxies(over(-9.5, 58), pickMask(PICK_LAYER.TUNNEL));
    expect(bore).toHaveLength(1);
    expect(s.view.pickProxies(over(-9.5, 58), pickMask(PICK_LAYER.TRACK, PICK_LAYER.DECK))).toHaveLength(0);
  });

  it("raises the ground behind each portal with its hill plug, where picking marches it", () => {
    const s = setup();
    scene(s);
    s.settle();
    // Just inside the west portal (column 9 at row 58 is q −20): the plug stands over the natural hill there.
    const p = toWorld({ q: -19, r: 58 });
    const plug = s.view.plugHeightAt(p.x, p.y);
    expect(plug).toBeGreaterThan(30 + 6);
    expect(Number.isNaN(s.view.plugHeightAt(toWorld({ q: 40, r: 30 }).x, toWorld({ q: 40, r: 30 }).y))).toBe(true);
  });

  it("rebuilds a run whose piers would show once the drawn ground under them falls", () => {
    let cut = false;
    const s = setup({ groundM: (x, y) => (cut ? -1e3 + 0 * (x + y) : Number.NaN) });
    scene(s);
    s.settle();
    expect(s.view.refreshGround()).toBe(false);
    cut = true;
    expect(s.view.refreshGround()).toBe(true);
    s.settle();
    expect(s.view.stats.lastRebuild.runs).toBeGreaterThan(0);
  });

  it("disposes everything", () => {
    const s = setup();
    scene(s);
    s.settle();
    s.view.dispose();
    expect(s.view.group.children).toHaveLength(0);
    expect(s.view.pickScene.children).toHaveLength(0);
    s.registry.dispose();
  });
});

describe("structure rebuild cost on the diorama (a dev measurement, not a gate)", () => {
  it("times the capture sites' runs and 10-piece bridge edits", async ({ annotate }) => {
    const { generateTerrain, DEFAULT_TERRAIN_SIZE } = await import("../../core/sim/api");
    const dio = generateTerrain({ seed: "baltic-diorama", ...DEFAULT_TERRAIN_SIZE });
    const dshading = computeTerrainShading(dio);
    const world = createWorld(dio);
    const registry = new AssetRegistry();
    registerStructureAssets(registry);
    const view = new StructureView({
      terrain: dio,
      registry,
      material,
      plugMaterial: material,
      shading: dshading,
      water: waterPlane(dio, dshading.waterDistance),
      requestFrame: () => undefined,
      now: () => performance.now(),
      budgetMs: 1e9,
    });
    const line = (q: number, r: number, d: 0 | 2 | 4, from: number, to: number, zMm: number): PieceSpec[] => {
      const [dq, dr] = d === 0 ? [1, 0] : d === 2 ? [0, 1] : [-1, 1];
      return Array.from({ length: to - from }, (_, k) => ({ kind: "straight", from: { q: q + dq * (from + k), r: r + dr * (from + k), zMm }, heading: d, z1Mm: zMm }) as const);
    };
    const sites: [string, PieceSpec[]][] = [
      ["viaduct 54 pieces", line(23, 230, 4, 3, 57, 27_000)],
      ["river bridge 27 pieces", line(242, 104, 2, 4, 31, 31_900)],
      ["tunnel 49 pieces", line(40, 180, 2, 8, 57, 17_000)],
    ];
    const results: string[] = [];
    for (const [name, pieces] of sites) {
      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        expect(world.run({ type: "build-track", pieces, structure: name.startsWith("tunnel") ? "tunnel" : "bridge" }, true).ok).toBe(true);
        const t0 = performance.now();
        view.sync(world.network() as NetworkView);
        times.push(performance.now() - t0);
        world.run({ type: "undo" }, true);
        view.sync(world.network() as NetworkView);
      }
      times.sort((a, b) => a - b);
      results.push(`${name}: median ${times[2]?.toFixed(2)} ms, max ${times[4]?.toFixed(2)} ms`);
    }
    // 10-piece bridge edits over the valley: each adds a new run.
    const edits: number[] = [];
    for (let i = 0; i < 20; i++) {
      expect(world.run({ type: "build-track", pieces: line(23, 230, 4, 20 + (i % 3), 30 + (i % 3), 27_000), structure: "bridge" }, true).ok).toBe(true);
      const t0 = performance.now();
      view.sync(world.network() as NetworkView);
      edits.push(performance.now() - t0);
      world.run({ type: "undo" }, true);
      view.sync(world.network() as NetworkView);
    }
    edits.sort((a, b) => a - b);
    results.push(`10-piece bridge edits (20): median ${edits[10]?.toFixed(2)} ms, p95 ${edits[19]?.toFixed(2)} ms`);
    await annotate(results.join("; "));
    console.log(`[structures cost] ${results.join("; ")}`);
    expect(edits[10]).toBeLessThan(200);
    view.dispose();
    registry.dispose();
  });
});
