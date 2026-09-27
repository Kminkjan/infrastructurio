import { describe, expect, it } from "vitest";
import { type BufferGeometry, MeshBasicMaterial } from "three";
import { type Command, type PieceSpec, type TrackPlan, createSim } from "../../core/sim/api";
import { DIORAMA_PARAMS, diorama, groundPlans } from "../../../tests/support/groundPlans";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { type ClearableLayer, SceneryClearance } from "../scenery/clearance";
import { EARTHWORK_ATTRIBUTE } from "../art/shaderChunks/earthwork";
import { EarthworksView, SCENERY_CLEARANCE_M } from "./EarthworksView";
import { TerrainView } from "./TerrainView";
import { chunkCounts } from "./terrainGeometry";

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
  const params = { seed: "ridge", columns: 130, rows: 70 };
  // A hand-shaped terrain for the view, and a sim over a flat seeded map of the same size (its heights do not matter:
  // the pieces carry their own heights, and the view conforms the view's terrain).
  const terrain = makeTerrain(params.columns, params.rows, (_q, _r, col) => 200 + Math.max(0, 60 - Math.abs(col - 64) * 4));
  const sim = createSim({ terrain: params });
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
    expect(s.earthworks.sync(s.sim.network())).toBe(false);
    expect(s.sim.execute(build(s.run)).ok).toBe(true);
    expect(s.earthworks.sync(s.sim.network())).toBe(true);
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
    s.earthworks.sync(s.sim.network());
    expect(s.earthworks.stats).toMatchObject({ appliedRev: 2, pieces: 0, chunksWithEarthworks: 0, refinedTriangles: 0 });
    const restored = snapshotChunks(s.view, s.terrain);
    for (const [key, arrays] of natural) {
      const after = restored.get(key);
      arrays.forEach((a, i) => expect(after?.[i], `${key} array ${i}`).toEqual(a));
    }
    // Redo brings the same earthworks back.
    s.sim.execute({ type: "redo" });
    s.earthworks.sync(s.sim.network());
    expect(s.earthworks.stats.refinedTriangles).toBe(built.refinedTriangles);
  });

  it("time-slices a rebuild at the budget, at least one step per frame", () => {
    const s = ridgeSetup({ budgetMs: 8, clockStepMs: 5 });
    s.sim.execute(build(s.run));
    s.earthworks.sync(s.sim.network());
    expect(s.earthworks.busy).toBe(true);
    expect(s.frames).toBe(1);
    let guard = 0;
    while (s.earthworks.busy && guard++ < 50) s.earthworks.sync(s.sim.network());
    expect(s.earthworks.busy).toBe(false);
    expect(s.earthworks.stats.lastRebuild.slices).toBeGreaterThan(1);
    expect(s.earthworks.stats.appliedRev).toBe(1);
  });

  it("does nothing when disabled (the natural terrain, for before/after checks)", () => {
    const s = ridgeSetup({ enabled: false });
    s.sim.execute(build(s.run));
    expect(s.earthworks.sync(s.sim.network())).toBe(false);
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
    s.earthworks.sync(s.sim.network());
    expect(layer.cleared).toEqual([true, true, true, false]);
    expect(layer.commits).toBeGreaterThan(0);
    expect(s.earthworks.stats.clearedScenery).toBe(3);
    s.sim.execute({ type: "undo" });
    s.earthworks.sync(s.sim.network());
    expect(layer.cleared).toEqual([false, false, false, false]);
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
      earthworks.sync(sim.network());
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
    fresh.sync(network.network());
    const fullMs = clock() - t0;
    const full = fresh.stats;
    // The same with the 8 ms slices the app uses.
    const sliced = new EarthworksView({ terrain, target: view, requestFrame: () => {}, now: clock });
    let frames = 0;
    do {
      sliced.sync(network.network());
      frames += 1;
    } while (sliced.busy && frames < 1000);

    const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
    const p95 = (xs: number[]) => sorted(xs)[Math.floor(0.95 * xs.length)] ?? Number.NaN;
    const median = (xs: number[]) => sorted(xs)[Math.floor(xs.length / 2)] ?? Number.NaN;
    await annotate(`10-piece edits (${edits.length}): rebuild median ${median(edits).toFixed(2)} ms, p95 ${p95(edits).toFixed(2)} ms, max ${Math.max(...edits).toFixed(2)} ms; undo median ${median(undos).toFixed(2)} ms, p95 ${p95(undos).toFixed(2)} ms`);
    await annotate(
      `500-piece network (${network.network().pieces.length} pieces): full rebuild ${fullMs.toFixed(1)} ms over ${full.lastRebuild.chunks} chunk rebuilds (${full.chunksWithEarthworks} with earthworks, ${full.refinedTriangles} refined LOD0 triangles, cut up to ${full.maxCutM.toFixed(2)} m, fill up to ${full.maxFillM.toFixed(2)} m); with 8 ms slices: ${sliced.stats.lastRebuild.slices} frames, longest slice ${sliced.stats.lastRebuild.longestSliceMs.toFixed(2)} ms`,
    );
    expect(full.pieces).toBeGreaterThanOrEqual(500);
    expect(sliced.stats.appliedRev).toBe(network.network().rev);
    view.dispose();
  });
});
