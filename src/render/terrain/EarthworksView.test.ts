import { describe, expect, it } from "vitest";
import { type BufferGeometry, MeshBasicMaterial } from "three";
import { type Command, type PieceSpec, type TrackPlan, createSim } from "../../core/sim/api";
import { DIORAMA_PARAMS, diorama, groundPlans } from "../../../tests/support/groundPlans";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { simOn } from "../../../tests/support/simOn";
import { steepestDrawnFace } from "../../../tests/support/drawnFaces";
import { type ClearableLayer, SceneryClearance } from "../scenery/clearance";
import { EARTHWORK_ATTRIBUTE, EARTHWORK_ITEM_SIZE } from "../art/shaderChunks/earthwork";
import { type EarthworkChunkTarget, EarthworksView, PORTAL_SCENERY_CLEARANCE_M, SCENERY_CLEARANCE_M } from "./EarthworksView";
import { TerrainView } from "./TerrainView";
import { SIDE_SLOPE_RUN } from "./earthworks";
import type { EarthworkMeshData } from "./earthworkMesh";
import { buildChunkData, chunkCounts } from "./terrainGeometry";
import { type TerrainShading, computeTerrainShading } from "./terrainShading";

const material = new MeshBasicMaterial();

function build(pieces: readonly PieceSpec[]): Command {
  return { type: "build-track", pieces, structure: "auto" };
}

/** Every chunk geometry's arrays, to compare against the natural terrain byte for byte. */
function snapshotChunks(view: TerrainView, t: { columns: number; rows: number }): Map<string, Float32Array[]> {
  const out = new Map<string, Float32Array[]>();
  const counts = chunkCounts(t);
  for (const lod of [0, 1] as const) {
    for (let y = 0; y < counts.y; y++) {
      for (let x = 0; x < counts.x; x++) {
        const g = view.chunkMesh(x, y, lod)?.geometry as BufferGeometry | undefined;
        if (!g) continue;
        const arrays = ["position", "normal", "color", EARTHWORK_ATTRIBUTE].map((name) => Float32Array.from(g.getAttribute(name).array as ArrayLike<number>));
        arrays.push(Float32Array.from(g.getIndex()?.array ?? []));
        out.set(`${lod}:${x},${y}`, arrays);
      }
    }
  }
  return out;
}

/** A ridge across a small map with a run cut through it: 130 × 70 nodes (3 × 2 chunks at LOD0). */
function ridgeSetup(options: { budgetMs?: number; clockStepMs?: number; enabled?: boolean; scenery?: SceneryClearance } = {}) {
  const params = { columns: 130, rows: 70 };
  // A hand-shaped terrain for the view and the sim (until D4 the sim ran on a seeded map of the same size, since its
  // heights did not matter; D4's rules judge each piece against the terrain). The run cuts 6 m through the ridge's
  // crest, a cutting within the ±8 m band (owner decision 2026-09-28 "M2"; at ±4 m it was a tunnel).
  const terrain = makeTerrain(params.columns, params.rows, (_q, _r, col) => 200 + Math.max(0, 60 - Math.abs(col - 64) * 4));
  const sim = simOn(terrain);
  const view = new TerrainView(terrain, material, material);
  let t = 0;
  let frames = 0;
  const earthworks = new EarthworksView({
    terrain,
    target: view,
    requestFrame: () => {
      frames += 1;
    },
    now: () => (t += options.clockStepMs ?? 0),
    ...(options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs }),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
    ...(options.scenery === undefined ? {} : { scenery: options.scenery }),
  });
  const run = Array.from({ length: 30 }, (_, i) => ({ kind: "straight", from: { q: 35 + i, r: 30, zMm: 20_000 }, heading: 0, z1Mm: 20_000 }) as const);
  return {
    terrain,
    sim,
    view,
    earthworks,
    run,
    get frames() {
      return frames;
    },
  };
}

/** A chunk target that keeps the mesh data it was last given per chunk (no three.js), to compare views cheaply. */
class RecordingTarget implements EarthworkChunkTarget {
  readonly chunks = new Map<string, EarthworkMeshData>();
  constructor(readonly shading: TerrainShading) {}
  replaceChunk(x: number, y: number, lod: 0 | 1, data: EarthworkMeshData): boolean {
    this.chunks.set(`${lod}:${x},${y}`, data);
    return true;
  }
}

/** Whether two chunk meshes hold the same bytes (positions, normals, colours, earthwork attribute, indices). */
function sameMesh(a: EarthworkMeshData, b: EarthworkMeshData): boolean {
  const bytes = (v: ArrayBufferView) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return [
    [a.positions, b.positions],
    [a.normals, b.normals],
    [a.colors, b.colors],
    [a.earthwork, b.earthwork],
    [Uint32Array.from(a.indices), Uint32Array.from(b.indices)],
  ].every(([x, y]) => {
    const p = bytes(x as ArrayBufferView);
    const q = bytes(y as ArrayBufferView);
    return p.length === q.length && p.every((v, k) => v === q[k]);
  });
}

/** A plain array of positions standing in for a scenery layer. */
class FakeLayer implements ClearableLayer {
  readonly cleared: boolean[];
  commits = 0;
  constructor(readonly points: readonly { x: number; y: number }[]) {
    this.cleared = points.map(() => false);
  }
  get clearableCount(): number {
    return this.points.length;
  }
  clearablePosition(i: number, out: { x: number; y: number }): void {
    out.x = this.points[i]?.x ?? 0;
    out.y = this.points[i]?.y ?? 0;
  }
  setCleared(i: number, cleared: boolean): boolean {
    if (this.cleared[i] === cleared) return false;
    this.cleared[i] = cleared;
    return true;
  }
  isCleared(i: number): boolean {
    return this.cleared[i] === true;
  }
  commitCleared(): void {
    this.commits += 1;
  }
}

describe("earthworks view", () => {
  it("conforms the chunks a build touches, and undo gives back the natural terrain exactly", () => {
    const s = ridgeSetup();
    const natural = snapshotChunks(s.view, s.terrain);
    expect(s.earthworks.sync(s.sim.network(), s.sim.ground())).toBe(false);
    expect(s.sim.execute(build(s.run)).ok).toBe(true);
    expect(s.earthworks.sync(s.sim.network(), s.sim.ground())).toBe(true);
    const built = s.earthworks.stats;
    expect(built).toMatchObject({ appliedRev: 1, pieces: 30, pendingChunks: 0 });
    expect(built.chunksWithEarthworks).toBeGreaterThanOrEqual(2);
    expect(built.refinedTriangles).toBeGreaterThan(0);
    expect(built.maxCutM).toBeGreaterThan(5);
    // The run cuts through the ridge: the drawn surface on it sits at the track height, 6 m under the crest.
    // Row 30 is even, so column 64 (the crest) lies at x = 320 m; the run spans x = 250–400 m.
    const y = 30 * 2.5 * Math.sqrt(3);
    const x = 320;
    expect(s.earthworks.heightfield.naturalAtM(x, y)).toBeCloseTo(26, 1);
    expect(s.earthworks.heightfield.heightAtM(x, y)).toBeCloseTo(20, 5);
    const changed = [...snapshotChunks(s.view, s.terrain)].filter(([key, arrays]) => arrays.some((a, i) => a.length !== natural.get(key)?.[i]?.length || a.some((v, j) => v !== natural.get(key)?.[i]?.[j])));
    expect(changed.length).toBe(built.chunksWithEarthworks);

    s.sim.execute({ type: "undo" });
    s.earthworks.sync(s.sim.network(), s.sim.ground());
    expect(s.earthworks.stats).toMatchObject({ appliedRev: 2, pieces: 0, chunksWithEarthworks: 0, refinedTriangles: 0 });
    const restored = snapshotChunks(s.view, s.terrain);
    for (const [key, arrays] of natural) {
      const after = restored.get(key);
      arrays.forEach((a, i) => expect(after?.[i], `${key} array ${i}`).toEqual(a));
    }
    // Redo brings the same earthworks back.
    s.sim.execute({ type: "redo" });
    s.earthworks.sync(s.sim.network(), s.sim.ground());
    expect(s.earthworks.stats.refinedTriangles).toBe(built.refinedTriangles);
  });

  it("equals a fresh view over builds, undos and redos beside higher tracks, whose reaches depend on each other", () => {
    // PR #83 re-review: a piece's reach now depends on its neighbours' beds, so an edit must re-derive the pieces
    // beside it (and an undo lower them again). Flat ground at 20 m; a run on row 30 at 20 m, one 3 rows north at
    // 26 m, one 3 rows south at 14 m, and a 60° run at 23 m north of them.
    // The runs lie within the ±8 m band, so all are ground (owner decision 2026-09-28 "M2"; at ±4 m the 26 m and
    // 14 m runs were a bridge and a tunnel). The sim judges the view's terrain (until D4 a seeded map).
    const params = { columns: 130, rows: 70 };
    const terrain = makeTerrain(params.columns, params.rows, () => 200);
    const sim = simOn(terrain);
    const shading = computeTerrainShading(terrain);
    const view = new RecordingTarget(shading);
    const earthworks = new EarthworksView({ terrain, target: view, requestFrame: () => {}, now: () => 0, budgetMs: Infinity });
    // What a chunk draws without earthworks: its plain mesh with a zero attribute (what `buildEarthworkChunk` gives).
    const natural = new Map<string, EarthworkMeshData>();
    const naturalOf = (key: string): EarthworkMeshData => {
      let m = natural.get(key);
      if (!m) {
        const [lod, x, y] = key.split(/[:,]/).map(Number) as [0 | 1, number, number];
        const plain = buildChunkData(terrain, shading, x, y, lod);
        m = { ...plain, earthwork: new Float32Array((plain.positions.length / 3) * EARTHWORK_ITEM_SIZE) };
        natural.set(key, m);
      }
      return m;
    };
    const run = (r: number, zMm: number, q0: number, n: number, heading: 0 | 2 = 0): PieceSpec[] =>
      Array.from({ length: n }, (_, i): PieceSpec => ({ kind: "straight", from: { q: q0 + (heading === 0 ? i : 0), r: r + (heading === 2 ? i : 0), zMm }, heading, z1Mm: zMm }));
    const a = run(30, 20_000, 30, 20);
    const steps: Command[] = [
      build(a),
      build(run(33, 26_000, 29, 20)),
      build(run(27, 14_000, 32, 20)),
      build(run(36, 23_000, 40, 12, 2)),
      { type: "undo" },
      { type: "undo" },
      { type: "redo" },
      { type: "undo" },
      { type: "undo" },
      { type: "redo" },
      { type: "redo" },
      { type: "redo" },
      { type: "undo" },
      { type: "undo" },
      { type: "undo" },
      { type: "undo" },
    ];
    const probe = sim.network();
    expect(probe.pieces).toHaveLength(0);
    const aKey = (() => {
      sim.execute(build(a.slice(0, 1)));
      const key = sim.network().pieces[0]?.key ?? "";
      sim.execute({ type: "undo" });
      return key;
    })();
    const reachesOfA: number[] = [];
    for (const [i, step] of steps.entries()) {
      expect(sim.execute(step).ok, `step ${i}`).toBe(true);
      earthworks.sync(sim.network(), sim.ground());
      expect(earthworks.busy).toBe(false);
      const freshView = new RecordingTarget(shading);
      const fresh = new EarthworksView({ terrain, target: freshView, requestFrame: () => {}, now: () => 0, budgetMs: Infinity });
      // The fresh view derives the pieces from the whole network (`earthworkPieces`); the first reads the core's incremental ones.
      fresh.sync(sim.network());
      for (const p of sim.network().pieces) expect(earthworks.reachOf(p.key), `step ${i} reach of ${p.key}`).toEqual(fresh.reachOf(p.key));
      // Every chunk either view has drawn: the same bytes (a chunk a view never drew is its natural chunk).
      for (const key of new Set([...view.chunks.keys(), ...freshView.chunks.keys()])) {
        expect(sameMesh(view.chunks.get(key) ?? naturalOf(key), freshView.chunks.get(key) ?? naturalOf(key)), `step ${i}, chunk ${key}`).toBe(true);
      }
      for (const lod of [0, 1] as const) {
        const f = lod === 0 ? fresh.heightfield : fresh.heightfieldLod1;
        const g = lod === 0 ? earthworks.heightfield : earthworks.heightfieldLod1;
        expect([...g.triangles.keys()].sort((x, y) => x - y), `step ${i} LOD${lod} refined ids`).toEqual([...f.triangles.keys()].sort((x, y) => x - y));
        for (const [id, heights] of f.triangles) expect(g.triangles.get(id), `step ${i} LOD${lod} triangle ${id}`).toEqual(heights);
        const face = steepestDrawnFace(g);
        expect(face.slope, `step ${i} LOD${lod}: steepest face at (${face.x.toFixed(1)}, ${face.y.toFixed(1)})`).toBeLessThan((1 / SIDE_SLOPE_RUN) * 1.15);
      }
      reachesOfA.push(earthworks.reachOf(aKey)?.[0] ?? Number.NaN);
    }
    // The first run's reach grows beside the higher run and returns to its natural reach once that is undone.
    expect(reachesOfA[1]).toBeGreaterThan(reachesOfA[0] ?? Infinity);
    expect(reachesOfA[8]).toBe(reachesOfA[0]);
    expect(reachesOfA[9]).toBe(reachesOfA[1]);
    expect(reachesOfA[14]).toBe(reachesOfA[0]);
    expect(earthworks.stats).toMatchObject({ pieces: 0, chunksWithEarthworks: 0, refinedTriangles: 0 });
  });

  it("time-slices a rebuild at the budget, at least one step per frame", () => {
    const s = ridgeSetup({ budgetMs: 8, clockStepMs: 5 });
    s.sim.execute(build(s.run));
    s.earthworks.sync(s.sim.network(), s.sim.ground());
    expect(s.earthworks.busy).toBe(true);
    expect(s.frames).toBe(1);
    let guard = 0;
    while (s.earthworks.busy && guard++ < 50) s.earthworks.sync(s.sim.network(), s.sim.ground());
    expect(s.earthworks.busy).toBe(false);
    expect(s.earthworks.stats.lastRebuild.slices).toBeGreaterThan(1);
    expect(s.earthworks.stats.appliedRev).toBe(1);
  });

  it("spreads a chunk too big for one slice over frames, drawing the same bytes (a run capped at 120 m)", async ({ annotate }) => {
    // PR #83 re-review: a 20-piece run 90 m over flat ground reached the 120 m cap, and one chunk's pass took 13.6 ms,
    // over the 8 ms slice, with its mesh on top. Each step now yields between pieces, resolve blocks and mesh rows.
    // Since D4 ground track stays within ±8 m of the terrain, so the capped reach comes from a cut instead: a run on
    // 20 m land 43 m south of a 120 m plateau (rows 90 on), whose 1 : 1.5 cut slope cannot daylight within 120 m.
    const params = { columns: 200, rows: 160 };
    const terrain = makeTerrain(params.columns, params.rows, (_q, r) => (r >= 90 ? 1200 : 200));
    const sim = simOn(terrain);
    const run: PieceSpec[] = Array.from({ length: 20 }, (_, i) => ({ kind: "straight", from: { q: 60 + i, r: 80, zMm: 20_000 }, heading: 0, z1Mm: 20_000 }));
    expect(sim.execute(build(run)).ok).toBe(true);
    const whole = new TerrainView(terrain, material, material);
    const once = new EarthworksView({ terrain, target: whole, requestFrame: () => {}, now: () => 0, budgetMs: Infinity });
    once.sync(sim.network(), sim.ground());
    const steps = once.stats.lastRebuild.chunks;
    // A clock that advances 1 ms per reading: each 8 ms slice does at most eight slices of work.
    let clock = 0;
    const sliced = new TerrainView(terrain, material, material);
    const earthworks = new EarthworksView({ terrain, target: sliced, requestFrame: () => {}, now: () => (clock += 1), budgetMs: 8 });
    let frames = 0;
    while (frames++ < 5000 && (earthworks.sync(sim.network(), sim.ground()) || earthworks.busy));
    expect(earthworks.busy).toBe(false);
    expect(earthworks.stats.lastRebuild.slices).toBeGreaterThan(2 * steps);
    const a = snapshotChunks(whole, terrain);
    for (const [key, arrays] of snapshotChunks(sliced, terrain)) arrays.forEach((arr, k) => expect(a.get(key)?.[k], `${key} array ${k}`).toEqual(arr));
    expect([...earthworks.heightfield.triangles.keys()]).toEqual([...once.heightfield.triangles.keys()]);
    // The same on the wall clock, with the app's 8 ms budget (a dev measurement: the load of the machine shows).
    const wall = new TerrainView(terrain, material, material);
    const timed = new EarthworksView({ terrain, target: wall, requestFrame: () => {}, now: () => performance.now() });
    let wallFrames = 0;
    while (wallFrames++ < 5000 && (timed.sync(sim.network(), sim.ground()) || timed.busy));
    const r = timed.stats.lastRebuild;
    await annotate(`capped 20-piece run: ${steps} steps, ${r.slices} slices of 8 ms, longest ${r.longestSliceMs.toFixed(2)} ms, total ${r.totalMs.toFixed(1)} ms`);
    for (const v of [whole, sliced, wall]) v.dispose();
  });

  it("does nothing when disabled (the natural terrain, for before/after checks)", () => {
    const s = ridgeSetup({ enabled: false });
    s.sim.execute(build(s.run));
    expect(s.earthworks.sync(s.sim.network(), s.sim.ground())).toBe(false);
    expect(s.earthworks.stats.chunksWithEarthworks).toBe(0);
  });

  it("clears scenery on the formation and where the ground moved, and brings it back on undo", () => {
    const y0 = 30 * 2.5 * Math.sqrt(3);
    const points = [
      // The run spans x = 250–400 m along row 30; the ridge's crest is at x = 320 m.
      { x: 280, y: y0 }, // on the track
      { x: 280, y: y0 + SCENERY_CLEARANCE_M - 0.5 }, // on the formation's margin
      { x: 320, y: y0 + 9 }, // on the cut face through the ridge (2 m of cut there)
      { x: 280, y: y0 + 40 }, // well clear
    ];
    const layer = new FakeLayer(points);
    const terrain = makeTerrain(130, 70, (_q, _r, col) => 200 + Math.max(0, 60 - Math.abs(col - 64) * 4));
    const s = ridgeSetup({ scenery: new SceneryClearance(terrain, [layer]) });
    s.sim.execute(build(s.run));
    s.earthworks.sync(s.sim.network(), s.sim.ground());
    expect(layer.cleared).toEqual([true, true, true, false]);
    expect(layer.commits).toBeGreaterThan(0);
    expect(s.earthworks.stats.clearedScenery).toBe(3);
    s.sim.execute({ type: "undo" });
    s.earthworks.sync(s.sim.network(), s.sim.ground());
    expect(layer.cleared).toEqual([false, false, false, false]);
  });

  it("never conforms bridges or tunnels clear of the ground, but clears scenery under a bridge and around a portal (D4)", () => {
    const y0 = 30 * 2.5 * Math.sqrt(3);
    const points = [
      { x: 280, y: y0 }, // on the run
      { x: 280, y: y0 + SCENERY_CLEARANCE_M - 0.5 }, // beside it
      { x: 320, y: y0 + 9 }, // on the ridge, off the corridor
      { x: 250 - 4, y: y0 }, // just beyond the run's west end (a portal, when it is a tunnel)
      { x: 250 - PORTAL_SCENERY_CLEARANCE_M - 1, y: y0 + 3 }, // beyond the portal's reach
    ];
    const terrain = makeTerrain(130, 70, (_q, _r, col) => 200 + Math.max(0, 60 - Math.abs(col - 64) * 4));
    // The same plan as a bridge 1 m over the ridge's 26 m crest, and as a tunnel 9 m under the 20 m land (15 m under
    // the crest). Until D4's rules both lay at 20 m, a deck under the ridge and a tunnel no deeper than a cutting.
    for (const [structure, zMm] of [
      ["bridge", 27_000],
      ["tunnel", 11_000],
    ] as const) {
      const layer = new FakeLayer(points);
      const s = ridgeSetup({ scenery: new SceneryClearance(terrain, [layer]) });
      const natural = snapshotChunks(s.view, s.terrain);
      const pieces = s.run.map((p) => ({ ...p, from: { ...p.from, zMm }, z1Mm: zMm }));
      const built = s.sim.execute({ type: "build-track", pieces, structure });
      expect(built.ok, JSON.stringify(built)).toBe(true);
      s.earthworks.sync(s.sim.network(), s.sim.ground());
      expect(s.earthworks.stats).toMatchObject({ pieces: 0, chunksWithEarthworks: 0, refinedTriangles: 0 });
      const after = snapshotChunks(s.view, s.terrain);
      for (const [key, arrays] of natural) arrays.forEach((a, i) => expect(after.get(key)?.[i], `${structure} ${key}`).toEqual(a));
      // A bridge clears its corridor (4 m past its end is where its abutment stands); a tunnel only the ground around
      // its portals (both ends open to daylight here).
      expect(layer.cleared, structure).toEqual(structure === "bridge" ? [true, true, false, true, false] : [false, false, false, true, false]);
      s.sim.execute({ type: "undo" });
      s.earthworks.sync(s.sim.network(), s.sim.ground());
      expect(layer.cleared.every((c) => !c)).toBe(true);
    }
  });

  it("cuts the ground down to a bridge deck set into the bank, and never raises it under a bridge (D4, M2)", () => {
    // A deck at 25 m along the ridge's run: 5 m over the 20 m land, 1 m under the 26 m crest (x = 320 m). Its nodes
    // on the ridge are abutments (within the ±8 m band), so the dip is allowed (owner decision 2026-09-28 "M2").
    const s = ridgeSetup();
    const natural = snapshotChunks(s.view, s.terrain);
    const pieces = s.run.map((p) => ({ ...p, from: { ...p.from, zMm: 25_000 }, z1Mm: 25_000 }));
    const built = s.sim.execute({ type: "build-track", pieces, structure: "bridge" });
    expect(built.ok, JSON.stringify(built)).toBe(true);
    s.earthworks.sync(s.sim.network(), s.sim.ground());
    // Only the pieces near the crest take the cut: the rest of the deck stands clear of the ground.
    const taken = s.earthworks.stats.pieces;
    expect(taken).toBeGreaterThan(0);
    expect(taken).toBeLessThan(pieces.length);
    const y = 30 * 2.5 * Math.sqrt(3);
    const f = s.earthworks.heightfield;
    expect(f.naturalAtM(320, y)).toBeCloseTo(26, 1);
    expect(f.heightAtM(320, y)).toBeCloseTo(25, 5);
    // Never a fill under a bridge: the drawn ground lies at or under the natural ground everywhere near the run, and
    // under the deck (plus the smooth clamp's band) along it.
    let cut = 0;
    for (let x = 240; x <= 410; x += 0.7) {
      for (let dy = -20; dy <= 20; dy += 0.7) {
        const drawn = f.heightAtM(x, y + dy);
        expect(drawn).toBeLessThanOrEqual(f.naturalAtM(x, y + dy) + 1e-4);
        if (Math.abs(dy) <= 1) expect(drawn).toBeLessThanOrEqual(25 + 1e-4);
        if (f.naturalAtM(x, y + dy) - drawn > 0.1) cut += 1;
      }
    }
    expect(cut).toBeGreaterThan(0);
    // Undo gives back the natural terrain exactly.
    s.sim.execute({ type: "undo" });
    s.earthworks.sync(s.sim.network(), s.sim.ground());
    const restored = snapshotChunks(s.view, s.terrain);
    for (const [key, arrays] of natural) arrays.forEach((a, i) => expect(restored.get(key)?.[i], key).toEqual(a));
  });

  it("measures the rebuild of 10-piece edits and of a 500-piece network on the diorama (a dev measurement)", async ({ annotate }) => {
    const { terrain } = diorama();
    const view = new TerrainView(terrain, material, material);
    const clock = () => performance.now();
    const sim = createSim({ terrain: DIORAMA_PARAMS });
    const earthworks = new EarthworksView({ terrain, target: view, requestFrame: () => {}, now: clock, budgetMs: Infinity });
    const plans = groundPlans(400, "earthworks-edit-probe");

    // 10-piece edits (plans of 8–12 pieces), each built on an empty network and undone.
    const edits: number[] = [];
    const undos: number[] = [];
    const time = () => {
      const t0 = clock();
      earthworks.sync(sim.network(), sim.ground());
      return clock() - t0;
    };
    for (const plan of plans.filter((p) => p.pieces.length >= 8 && p.pieces.length <= 12).slice(0, 40)) {
      if (!sim.execute(build(plan.pieces)).ok) continue;
      edits.push(time());
      sim.execute({ type: "undo" });
      undos.push(time());
    }
    expect(earthworks.stats.chunksWithEarthworks).toBe(0);

    // A 500-piece network: plans executed in order, the ones the validator rejects skipped.
    const network = createSim({ terrain: DIORAMA_PARAMS });
    let pieces = 0;
    for (const plan of groundPlans(2000, "earthworks-network-probe") as TrackPlan[]) {
      if (pieces >= 500) break;
      if (network.execute(build(plan.pieces)).ok) pieces = network.network().pieces.length;
    }
    const fresh = new EarthworksView({ terrain, target: view, requestFrame: () => {}, now: clock, budgetMs: Infinity });
    const t0 = clock();
    fresh.sync(network.network(), network.ground());
    const fullMs = clock() - t0;
    const full = fresh.stats;
    // The same with the 8 ms slices the app uses.
    const sliced = new EarthworksView({ terrain, target: view, requestFrame: () => {}, now: clock });
    let frames = 0;
    do {
      sliced.sync(network.network(), network.ground());
      frames += 1;
    } while (sliced.busy && frames < 1000);

    const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
    const p95 = (xs: number[]) => sorted(xs)[Math.floor(0.95 * xs.length)] ?? Number.NaN;
    const median = (xs: number[]) => sorted(xs)[Math.floor(xs.length / 2)] ?? Number.NaN;
    await annotate(`10-piece edits (${edits.length}): rebuild median ${median(edits).toFixed(2)} ms, p95 ${p95(edits).toFixed(2)} ms, max ${Math.max(...edits).toFixed(2)} ms; undo median ${median(undos).toFixed(2)} ms, p95 ${p95(undos).toFixed(2)} ms`);
    await annotate(
      `500-piece network (${network.network().pieces.length} pieces, ${full.pieces} with earthworks): full rebuild ${fullMs.toFixed(1)} ms over ${full.lastRebuild.chunks} chunk rebuilds (${full.chunksWithEarthworks} with earthworks, ${full.refinedTriangles} refined LOD0 triangles, cut up to ${full.maxCutM.toFixed(2)} m, fill up to ${full.maxFillM.toFixed(2)} m); with 8 ms slices: ${sliced.stats.lastRebuild.slices} frames, longest slice ${sliced.stats.lastRebuild.longestSliceMs.toFixed(2)} ms`,
    );
    // Since D4 some of the network's pieces are bridges and tunnels, which the conform leaves alone (432 of 500 ground
    // at the D4 core lane, before the owner decision 2026-09-28 "M2").
    expect(network.network().pieces.length).toBeGreaterThanOrEqual(500);
    expect(full.pieces).toBeGreaterThan(400);
    expect(sliced.stats.appliedRev).toBe(network.network().rev);
    view.dispose();
  });
});
