import { describe, expect, it } from "vitest";
import { BatchedMesh, type Group } from "three";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { simOn } from "../../../tests/support/simOn";
import type { PieceSpec } from "../../core/sim/api";
import { createArtUniforms, createTrackMaterials } from "../art/materials";
import { TrackView } from "./TrackView";

const bounds = { minX: 0, minZ: -500, maxX: 2000, maxZ: 0 };

/**
 * Flat dry land at 0 m, where the runs lie on the ground, with a 10 m hill on rows 18–22 from q = 18 to 22 for the
 * tunnel. Since D4 the sim judges each piece against the terrain (until then a seeded map, "d3-track-view", whose
 * ground lay metres from the runs at 0 m).
 */
const TERRAIN = makeTerrain(360, 40, (q, r) => (r >= 18 && r <= 22 && q >= 18 && q <= 22 ? 100 : 0), -100);

function straights(q0: number, r: number, n: number): PieceSpec[] {
  return Array.from({ length: n }, (_, i) => ({ kind: "straight", from: { q: q0 + i, r, zMm: 0 }, heading: 0, z1Mm: 0 }) as const);
}

function setup(multiDraw: boolean, clockStepMs = 0, budgetMs?: number) {
  const sim = simOn(TERRAIN);
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
    t.sim.execute({ type: "build-track", pieces: straights(10, 5, 4), structure: "auto" });
    t.view.sync(t.sim.network());
    t.view.setLod(6);
    expect(t.view.currentLod).toBe("near");
    expect(layer(t.view, "track sleepers")?.visible).toBe(true);
    t.view.setLod(3);
    expect(layer(t.view, "track sleepers")?.visible).toBe(false);
    expect(t.materials.stripe.uTrackStripe.value).toBe(1);
    t.view.setLod(12);
    expect(layer(t.view, "track sleepers")?.visible).toBe(true);
    expect(t.materials.stripe.uTrackStripe.value).toBe(0);
    t.view.dispose();
  });

  for (const multiDraw of [true, false]) {
    const kind = multiDraw ? "batched" : "chunked";

    it(`keeps the far-LOD sleepers hidden through rebuilds, and an empty batch out of the render (${kind})`, () => {
      const t = setup(multiDraw);
      const sleepers = () => layer(t.view, "track sleepers");
      t.view.setLod(3);
      // Back to near LOD with no track: the batched mesh has no attributes yet and must stay out of the render.
      t.view.setLod(12);
      if (multiDraw) expect(sleepers()?.visible).toBe(false);
      t.view.setLod(3);
      // Building (and undoing) at far LOD leaves the sleepers hidden; the ballast shows.
      t.sim.execute({ type: "build-track", pieces: straights(10, 5, 4), structure: "auto" });
      t.view.sync(t.sim.network());
      expect(sleepers()?.visible).toBe(false);
      expect(layer(t.view, "track ballast")?.visible).toBe(true);
      t.sim.execute({ type: "build-track", pieces: straights(14, 5, 2), structure: "auto" });
      t.sim.execute({ type: "undo" });
      t.view.sync(t.sim.network());
      expect(sleepers()?.visible).toBe(false);
      t.view.setLod(12);
      expect(sleepers()?.visible).toBe(true);
      // Emptied at near LOD: the batched mesh hides again.
      t.sim.execute({ type: "undo" });
      t.view.sync(t.sim.network());
      if (multiDraw) expect(sleepers()?.visible).toBe(false);
      t.view.dispose();
      t.materials.dispose();
    });
  }

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

  it("draws bridge track in its own batches, which H hides, and never draws track inside a tunnel", () => {
    const t = setup(true);
    // On row 20, into the hill from its foot at q = 17: a tunnel needs to be deeper than a cutting (D4).
    for (const [pieces, structure] of [
      [straights(10, 20, 4), "ground"],
      [straights(14, 20, 3), "bridge"],
      [straights(17, 20, 5), "tunnel"],
    ] as const) {
      const r = t.sim.execute({ type: "build-track", pieces, structure });
      expect(r.ok, JSON.stringify(r)).toBe(true);
    }
    t.view.sync(t.sim.network());
    expect(t.view.stats).toMatchObject({ pieces: 7, bridgePieces: 3, tunnelPieces: 5, pending: 0 });
    const ground = layer(t.view, "track ballast") as BatchedMesh;
    const bridge = layer(t.view, "bridge track ballast") as BatchedMesh;
    const bridgeSleepers = layer(t.view, "bridge track sleepers") as BatchedMesh;
    expect(ground.visible && bridge.visible && bridgeSleepers.visible).toBe(true);
    t.view.setDecksHidden(true);
    expect(bridge.visible || bridgeSleepers.visible).toBe(false);
    expect(ground.visible).toBe(true);
    // The far LOD still hides sleepers once H is off again.
    t.view.setLod(1);
    t.view.setDecksHidden(false);
    expect(bridge.visible).toBe(true);
    expect(bridgeSleepers.visible).toBe(false);
    t.view.setLod(8);
    expect(bridgeSleepers.visible).toBe(true);
    // Undo the tunnel: nothing drawn changes; undo the bridge: its batches empty.
    t.sim.execute({ type: "undo" });
    t.view.sync(t.sim.network());
    expect(t.view.stats).toMatchObject({ pieces: 7, tunnelPieces: 0 });
    t.sim.execute({ type: "undo" });
    t.view.sync(t.sim.network());
    expect(t.view.stats).toMatchObject({ pieces: 4, bridgePieces: 0 });
    expect(bridge.visible).toBe(false);
    t.view.dispose();
    t.materials.dispose();
  });
});
