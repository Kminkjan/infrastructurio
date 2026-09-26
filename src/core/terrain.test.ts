import { describe, expect, it } from "vitest";
import { axial, toWorld } from "./lattice";
import {
  DEFAULT_TERRAIN_SIZE,
  TERRAIN_GENERATOR_VERSION,
  type Terrain,
  generateTerrain,
  heightDmAt,
  isWaterAt,
  nodeOfOffset,
  offsetOfNode,
  terrainBoundsM,
  terrainHash,
} from "./terrain";

const GOLDEN_SEED = "baltic-diorama";
/**
 * Recorded 2026-09-26 from generator version 1 at the default size, and
 * re-recorded the same day when the shore ramp landed (version 1 had not
 * shipped). Once a version ships, a change here means every save of it loads
 * different ground: bump TERRAIN_GENERATOR_VERSION and re-record
 * deliberately, never casually.
 */
const GOLDEN_HASH = "9a922d9c";

const golden = generateTerrain({ seed: GOLDEN_SEED, ...DEFAULT_TERRAIN_SIZE });
const others = ["river-town", "seed-2", "x"].map((seed) => generateTerrain({ seed, ...DEFAULT_TERRAIN_SIZE }));
const all = [golden, ...others];

/** The six primary lattice neighbours, as axial steps. */
const NEIGHBOURS = [axial(1, 0), axial(0, 1), axial(-1, 1), axial(-1, 0), axial(0, -1), axial(1, -1)];

interface WaterBody {
  readonly size: number;
  readonly touchesWest: boolean;
  readonly touchesEast: boolean;
  readonly touchesAnyEdge: boolean;
}

/** Connected water bodies over the 6-neighbour lattice, found by flood fill. */
function waterBodies(t: Terrain): WaterBody[] {
  const seen = new Uint8Array(t.water.length);
  const bodies: WaterBody[] = [];
  for (let start = 0; start < t.water.length; start++) {
    if (t.water[start] !== 1 || seen[start] === 1) continue;
    let size = 0;
    let touchesWest = false;
    let touchesEast = false;
    let touchesAnyEdge = false;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop() as number;
      const row = Math.floor(index / t.columns);
      const col = index - row * t.columns;
      size += 1;
      touchesWest ||= col === 0;
      touchesEast ||= col === t.columns - 1;
      touchesAnyEdge ||= col === 0 || col === t.columns - 1 || row === 0 || row === t.rows - 1;
      const node = nodeOfOffset(col, row);
      for (const step of NEIGHBOURS) {
        const o = offsetOfNode(t, axial(node.q + step.q, node.r + step.r));
        if (o === undefined) continue;
        const next = o.row * t.columns + o.col;
        if (t.water[next] === 1 && seen[next] === 0) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    bodies.push({ size, touchesWest, touchesEast, touchesAnyEdge });
  }
  return bodies;
}

describe("terrain generation", () => {
  it("reproduces the golden hash for the default seed and size", () => {
    expect(golden.generatorVersion).toBe(TERRAIN_GENERATOR_VERSION);
    expect(golden.columns).toBe(400);
    expect(golden.rows).toBe(346);
    expect(terrainHash(golden)).toBe(GOLDEN_HASH);
  });

  it("gives identical heights and water for the same seed and size", () => {
    const again = generateTerrain({ seed: GOLDEN_SEED, ...DEFAULT_TERRAIN_SIZE });
    expect(again.heightsDm).toEqual(golden.heightsDm);
    expect(again.water).toEqual(golden.water);
    expect(terrainHash(again)).toBe(terrainHash(golden));
  });

  it("gives different seeds different hashes", () => {
    const hashes = new Set(all.map(terrainHash));
    expect(hashes.size).toBe(all.length);
  });

  it("changes the hash when a single height or water flag changes", () => {
    const heightsDm = golden.heightsDm.slice();
    heightsDm[12_345] = (heightsDm[12_345] ?? 0) + 1;
    expect(terrainHash({ ...golden, heightsDm })).not.toBe(GOLDEN_HASH);
    const water = golden.water.slice();
    water[0] = 1 - (water[0] ?? 0);
    expect(terrainHash({ ...golden, water })).not.toBe(GOLDEN_HASH);
    expect(terrainHash({ ...golden, seed: "other" })).not.toBe(GOLDEN_HASH);
  });

  it("keeps the water fraction between 2% and 20%", () => {
    for (const t of all) {
      const wet = t.water.reduce((sum, w) => sum + w, 0);
      const fraction = wet / t.water.length;
      expect(fraction).toBeGreaterThan(0.02);
      expect(fraction).toBeLessThan(0.2);
    }
  });

  it("marks exactly the nodes below the water level as water", () => {
    for (const t of all) {
      for (let i = 0; i < t.heightsDm.length; i++) {
        if ((t.water[i] === 1) !== ((t.heightsDm[i] ?? 0) < t.waterLevelDm)) {
          expect.fail(`water mask disagrees with height at index ${i}`);
        }
      }
    }
  });

  it("runs one river that touches both the west and east edges", () => {
    for (const t of all) {
      const rivers = waterBodies(t).filter((b) => b.touchesWest && b.touchesEast);
      expect(rivers.length).toBe(1);
    }
  });

  it("places a lake of about 130 m radius clear of the river and the edges", () => {
    // The shore ramp brings the bed up to water level about 2.2 m past the
    // 130 m radius, and a 132 m disc covers π·132² / 21.65 m² ≈ 2530 nodes.
    for (const t of all) {
      const lakes = waterBodies(t).filter((b) => !b.touchesAnyEdge);
      expect(lakes.length).toBe(1);
      expect(lakes[0]?.size).toBeGreaterThan(2200);
      expect(lakes[0]?.size).toBeLessThan(2700);
    }
  });

  it("has no water besides the river and the lake", () => {
    for (const t of all) expect(waterBodies(t).length).toBe(2);
  });

  it("ramps banks up through the waterline, so the shore follows the curve rather than the lattice", () => {
    // A bed-to-shelf step across one edge makes the 10 m waterline cross every
    // shore edge at the same fraction, a stair-step along the lattice. The
    // 10 m ramp spreads the crossings, and the steepest it allows across a
    // 5 m edge is the lake's 31 dm × (s(0.75) − s(0.25)) ≈ 21 dm, plus rounding
    // and the first of the bank. The old step was 23–34 dm on every shore edge.
    for (const t of all) {
      const bins = new Array<number>(11).fill(0);
      let shoreEdges = 0;
      let maxJumpDm = 0;
      for (let row = 0; row < t.rows; row++) {
        for (let col = 0; col < t.columns; col++) {
          const node = nodeOfOffset(col, row);
          const a = row * t.columns + col;
          // Three forward neighbours visit each lattice edge once.
          for (const step of NEIGHBOURS.slice(0, 3)) {
            const o = offsetOfNode(t, axial(node.q + step.q, node.r + step.r));
            if (o === undefined) continue;
            const b = o.row * t.columns + o.col;
            if (t.water[a] === t.water[b]) continue;
            const wet = Math.min(t.heightsDm[a] ?? 0, t.heightsDm[b] ?? 0);
            const dry = Math.max(t.heightsDm[a] ?? 0, t.heightsDm[b] ?? 0);
            shoreEdges += 1;
            maxJumpDm = Math.max(maxJumpDm, dry - wet);
            const bin = Math.floor(((t.waterLevelDm - wet) / (dry - wet)) * 10);
            bins[bin] = (bins[bin] ?? 0) + 1;
          }
        }
      }
      expect(shoreEdges).toBeGreaterThan(1000);
      expect(maxJumpDm).toBeLessThanOrEqual(24);
      // Before the ramp, 85% of crossings fell in one tenth of the edge.
      expect(Math.max(...bins) / shoreEdges).toBeLessThan(0.25);
    }
  });

  it("keeps every height within [waterLevel − 30, 1000] dm", () => {
    for (const t of all) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const h of t.heightsDm) {
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
      expect(min).toBeGreaterThanOrEqual(t.waterLevelDm - 30);
      expect(max).toBeLessThanOrEqual(1000);
    }
  });

  it("generates the default size in under a second", () => {
    const start = performance.now();
    generateTerrain({ seed: "timing", ...DEFAULT_TERRAIN_SIZE });
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("generates small maps without a lake instead of failing", () => {
    const t = generateTerrain({ seed: "tiny", columns: 24, rows: 20 });
    expect(t.heightsDm.length).toBe(24 * 20);
    for (const h of t.heightsDm) {
      expect(h).toBeGreaterThanOrEqual(t.waterLevelDm - 30);
      expect(h).toBeLessThanOrEqual(1000);
    }
    expect(terrainHash(t)).toBe(terrainHash(generateTerrain({ seed: "tiny", columns: 24, rows: 20 })));
  });

  it("leaves the lake out rather than merging it into the river on a map too small to keep them apart", () => {
    // At 160 × 139 no lake centre can clear the river. A merged 130 m lake
    // would put about 60 water nodes in one column; the river alone about 10.
    for (const seed of ["z0", "z1", "z2", "z3", "z4", "z5"]) {
      const t = generateTerrain({ seed, columns: 160, rows: 139 });
      const bodies = waterBodies(t);
      expect(bodies.length).toBe(1);
      expect(bodies[0]?.touchesWest && bodies[0]?.touchesEast).toBe(true);
      for (let col = 0; col < t.columns; col++) {
        let wet = 0;
        for (let row = 0; row < t.rows; row++) wet += t.water[row * t.columns + col] ?? 0;
        if (wet > 20) expect.fail(`seed ${seed}: column ${col} holds ${wet} water nodes, more than a river`);
      }
    }
  });

  it("rejects sizes that are not integers in range with a RangeError", () => {
    expect(() => generateTerrain({ seed: "s", columns: 1, rows: 10 })).toThrow(RangeError);
    expect(() => generateTerrain({ seed: "s", columns: 10, rows: 10.5 })).toThrow(RangeError);
    expect(() => generateTerrain({ seed: "s", columns: 5000, rows: 10 })).toThrow(RangeError);
  });
});

describe("terrain layout and lookup", () => {
  it("lays out offset rows with even rows at x = 5·col and odd rows half a step east", () => {
    for (const [col, row] of [[0, 0], [7, 0], [0, 1], [7, 1], [399, 345], [12, 200]] as const) {
      const w = toWorld(nodeOfOffset(col, row));
      expect(w.x).toBeCloseTo(5 * col + (row % 2 === 1 ? 2.5 : 0), 9);
      expect(w.y).toBeCloseTo(row * 4.330127018922193, 9);
    }
  });

  it("round-trips every node between offset and axial coordinates", () => {
    for (let row = 0; row < golden.rows; row++) {
      for (let col = 0; col < golden.columns; col++) {
        const node = nodeOfOffset(col, row);
        const back = offsetOfNode(golden, node);
        if (back?.col !== col || back.row !== row) expect.fail(`(${col}, ${row}) came back as ${JSON.stringify(back)}`);
      }
    }
  });

  it("returns undefined, or false for water, outside the map", () => {
    const outside = [
      nodeOfOffset(-1, 0),
      nodeOfOffset(golden.columns, 0),
      nodeOfOffset(0, -1),
      nodeOfOffset(0, golden.rows),
      nodeOfOffset(-1, golden.rows - 1),
      nodeOfOffset(golden.columns, 1),
      axial(0.5, 0),
    ];
    for (const node of outside) {
      expect(offsetOfNode(golden, node)).toBeUndefined();
      expect(heightDmAt(golden, node)).toBeUndefined();
      expect(isWaterAt(golden, node)).toBe(false);
    }
  });

  it("reads heights and water at a node from the row-major arrays", () => {
    for (const [col, row] of [[0, 0], [399, 345], [123, 77], [200, 150]] as const) {
      const node = nodeOfOffset(col, row);
      const index = row * golden.columns + col;
      expect(heightDmAt(golden, node)).toBe(golden.heightsDm[index]);
      expect(isWaterAt(golden, node)).toBe(golden.water[index] === 1);
    }
  });

  it("bounds the map at about 2.0 × 1.5 km from the south-west origin, enclosing every node", () => {
    const b = terrainBoundsM(golden);
    expect(b.minX).toBe(0);
    expect(b.minY).toBe(0);
    expect(b.maxX).toBeCloseTo(1997.5, 9);
    expect(b.maxY).toBeCloseTo(345 * 4.330127018922193, 9);
    for (let row = 0; row < golden.rows; row++) {
      for (const col of [0, golden.columns - 1]) {
        const w = toWorld(nodeOfOffset(col, row));
        if (w.x < b.minX - 1e-9 || w.x > b.maxX + 1e-9 || w.y < b.minY - 1e-9 || w.y > b.maxY + 1e-9) {
          expect.fail(`node (${col}, ${row}) at ${w.x}, ${w.y} lies outside the bounds`);
        }
      }
    }
  });
});
