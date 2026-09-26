import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { toWorld } from "../../core/lattice";
import { DEFAULT_TERRAIN_SIZE, type Terrain, generateTerrain, nodeOfOffset } from "../../core/terrain";
import { ISO_PITCH_RAD, type IsoView, worldToScreen, yawForStep } from "../camera/isoMath";
import { simToWorld, worldToSim } from "../coords";
import { forEachLatticeTriangle, lodCol, lodGridSize, lodRow } from "./offsetGrid";
import {
  CHUNK_NODES,
  type MeshData,
  WATER_MESH_RINGS,
  buildChunkData,
  buildWaterData,
  chunkCounts,
  terrainHeightRangeM,
  terrainLodForPpm,
  terrainWorldBounds,
  toBufferGeometry,
} from "./terrainGeometry";
import { computeTerrainShading } from "./terrainShading";

// 150 × 100 nodes: 3 × 2 chunks with partial chunks on the east and north edges.
const small = generateTerrain({ seed: "baltic-diorama", columns: 150, rows: 100 });
const smallShading = computeTerrainShading(small);
const golden = generateTerrain({ seed: "baltic-diorama", ...DEFAULT_TERRAIN_SIZE });
const goldenShading = computeTerrainShading(golden);

function triangles(data: MeshData, visit: (a: Vector3, b: Vector3, c: Vector3, ia: number, ib: number, ic: number) => void): void {
  const p = (i: number) => new Vector3(data.positions[3 * i], data.positions[3 * i + 1], data.positions[3 * i + 2]);
  for (let t = 0; t < data.triangleCount; t++) {
    const ia = data.indices[3 * t] ?? 0;
    const ib = data.indices[3 * t + 1] ?? 0;
    const ic = data.indices[3 * t + 2] ?? 0;
    visit(p(ia), p(ib), p(ic), ia, ib, ic);
  }
}

function allChunks(t: Terrain, lod: 0 | 1): MeshData[] {
  const shading = t === golden ? goldenShading : smallShading;
  const counts = chunkCounts(t);
  const out: MeshData[] = [];
  for (let y = 0; y < counts.y; y++) for (let x = 0; x < counts.x; x++) out.push(buildChunkData(t, shading, x, y, lod));
  return out;
}

describe("terrain chunks", () => {
  it("chunks 64 × 64 nodes into two triangles per lattice cell", () => {
    expect(chunkCounts(golden)).toEqual({ x: 7, y: 6 });
    const full = buildChunkData(golden, goldenShading, 0, 0, 0);
    expect(full.triangleCount).toBe(2 * CHUNK_NODES * CHUNK_NODES);
    expect(full.positions.length / 3).toBe(65 * 65);
    const corner = buildChunkData(golden, goldenShading, 6, 5, 0);
    expect(corner.triangleCount).toBe(2 * (399 - 384) * (345 - 320));
    const total = allChunks(golden, 0).reduce((sum, c) => sum + c.triangleCount, 0);
    expect(total).toBe(2 * (golden.columns - 1) * (golden.rows - 1));
  });

  it("halves the resolution at LOD1 and still tiles the map", () => {
    const full = buildChunkData(golden, goldenShading, 0, 0, 1);
    expect(full.triangleCount).toBe(2 * 32 * 32);
    const total = allChunks(golden, 1).reduce((sum, c) => sum + c.triangleCount, 0);
    // LOD1 grid: 200 × 173 vertices.
    expect(total).toBe(2 * 199 * 172);
  });

  it("picks LOD1 below 2 ppm and LOD0 otherwise", () => {
    expect(terrainLodForPpm(0.9)).toBe(1);
    expect(terrainLodForPpm(1.99)).toBe(1);
    expect(terrainLodForPpm(2)).toBe(0);
    expect(terrainLodForPpm(22)).toBe(0);
  });

  it("places every vertex at toWorld + height through simToWorld", () => {
    for (const lod of [0, 1] as const) {
      for (const chunk of allChunks(small, lod)) {
        for (let k = 0; k < chunk.nodeIndices.length; k++) {
          const node = chunk.nodeIndices[k] ?? 0;
          const row = Math.floor(node / small.columns);
          const plan = toWorld(nodeOfOffset(node - row * small.columns, row));
          const expected = simToWorld(plan.x, plan.y, (small.heightsDm[node] ?? 0) / 10);
          const actual = new Vector3(chunk.positions[3 * k], chunk.positions[3 * k + 1], chunk.positions[3 * k + 2]);
          expect(actual.distanceTo(expected)).toBeLessThan(1e-3);
        }
      }
    }
  });

  it("winds every triangle counter-clockwise from above, agreeing with its vertex normals", () => {
    for (const lod of [0, 1] as const) {
      for (const chunk of allChunks(small, lod)) {
        let bad = 0;
        triangles(chunk, (a, b, c, ia, ib, ic) => {
          const face = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
          if (face.y <= 0) bad++;
          for (const i of [ia, ib, ic]) {
            const n = new Vector3(chunk.normals[3 * i], chunk.normals[3 * i + 1], chunk.normals[3 * i + 2]);
            if (face.dot(n) <= 0) bad++;
          }
        });
        expect(bad).toBe(0);
      }
    }
  });

  it("projects every triangle counter-clockwise on screen at all six yaws (FrontSide only)", () => {
    const chunk = buildChunkData(small, smallShading, 0, 0, 0);
    for (let k = 0; k < 6; k++) {
      const view: IsoView = { target: { x: 150, z: -150 }, ppm: 6, yaw: yawForStep(k), pitch: ISO_PITCH_RAD, cssWidth: 1280, cssHeight: 720 };
      let clockwise = 0;
      triangles(chunk, (a, b, c) => {
        const [sa, sb, sc] = [worldToScreen(view, a), worldToScreen(view, b), worldToScreen(view, c)];
        // CSS y points down, so counter-clockwise on screen is a negative cross product here.
        const cross = (sb.x - sa.x) * (sc.y - sa.y) - (sb.y - sa.y) * (sc.x - sa.x);
        if (cross >= 0) clockwise++;
      });
      expect(clockwise).toBe(0);
    }
  });

  it("keeps only lattice triangles: 5 m edges at LOD0, 10 m at LOD1", () => {
    for (const lod of [0, 1] as const) {
      const spacing = lod === 0 ? 5 : 10;
      const chunk = buildChunkData(small, smallShading, 1, 1, lod);
      let worst = 0;
      triangles(chunk, (a, b, c) => {
        for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
          const s = worldToSim(p);
          const e = worldToSim(q);
          worst = Math.max(worst, Math.abs(Math.hypot(s.x - e.x, s.y - e.y) - spacing));
        }
      });
      expect(worst).toBeLessThan(1e-3);
    }
  });

  it("contains no NaN and builds bounded geometry", () => {
    for (const chunk of allChunks(small, 0)) {
      for (const array of [chunk.positions, chunk.normals, chunk.colors]) expect(array.every(Number.isFinite)).toBe(true);
    }
    const geometry = toBufferGeometry(buildChunkData(small, smallShading, 0, 0, 0));
    expect(geometry.boundingSphere?.radius).toBeGreaterThan(0);
    expect(Number.isNaN(geometry.boundingSphere?.radius)).toBe(false);
    geometry.dispose();
  });

  it("returns an empty chunk beyond a LOD's grid instead of failing", () => {
    const tiny = generateTerrain({ seed: "x", columns: 2, rows: 2 });
    const shading = computeTerrainShading(tiny);
    expect(buildChunkData(tiny, shading, 0, 0, 0).triangleCount).toBe(2);
    expect(buildChunkData(tiny, shading, 0, 0, 1).triangleCount).toBe(0);
  });
});

describe("terrain bounds and water", () => {
  it("reports the map in world XZ and its height range", () => {
    const b = terrainWorldBounds(golden);
    expect(b.minX).toBe(0);
    expect(b.maxX).toBeCloseTo(1997.5, 6);
    expect(b.maxZ).toBe(0);
    expect(b.minZ).toBeCloseTo(-345 * 4.330127018922193, 6);
    const range = terrainHeightRangeM(golden);
    expect(range.minM).toBeLessThan(golden.waterLevelDm / 10);
    expect(range.maxM).toBeGreaterThan(range.minM);
    expect(terrainHeightRangeM(golden)).toBe(range);
  });

  it("covers every lattice triangle that touches water with a flat, upward water surface", () => {
    const data = buildWaterData(golden, goldenShading);
    expect(data.triangleCount).toBeGreaterThan(0);
    const levelY = golden.waterLevelDm / 10;
    for (let k = 0; k < data.nodeIndices.length; k++) expect(data.positions[3 * k + 1]).toBeCloseTo(levelY, 6);

    const covered = new Set<string>();
    for (let t = 0; t < data.triangleCount; t++) {
      const nodes = [0, 1, 2].map((v) => data.nodeIndices[data.indices[3 * t + v] ?? 0] ?? 0).sort((x, y) => x - y);
      covered.add(nodes.join(","));
      const near = Math.min(...nodes.map((n) => goldenShading.waterDistance[n] ?? 255));
      expect(near).toBeLessThanOrEqual(WATER_MESH_RINGS);
    }
    let missing = 0;
    forEachLatticeTriangle(0, golden.columns - 1, 0, golden.rows - 1, (ai, aj, bi, bj, ci, cj) => {
      const nodes = [aj * golden.columns + ai, bj * golden.columns + bi, cj * golden.columns + ci];
      if (nodes.some((n) => golden.water[n] === 1) && !covered.has(nodes.sort((x, y) => x - y).join(","))) missing++;
    });
    expect(missing).toBe(0);

    let bad = 0;
    triangles(data, (a, b, c) => {
      if (new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).y <= 0) bad++;
    });
    expect(bad).toBe(0);
    expect(data.colors.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
  });

  it("builds the LOD1 water from LOD1 triangles, so it never overhangs the LOD1 terrain", () => {
    const data = buildWaterData(golden, goldenShading, 1);
    expect(data.triangleCount).toBeGreaterThan(0);
    const grid = lodGridSize(golden.columns, golden.rows, 1);
    const lodNode = (i: number, j: number) => lodRow(1, j) * golden.columns + lodCol(1, i, j);
    const lodNodes = new Set<number>();
    for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.columns; i++) lodNodes.add(lodNode(i, j));
    for (const node of data.nodeIndices) if (!lodNodes.has(node)) expect.fail(`water vertex at node ${node} is not a LOD1 vertex`);

    // The river runs off both edges: a LOD0 surface reaches x = 1997.5 m, past the LOD1 terrain.
    const maxX = (d: MeshData) => {
      let m = -Infinity;
      for (let k = 0; k < d.positions.length; k += 3) m = Math.max(m, d.positions[k] ?? -Infinity);
      return m;
    };
    const terrainMaxX = Math.max(...allChunks(golden, 1).map(maxX));
    expect(maxX(buildWaterData(golden, goldenShading, 0))).toBeGreaterThan(terrainMaxX);
    expect(maxX(data)).toBeLessThanOrEqual(terrainMaxX);

    const covered = new Set<string>();
    for (let t = 0; t < data.triangleCount; t++) {
      covered.add([0, 1, 2].map((v) => data.nodeIndices[data.indices[3 * t + v] ?? 0] ?? 0).sort((x, y) => x - y).join(","));
    }
    let missing = 0;
    forEachLatticeTriangle(0, grid.columns - 1, 0, grid.rows - 1, (ai, aj, bi, bj, ci, cj) => {
      const nodes = [lodNode(ai, aj), lodNode(bi, bj), lodNode(ci, cj)];
      if (nodes.some((n) => golden.water[n] === 1) && !covered.has(nodes.sort((x, y) => x - y).join(","))) missing++;
    });
    expect(missing).toBe(0);
    let clockwise = 0;
    triangles(data, (a, b, c) => {
      if (new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).y <= 0) clockwise++;
    });
    expect(clockwise).toBe(0);
  });
});
