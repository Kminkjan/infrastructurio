import { describe, expect, it } from "vitest";
import { BatchedMesh, type Group } from "three";
import { type PieceSpec, createSim } from "../../core/sim/api";
import { createArtUniforms, createTrackMaterials } from "../art/materials";
import { TrackView } from "./TrackView";

const bounds = { minX: 0, minZ: -500, maxX: 2000, maxZ: 0 };

function straights(q0: number, r: number, n: number): PieceSpec[] {
  return Array.from({ length: n }, (_, i) => ({ kind: "straight", from: { q: q0 + i, r, zMm: 0 }, heading: 0, z1Mm: 0 }) as const);
}

function setup(multiDraw: boolean, clockStepMs = 0, budgetMs?: number) {
  const sim = createSim({ terrain: { seed: "d3-track-view", columns: 360, rows: 40 } });
  const materials = createTrackMaterials(createArtUniforms(bounds));
  let t = 0;
  let frames = 0;
  const view = new TrackView({
    materials,
    multiDraw,
    requestFrame: () => {
      frames += 1;
    },
    now: () => (t += clockStepMs),
    ...(budgetMs === undefined ? {} : { budgetMs }),
  });
  return {
    sim,
    materials,
    view,
    get frames() {
      return frames;
    },
  };
}

function layer(view: TrackView, name: string): BatchedMesh | Group | undefined {
  return view.group.children.find((c) => c.name === name) as BatchedMesh | Group | undefined;
}

describe("track view", () => {
  for (const multiDraw of [true, false]) {
    const kind = multiDraw ? "batched" : "chunked";

    it(`applies network revisions by piece key (${kind})`, () => {
      const t = setup(multiDraw);
      expect(t.view.sync(t.sim.network())).toBe(false);
      t.sim.execute({ type: "build-track", pieces: straights(10, 5, 8), structure: "auto" });
      expect(t.view.sync(t.sim.network())).toBe(true);
      expect(t.view.stats).toMatchObject({ pieces: 8, pending: 0, appliedRev: 1, batch: kind });
      // Nothing changed: a revision compare only.
      expect(t.view.sync(t.sim.network())).toBe(false);
      t.sim.execute({ type: "build-track", pieces: straights(18, 5, 4), structure: "auto" });
      t.view.sync(t.sim.network());
      expect(t.view.stats.pieces).toBe(12);
      t.sim.execute({ type: "undo" });
      t.sim.execute({ type: "undo" });
      expect(t.view.sync(t.sim.network())).toBe(true);
      expect(t.view.stats.pieces).toBe(0);
      const ballast = layer(t.view, "track ballast");
      if (ballast instanceof BatchedMesh) {
        expect(ballast.instanceCount).toBe(0);
        expect(ballast.visible).toBe(false);
      } else {
        expect(ballast?.children.length).toBe(0);
      }
      t.view.dispose();
      t.materials.dispose();
    });
  }

  it("grows the batch past its first buffers and instance slots", () => {
    const t = setup(true);
    t.sim.execute({ type: "build-track", pieces: straights(10, 5, 320), structure: "auto" });
    t.view.sync(t.sim.network());
    const sleepers = layer(t.view, "track sleepers");
    expect(sleepers).toBeInstanceOf(BatchedMesh);
    if (sleepers instanceof BatchedMesh) {
      expect(sleepers.instanceCount).toBe(320);
      expect(sleepers.maxInstanceCount).toBeGreaterThanOrEqual(320);
      expect(sleepers.boundingSphere?.radius).toBeGreaterThan(700);
    }
    t.view.dispose();
  });

  it("time-slices a rebuild that passes its 8 ms budget and asks for frames until done", () => {
    // Each clock read advances 3 ms: a slice builds three pieces, then yields.
    const t = setup(true, 3);
    t.sim.execute({ type: "build-track", pieces: straights(10, 5, 10), structure: "auto" });
    t.view.sync(t.sim.network());
    expect(t.view.stats.pieces).toBe(3);
    expect(t.view.busy).toBe(true);
    expect(t.frames).toBe(1);
    let guard = 0;
    while (t.view.busy && guard++ < 20) t.view.sync(t.sim.network());
    expect(t.view.stats).toMatchObject({ pieces: 10, pending: 0, appliedRev: 1, lastRebuildSlices: 4 });
    expect(t.frames).toBe(3);
    t.view.dispose();
  });

  it("hides sleepers and shows the ballast stripe below 4 ppm", () => {
    const t = setup(true);
    t.view.setLod(6);
    expect(t.view.currentLod).toBe("near");
    t.view.setLod(3);
    expect(layer(t.view, "track sleepers")?.visible).toBe(false);
    expect(t.materials.stripe.uTrackStripe.value).toBe(1);
    t.view.setLod(12);
    expect(layer(t.view, "track sleepers")?.visible).toBe(true);
    expect(t.materials.stripe.uTrackStripe.value).toBe(0);
    t.view.dispose();
  });

  it("rebuilds everything after invalidate", () => {
    const t = setup(false);
    t.sim.execute({ type: "build-track", pieces: straights(10, 5, 5), structure: "auto" });
    t.view.sync(t.sim.network());
    t.view.invalidate();
    expect(t.view.stats.pieces).toBe(0);
    t.view.sync(t.sim.network());
    expect(t.view.stats.pieces).toBe(5);
    t.view.dispose();
  });
});
