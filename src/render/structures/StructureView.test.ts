import { describe, expect, it } from "vitest";
import { type Mesh, MeshBasicMaterial, Ray, Vector3 } from "three";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { windingMismatches } from "../../../tests/support/geometry";
import { type Command, type NetworkView, type PieceSpec, type Structure, toWorld } from "../../core/sim/api";
import { createWorld } from "../../core/sim/world";
import { AssetRegistry } from "../art/AssetRegistry";
import { PICK_LAYER, pickMask } from "../picking/layers";
import { EarthworksView } from "../terrain/EarthworksView";
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
  // The earthworks as the app wires them (the drawn ground, the core's effective ground, the other tracks' cuts),
  // unless a test gives its own drawn ground.
  const earthworks = options.groundM ? undefined : new EarthworksView({ terrain, target: { shading, replaceChunk: () => true }, requestFrame: () => {}, now: () => 0, budgetMs: Infinity });
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
    ...(earthworks
      ? {
          groundM: (x: number, y: number) => earthworks.heightfield.heightAtM(x, y),
          effectiveIn: (box: { minX: number; minY: number; maxX: number; maxY: number }) => earthworks.effectiveIn(box),
          cutEnvelopeIn: (box: { minX: number; minY: number; maxX: number; maxY: number }, except: readonly string[]) => earthworks.cutEnvelopeIn(box, except),
          notchBox: (key: string) => earthworks.notchBox(key),
          ground: earthworks.ground,
        }
      : {}),
  });
  const run = (cmd: Command) => {
    const result = world.run(cmd, true);
    expect(result.ok, JSON.stringify(result)).toBe(true);
  };
  const build = (pieces: PieceSpec[], structure: Structure) => run({ type: "build-track", pieces, structure });
  const settle = () => {
    if (earthworks) for (let i = 0; i < 100 && (earthworks.sync(world.network() as NetworkView, world.ground()) || earthworks.busy); i++);
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
  // Row 58: q = col − 29; the hill peaks at column 20 (15 m over the track). The tunnel runs where the cover passes
  // the 8 m band, columns 14–26 (7.8 m at each portal, 9 m or more inside), with cuttings up to 7.8 m deep before it
  // (until the band, owner decision 2026-09-28 "M2", the tunnel ran columns 9–29 and its ends were cuttings' depth).
  s.build(straights(-25, 58, 10, 30_000), "ground");
  s.build(straights(-15, 58, 12, 30_000), "tunnel");
  s.build(straights(-3, 58, 8, 30_000), "ground");
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
    // One proxy per 5 m straight: 64 deck proxies and 12 bore proxies.
    expect(s.view.pickScene.children).toHaveLength(64 + 12);
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
    // Just inside the west portal (column 14 at row 58 is q −15): the plug stands over the natural hill there.
    const p = toWorld({ q: -14, r: 58 });
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

describe("structure view: a tunnel dead end's portal after a later cutting (verification fix, 2026-09-29)", () => {
  // Flat 0 m west of column 30, an 11 m plateau for columns 30–50, 8.8 m for columns 51–90.
  const plateau = makeTerrain(120, 60, (_q, _r, col) => (col < 30 ? 0 : col <= 50 ? 110 : 88), -100);
  const plateauShading = computeTerrainShading(plateau);
  const row = (r: number, col0: number, count: number, zMm: number): PieceSpec[] => straights(col0 - Math.floor(r / 2), r, count, zMm);

  /** An EarthworksView and a StructureView over the world, wired as `src/app/main.ts` wires them. */
  function views() {
    const registry = new AssetRegistry();
    registerStructureAssets(registry);
    const earthworks = new EarthworksView({ terrain: plateau, target: { shading: plateauShading, replaceChunk: () => true }, requestFrame: () => {}, now: () => 0, budgetMs: Infinity });
    const view = new StructureView({
      terrain: plateau,
      registry,
      material,
      plugMaterial: material,
      shading: plateauShading,
      water: waterPlane(plateau, plateauShading.waterDistance),
      requestFrame: () => {},
      now: () => 0,
      groundM: (x: number, y: number) => earthworks.heightfield.heightAtM(x, y),
      effectiveIn: (box: { minX: number; minY: number; maxX: number; maxY: number }) => earthworks.effectiveIn(box),
      cutEnvelopeIn: (box: { minX: number; minY: number; maxX: number; maxY: number }, except: readonly string[]) => earthworks.cutEnvelopeIn(box, except),
      notchBox: (key: string) => earthworks.notchBox(key),
      ground: earthworks.ground,
    });
    return { earthworks, view };
  }

  it("draws the portal a fresh view draws once a cutting 13 m away lowers the ground at the dead end, and after undo", () => {
    const world = createWorld(plateau);
    const run = (cmd: Command) => expect(world.run(cmd, true).ok).toBe(true);
    // The frame order of main.ts: the earthworks, then the structures; refreshGround once the surface lands.
    const settle = (v: ReturnType<typeof views>) => {
      const network = world.network() as NetworkView;
      for (let i = 0; i < 200 && (v.earthworks.sync(network, world.ground()) || v.earthworks.busy); i++);
      for (let i = 0; i < 200 && (v.view.sync(network) || v.view.busy); i++);
      v.view.refreshGround();
      for (let i = 0; i < 200 && (v.view.sync(network) || v.view.busy); i++);
    };
    const fresh = () => {
      const v = views();
      settle(v);
      const portals = v.view.stats.portals;
      v.view.dispose();
      return portals;
    };
    const live = views();
    // Row 20: ground from column 10, then a tunnel into the plateau to a dead end at column 60 under 8.8 m (no portal).
    run({ type: "build-track", pieces: [...row(20, 10, 19, 0), ...row(20, 29, 31, 0)], structure: "auto" });
    settle(live);
    expect(world.network().pieces.filter((p) => p.structure === "tunnel")).toHaveLength(31);
    expect(live.view.stats.portals).toBe(1);
    // Row 23 (13 m north, beyond the 12 m neighbour margin): a cutting at 1.0 m lowers the ground at the dead end
    // under 8 m, so the core counts it a portal. Before, the incremental view kept 1 portal where a fresh one drew 2.
    run({ type: "build-track", pieces: row(23, 52, 28, 1000), structure: "auto" });
    settle(live);
    expect(fresh()).toBe(2);
    expect(live.view.stats.portals).toBe(2);
    run({ type: "undo" });
    settle(live);
    expect(fresh()).toBe(1);
    expect(live.view.stats.portals).toBe(1);
  });

  it("rebuilds from refreshGround when the portal decision moves without a new revision", () => {
    const world = createWorld(plateau);
    const run = (cmd: Command) => expect(world.run(cmd, true).ok).toBe(true);
    const v = views();
    run({ type: "build-track", pieces: [...row(20, 10, 19, 0), ...row(20, 29, 31, 0)], structure: "auto" });
    const tunnel = world.network() as NetworkView;
    for (let i = 0; i < 200 && (v.earthworks.sync(tunnel, world.ground()) || v.earthworks.busy); i++);
    for (let i = 0; i < 200 && (v.view.sync(tunnel) || v.view.busy); i++);
    expect(v.view.refreshGround()).toBe(false);
    run({ type: "build-track", pieces: row(23, 52, 28, 1000), structure: "auto" });
    // The structures sign the revision before the earthworks have landed it (their ground has no cutting yet)...
    const network = world.network() as NetworkView;
    for (let i = 0; i < 200 && (v.view.sync(network) || v.view.busy); i++);
    expect(v.view.stats.portals).toBe(1);
    expect(v.view.refreshGround()).toBe(false);
    // ...then the earthworks land it, and refreshGround finds the dead end now opens to daylight.
    for (let i = 0; i < 200 && (v.earthworks.sync(network, world.ground()) || v.earthworks.busy); i++);
    expect(v.view.refreshGround()).toBe(true);
    for (let i = 0; i < 200 && (v.view.sync(network) || v.view.busy); i++);
    expect(v.view.stats.portals).toBe(2);
    expect(v.view.refreshGround()).toBe(false);
    v.view.dispose();
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
      // Where the cover passes the 8 m band (owner decision 2026-09-28 "M2"): until then nodes 8–57, whose ends lie
      // under 4.7–7.7 m, a cutting's depth now.
      ["tunnel 43 pieces", line(40, 180, 2, 12, 55, 17_000)],
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

  it("draws no crease beyond the wing ends of a diorama portal, the terrain and plugs wired as the app wires them (D4 portal wedges)", async () => {
    // The shortest east–west two-portal tunnel (the 2026-09-29 verification's "ew75"), Straight (227, 138) → (259, 138),
    // where the old rule's 45° headwall beyond the wing ends drew a lit parallelogram, a dark triangle and teeth. On
    // the drawn surface (the plug where it draws, else the terrain mesh), sampled at the 1.25 m sub-lattice's vertices,
    // the largest change of gradient across an edge inside a 5 m lattice triangle (where the natural ground is planar)
    // behind the portal plane and beyond the wing ends (9.5–17 m across).
    const { diorama, toolStartMm } = await import("../../../tests/support/groundPlans");
    const { nearestNode } = await import("../../core/sim/api");
    const { terrain: dio } = diorama();
    const dshading = computeTerrainShading(dio);
    const world = createWorld(dio);
    const registry = new AssetRegistry();
    registerStructureAssets(registry);
    const earthworks = new EarthworksView({ terrain: dio, target: { shading: dshading, replaceChunk: () => true }, requestFrame: () => {}, now: () => 0, budgetMs: Infinity });
    const view = new StructureView({
      terrain: dio,
      registry,
      material,
      plugMaterial: material,
      shading: dshading,
      water: waterPlane(dio, dshading.waterDistance),
      requestFrame: () => undefined,
      now: () => 0,
      budgetMs: 1e9,
      groundM: (x: number, y: number) => earthworks.heightfield.heightAtM(x, y),
      effectiveIn: (box: { minX: number; minY: number; maxX: number; maxY: number }) => earthworks.effectiveIn(box),
      cutEnvelopeIn: (box: { minX: number; minY: number; maxX: number; maxY: number }, except: readonly string[]) => earthworks.cutEnvelopeIn(box, except),
      attributeIn: (box: { minX: number; minY: number; maxX: number; maxY: number }) => earthworks.attributeIn(box),
      notchBox: (key: string) => earthworks.notchBox(key),
      ground: earthworks.ground,
    });
    const w = toWorld({ q: 259, r: 138 });
    const zMm = toolStartMm(dio, { q: 227, r: 138 });
    const end = nearestNode({ x: w.x, y: w.y });
    const drag = { from: { q: 227, r: 138, zMm }, to: { xMm: Math.round(w.x * 1000), yMm: Math.round(w.y * 1000) }, dzMm: (world.groundMm(end.q, end.r) ?? zMm) - zMm, magnetism: true, heightMode: "straight" } as const;
    let plan = world.plan(drag);
    if (plan.end && !plan.snapped) plan = world.plan({ ...drag, dzMm: (world.groundMm(plan.end.node.q, plan.end.node.r) ?? zMm) - zMm });
    expect(world.run({ type: "build-track", pieces: plan.pieces, structure: "auto" }, true).ok).toBe(true);
    for (let i = 0; i < 100 && (earthworks.sync(world.network() as NetworkView, world.ground()) || earthworks.busy); i++);
    for (let i = 0; i < 100 && (view.sync(world.network() as NetworkView) || view.busy); i++);
    const outlines = view.portalOutlines;
    expect(outlines).toHaveLength(2);
    const sub = 1.25;
    const row = sub * (Math.sqrt(3) / 2);
    const shown = (qs: number, rs: number): number => {
      const x = sub * (qs + rs / 2);
      const y = row * rs;
      const p = view.plugHeightAt(x, y);
      return Number.isNaN(p) ? earthworks.heightfield.heightAtM(x, y) : p;
    };
    const gradient = (tri: readonly (readonly [number, number])[]): [number, number] => {
      const [a, b, c] = tri.map(([qs, rs]) => [sub * (qs + rs / 2), row * rs, shown(qs, rs)] as const);
      if (!a || !b || !c) return [0, 0];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const det = ux * vy - uy * vx;
      return [(uz * vy - uy * vz) / det, (ux * vz - uz * vx) / det];
    };
    const mod4 = (v: number) => ((v % 4) + 4) % 4;
    let worst = 0;
    let worstBack = 0;
    let edges = 0;
    for (const { frame: f } of outlines) {
      for (let rs = Math.floor((f.y - 20) / row); rs <= Math.ceil((f.y + 20) / row); rs++) {
        for (let qs = Math.floor((f.x - 20) / sub - rs / 2); qs <= Math.ceil((f.x + 20) / sub - rs / 2); qs++) {
          const cx = sub * (qs + 1 / 3 + (rs + 1 / 3) / 2);
          const cy = row * (rs + 1 / 3);
          const ss = (cx - f.x) * f.tx + (cy - f.y) * f.ty;
          const u = Math.abs((cx - f.x) * f.ty - (cy - f.y) * f.tx);
          if (ss < 0.05 || ss > 9 || u < 9.5 || u > 17) continue;
          // A down triangle and its three neighbours across edges inside the lattice triangle.
          const g = gradient([[qs, rs], [qs + 1, rs], [qs, rs + 1]]);
          const across: [readonly (readonly [number, number])[], boolean][] = [
            [[[qs + 1, rs], [qs + 1, rs + 1], [qs, rs + 1]], mod4(qs + rs + 1) !== 0],
            [[[qs + 1, rs - 1], [qs + 1, rs], [qs, rs]], mod4(rs) !== 0],
            [[[qs, rs], [qs, rs + 1], [qs - 1, rs + 1]], mod4(qs) !== 0],
          ];
          for (const [tri, inside] of across) {
            if (!inside) continue;
            const h = gradient(tri);
            edges += 1;
            const j = Math.hypot(g[0] - h[0], g[1] - h[1]);
            if (j > worst) worst = j;
            if (ss >= 2 && j > worstBack) worstBack = j;
          }
        }
      }
    }
    expect(edges).toBeGreaterThan(200);
    // Measured 2026-09-29: 1.18 at 2ae19ab, the V along the valley at every depth; 0.74 since, where the smooth
    // maximum's band is still narrow near the plane, and 0.63 from 2 m behind it. (Tightened from 0.85 by the
    // verification fixes: 0.744 with the band's reach-edge weight read only where a piece's envelopes can change the
    // band, 0.805 had it given way near every piece's reach edge, the approach's own too.)
    expect(worst).toBeLessThan(0.78);
    expect(worstBack).toBeLessThan(0.7);
    view.dispose();
    registry.dispose();
  });

  it("ends every diorama plug on the drawn terrain along its open outline, and its bank soon past the end piers, wired as the app wires them", async () => {
    // Verification of the D4 portal wedges (2026-09-29, automated probe and agent captures): at 8c7dca9 the open
    // outline stood off the drawn terrain about 9 m behind the plane beyond the wing ends (ew75 west 0.182 m, xslope
    // 0.061 m, ewhill west 0.174 m: a seam vertex on the effective ground as the core computes it, over a terrain mesh
    // that sags under the rounded end by its linear error), and the bank beyond a wing's end pier was cut off at the
    // plug's region box (ew75 west 0.468 m, the dead end 0.663 m). The outline's edges (those one plug triangle uses),
    // sampled at their ends and quarter points, away from the masonry (within 0.7 m of a wall's line), against the
    // terrain mesh.
    const { diorama, toolStartMm } = await import("../../../tests/support/groundPlans");
    const { nearestNode } = await import("../../core/sim/api");
    const { behindFront, openFrontOrigin, underMasonry } = await import("./portalOutline");
    const { PORTAL_WING_SPLAY_COS, PORTAL_WING_SPLAY_SIN } = await import("./dimensions");
    const { terrain: dio } = diorama();
    const dshading = computeTerrainShading(dio);
    const registry = new AssetRegistry();
    registerStructureAssets(registry);
    const worstBy: Record<string, number> = {};
    const pastBy: Record<string, number> = {};
    for (const [name, from, to] of [
      ["ew75", [227, 138], [259, 138]],
      ["xslope", [247, 130], [223, 142]],
      ["ewhill", [254, 129], [302, 129]],
      ["deadend", [220, 140], [236, 140]],
    ] as const) {
      const world = createWorld(dio);
      const earthworks = new EarthworksView({ terrain: dio, target: { shading: dshading, replaceChunk: () => true }, requestFrame: () => {}, now: () => 0, budgetMs: Infinity });
      const view = new StructureView({
        terrain: dio,
        registry,
        material,
        plugMaterial: material,
        shading: dshading,
        water: waterPlane(dio, dshading.waterDistance),
        requestFrame: () => undefined,
        now: () => 0,
        budgetMs: 1e9,
        groundM: (x: number, y: number) => earthworks.heightfield.heightAtM(x, y),
        effectiveIn: (box: { minX: number; minY: number; maxX: number; maxY: number }) => earthworks.effectiveIn(box),
        cutEnvelopeIn: (box: { minX: number; minY: number; maxX: number; maxY: number }, except: readonly string[]) => earthworks.cutEnvelopeIn(box, except),
        attributeIn: (box: { minX: number; minY: number; maxX: number; maxY: number }) => earthworks.attributeIn(box),
        notchBox: (key: string) => earthworks.notchBox(key),
        ground: earthworks.ground,
      });
      // The Straight line as the tool plans it (planned once more for the ground at the plan's end node).
      const w = toWorld({ q: to[0], r: to[1] });
      const zMm = toolStartMm(dio, { q: from[0], r: from[1] });
      const end = nearestNode({ x: w.x, y: w.y });
      const drag = { from: { q: from[0], r: from[1], zMm }, to: { xMm: Math.round(w.x * 1000), yMm: Math.round(w.y * 1000) }, dzMm: (world.groundMm(end.q, end.r) ?? zMm) - zMm, magnetism: true, heightMode: "straight" } as const;
      let plan = world.plan(drag);
      if (plan.end && !plan.snapped) plan = world.plan({ ...drag, dzMm: (world.groundMm(plan.end.node.q, plan.end.node.r) ?? zMm) - zMm });
      expect(world.run({ type: "build-track", pieces: plan.pieces, structure: "auto" }, true).ok).toBe(true);
      for (let i = 0; i < 100 && (earthworks.sync(world.network() as NetworkView, world.ground()) || earthworks.busy); i++);
      for (let i = 0; i < 100 && (view.sync(world.network() as NetworkView) || view.busy); i++);
      const outlines = view.portalOutlines;
      expect(outlines.length, name).toBeGreaterThan(0);
      const nearMasonry = (x: number, y: number): boolean =>
        outlines.some(({ frame: f, wings }) => {
          const s = (x - f.x) * f.tx + (y - f.y) * f.ty;
          const u = (x - f.x) * f.ty - (y - f.y) * f.tx;
          for (let ds = -0.7; ds <= 0.701; ds += 0.1) {
            for (let du = -0.7; du <= 0.701; du += 0.1) {
              if (Math.hypot(ds, du) <= 0.7 && Math.abs(behindFront(s + ds, u + du)) < 0.05 && underMasonry(s + ds, u + du, wings)) return true;
            }
          }
          return false;
        });
      let worst = 0;
      let samples = 0;
      view.group.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || mesh.name !== "hill plug") return;
        const pos = mesh.geometry.getAttribute("position");
        const key = (i: number) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
        const edges = new Map<string, { n: number; a: number; b: number }>();
        for (let t = 0; t < pos.count / 3; t++) {
          for (let e = 0; e < 3; e++) {
            const a = 3 * t + e;
            const b = 3 * t + ((e + 1) % 3);
            const k = [key(a), key(b)].sort().join("|");
            const g = edges.get(k);
            if (g) g.n += 1;
            else edges.set(k, { n: 1, a, b });
          }
        }
        for (const e of edges.values()) {
          if (e.n !== 1) continue;
          for (const f of [0, 0.25, 0.5, 0.75, 1]) {
            const x = pos.getX(e.a) + (pos.getX(e.b) - pos.getX(e.a)) * f;
            const y = -(pos.getZ(e.a) + (pos.getZ(e.b) - pos.getZ(e.a)) * f);
            const z = pos.getY(e.a) + (pos.getY(e.b) - pos.getY(e.a)) * f;
            if (nearMasonry(x, y)) continue;
            samples += 1;
            worst = Math.max(worst, z - earthworks.heightfield.heightAtM(x, y));
          }
        }
      });
      expect(samples, name).toBeGreaterThan(200);
      worstBy[name] = Math.round(worst * 1000) / 1000;
      // Past each wing's end pier the backfill's bank comes down to the ground within a few metres along the wing line:
      // at 8c7dca9 it stood more than 0.1 m over the terrain 7.0–7.8 m past a pier at these four portals, a lit sliver
      // down the approach's embankment at yaws 4 and 5 (ew75 west, the dead end).
      let past = 0;
      for (const { frame: f, wings } of outlines) {
        for (const side of [1, -1] as const) {
          const o = openFrontOrigin(side, side === 1 ? wings.right : wings.left, { s: 0, u: 0 });
          for (let along = 0; along <= 14; along += 0.1) {
            for (let off = 0; off <= 3; off += 0.1) {
              const s = o.s - PORTAL_WING_SPLAY_SIN * along + PORTAL_WING_SPLAY_COS * off;
              const u = o.u + side * (PORTAL_WING_SPLAY_COS * along + PORTAL_WING_SPLAY_SIN * off);
              const x = f.x + f.tx * s + f.ty * u;
              const y = f.y + f.ty * s - f.tx * u;
              const h = view.plugHeightAt(x, y);
              if (!Number.isNaN(h) && h - earthworks.heightfield.heightAtM(x, y) > 0.1) past = Math.max(past, along);
            }
          }
        }
      }
      pastBy[name] = Math.round(past * 10) / 10;
      view.dispose();
    }
    // Measured 2026-09-29 (automated): 0.009, 0.011, 0.002 and 0.000 m (ew75, xslope, ewhill, dead end); at 8c7dca9
    // 0.468, 0.194, 0.268 and 0.663 m. The bank past the piers: 0.5, 0.7, 2.4 and 0.8 m (7.8, 7.3, 7.5 and 7.0 m).
    for (const [name, worst] of Object.entries(worstBy)) expect(worst, name).toBeLessThan(0.02);
    for (const [name, past] of Object.entries(pastBy)) expect(past, name).toBeLessThan(3);
    registry.dispose();
  });

  it("times tunnel edits with their approach cuttings, the earthworks and structures wired as the app wires them", async ({ annotate }) => {
    // Verification finding (2026-09-29): the forced 43-piece tunnel above wires no earthworks, so it hid what a tunnel
    // edit costs in the app (the plugs read the earthworks' effective ground, cut envelopes and notch boxes, and the
    // earthworks evaluate a second envelope behind tunnel planes). Straight lines as the tool plans them: the e2e hill
    // (254, 129) → (302, 129) and scene B (220, 140) → (236, 140).
    const { diorama, toolStartMm } = await import("../../../tests/support/groundPlans");
    const { nearestNode } = await import("../../core/sim/api");
    const { terrain: dio } = diorama();
    const dshading = computeTerrainShading(dio);
    const world = createWorld(dio);
    const registry = new AssetRegistry();
    registerStructureAssets(registry);
    const clock = () => performance.now();
    const earthworks = new EarthworksView({ terrain: dio, target: { shading: dshading, replaceChunk: () => true }, requestFrame: () => {}, now: clock, budgetMs: Infinity });
    const view = new StructureView({
      terrain: dio,
      registry,
      material,
      plugMaterial: material,
      shading: dshading,
      water: waterPlane(dio, dshading.waterDistance),
      requestFrame: () => undefined,
      now: clock,
      budgetMs: 1e9,
      groundM: (x: number, y: number) => earthworks.heightfield.heightAtM(x, y),
      effectiveIn: (box: { minX: number; minY: number; maxX: number; maxY: number }) => earthworks.effectiveIn(box),
      cutEnvelopeIn: (box: { minX: number; minY: number; maxX: number; maxY: number }, except: readonly string[]) => earthworks.cutEnvelopeIn(box, except),
      attributeIn: (box: { minX: number; minY: number; maxX: number; maxY: number }) => earthworks.attributeIn(box),
      notchBox: (key: string) => earthworks.notchBox(key),
      ground: earthworks.ground,
    });
    const sync = (): [number, number] => {
      const network = world.network() as NetworkView;
      const t0 = clock();
      earthworks.sync(network, world.ground());
      const t1 = clock();
      view.sync(network);
      return [t1 - t0, clock() - t1];
    };
    const results: string[] = [];
    for (const [name, a, b] of [
      ["hill", [254, 129], [302, 129]],
      ["scene B", [220, 140], [236, 140]],
    ] as const) {
      // The Straight line tool's plan: the end asked at the ground there, planned once more at the plan's own end.
      const w = toWorld({ q: b[0], r: b[1] });
      const zMm = toolStartMm(dio, { q: a[0], r: a[1] });
      const end = nearestNode({ x: w.x, y: w.y });
      const drag = { from: { q: a[0], r: a[1], zMm }, to: { xMm: Math.round(w.x * 1000), yMm: Math.round(w.y * 1000) }, dzMm: (world.groundMm(end.q, end.r) ?? zMm) - zMm, magnetism: true, heightMode: "straight" } as const;
      let plan = world.plan(drag);
      if (plan.end && !plan.snapped) plan = world.plan({ ...drag, dzMm: (world.groundMm(plan.end.node.q, plan.end.node.r) ?? zMm) - zMm });
      const ew: number[] = [];
      const sv: number[] = [];
      let kinds = "";
      for (let i = 0; i < 7; i++) {
        const result = world.run({ type: "build-track", pieces: plan.pieces, structure: "auto" }, true);
        expect(result.ok).toBe(true);
        if (result.ok) kinds = result.diff.added.map((r) => r.structure[0]).join("");
        const [e, s] = sync();
        if (i > 0) {
          ew.push(e);
          sv.push(s);
        }
        world.run({ type: "undo" }, true);
        sync();
      }
      expect(kinds).toContain("t");
      ew.sort((x, y) => x - y);
      sv.sort((x, y) => x - y);
      results.push(`${name} (${kinds.length} pieces, ${kinds.split("t").length - 1} tunnel): earthworks median ${ew[3]?.toFixed(2)} ms, max ${ew[5]?.toFixed(2)} ms; structures median ${sv[3]?.toFixed(2)} ms, max ${sv[5]?.toFixed(2)} ms`);
    }
    await annotate(results.join("; "));
    console.log(`[tunnel edit cost, wired] ${results.join("; ")}`);
    view.dispose();
    registry.dispose();
  });
});
