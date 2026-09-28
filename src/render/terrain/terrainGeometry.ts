import { BufferAttribute, BufferGeometry, Color, Vector3 } from "three";
import { type Terrain, nodeOfOffset, terrainBoundsM, toWorld } from "../../core/sim/api";
import { palette } from "../art/palette";
import { type GroundBounds, lodBandForPpm } from "../camera/isoMath";
import { simToWorld } from "../coords";
import { type TerrainLod, forEachLatticeTriangle, lodCol, lodGridSize, lodRow } from "./offsetGrid";
import type { TerrainShading } from "./terrainShading";
import { smoothstep } from "../math";

/**
 * Terrain and water meshes from the sim's heights (art direction "Terrain and
 * water"). The terrain mesh *is* the lattice: one vertex per node at its Int16
 * dm height, lattice triangles only, so what the player sees is what the sim
 * validates against. Pure data builders here; `TerrainView` wraps them.
 */

/** Chunk edge in LOD0 nodes; LOD1 chunks cover the same ground with half as many. */
export const CHUNK_NODES = 64;
/**
 * The water mesh covers every triangle of its LOD within this many rings of a
 * water node. A triangle only dips below the surface where one of its own
 * vertices is water, so ring 0 already covers every visible patch at either
 * LOD; the extra rings add surface hidden under the banks. Three was sized
 * when a single LOD0 mesh also had to reach under LOD1's 10 m shoreline.
 */
export const WATER_MESH_RINGS = 3;
/** Depth (dm) at which the water colour is fully deep. */
const WATER_DEEP_DM = 25;

/** Plain arrays for one mesh; `nodeIndices` maps each vertex back to its terrain node. */
export interface MeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly nodeIndices: Int32Array;
  readonly triangleCount: number;
}

/** LOD1 in the far band (< 2 ppm), full resolution in the mid and near bands. */
export function terrainLodForPpm(ppm: number): TerrainLod {
  return lodBandForPpm(ppm) === "far" ? 1 : 0;
}

/** Chunks per axis; chunks share their edge vertices. */
export function chunkCounts(t: Pick<Terrain, "columns" | "rows">): { x: number; y: number } {
  return { x: Math.max(1, Math.ceil((t.columns - 1) / CHUNK_NODES)), y: Math.max(1, Math.ceil((t.rows - 1) / CHUNK_NODES)) };
}

/** Terrain extent in world XZ, for camera clamping. */
export function terrainWorldBounds(t: Terrain): GroundBounds {
  const b = terrainBoundsM(t);
  const sw = simToWorld(b.minX, b.minY, 0);
  const ne = simToWorld(b.maxX, b.maxY, 0);
  // `+ 0` turns the −0 that negating y = 0 produces into +0.
  return {
    minX: Math.min(sw.x, ne.x) + 0,
    maxX: Math.max(sw.x, ne.x) + 0,
    minZ: Math.min(sw.z, ne.z) + 0,
    maxZ: Math.max(sw.z, ne.z) + 0,
  };
}

const heightRanges = new WeakMap<Terrain, { readonly minM: number; readonly maxM: number }>();

/** Lowest and highest node height in metres, cached per terrain. */
export function terrainHeightRangeM(t: Terrain): { readonly minM: number; readonly maxM: number } {
  let range = heightRanges.get(t);
  if (!range) {
    let min = Infinity;
    let max = -Infinity;
    for (const h of t.heightsDm) {
      if (h < min) min = h;
      if (h > max) max = h;
    }
    range = { minM: min / 10, maxM: max / 10 };
    heightRanges.set(t, range);
  }
  return range;
}

/**
 * One chunk at one LOD. Vertices take the terrain's node heights and the
 * precomputed shading; LOD1 samples every other node of the 10 m sub-lattice
 * (see `lodGridSize`). A chunk beyond the LOD's grid comes back empty.
 */
export function buildChunkData(t: Terrain, shading: TerrainShading, chunkX: number, chunkY: number, lod: TerrainLod): MeshData {
  const step = lod === 0 ? CHUNK_NODES : CHUNK_NODES / 2;
  const grid = lodGridSize(t.columns, t.rows, lod);
  const i0 = chunkX * step;
  const j0 = chunkY * step;
  const i1 = Math.min(i0 + step, grid.columns - 1);
  const j1 = Math.min(j0 + step, grid.rows - 1);
  if (i1 <= i0 || j1 <= j0) return emptyMesh();

  const across = i1 - i0 + 1;
  const vertexCount = across * (j1 - j0 + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const nodeIndices = new Int32Array(vertexCount);
  const v = new Vector3();
  let k = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const col = lodCol(lod, i, j);
      const row = lodRow(lod, j);
      const node = row * t.columns + col;
      const plan = toWorld(nodeOfOffset(col, row));
      simToWorld(plan.x, plan.y, (t.heightsDm[node] ?? 0) / 10, v);
      writeVertex(k, node, v, shading.normals, shading.colors, positions, normals, colors);
      nodeIndices[k] = node;
      k++;
    }
  }

  const triangleCount = 2 * (i1 - i0) * (j1 - j0);
  const indices = new Uint16Array(triangleCount * 3);
  let n = 0;
  forEachLatticeTriangle(i0, i1, j0, j1, (ai, aj, bi, bj, ci, cj) => {
    indices[n++] = (aj - j0) * across + (ai - i0);
    indices[n++] = (bj - j0) * across + (bi - i0);
    indices[n++] = (cj - j0) * across + (ci - i0);
  });
  return { positions, normals, colors, indices, nodeIndices, triangleCount };
}

/**
 * The water surface for one LOD: a flat, opaque mesh at water level over
 * every lattice triangle of that LOD within WATER_MESH_RINGS of water. It is
 * one draw call and never sorted. It uses the LOD's own triangles so its
 * outline is the LOD's terrain outline: LOD1 drops up to 7.5 m at the west
 * and east edges, where a LOD0 surface would leave blue tabs over the haze at
 * the river mouths. Colours tint by the depth below each vertex, from water
 * to deep; vertices on land keep the shallow colour. The visible shoreline is
 * where the terrain rises through this plane. Per-vertex foam followed the
 * lattice rows and stepped along the bank, so foam is left to a D11 shader
 * pass. Triangles wholly over land sit under the terrain and never show.
 */
export function buildWaterData(t: Terrain, shading: TerrainShading, lod: TerrainLod = 0, rings: number = WATER_MESH_RINGS): MeshData {
  const { columns, rows } = t;
  const grid = lodGridSize(columns, rows, lod);
  const picked: number[] = [];
  forEachLatticeTriangle(0, grid.columns - 1, 0, grid.rows - 1, (ai, aj, bi, bj, ci, cj) => {
    const a = lodRow(lod, aj) * columns + lodCol(lod, ai, aj);
    const b = lodRow(lod, bj) * columns + lodCol(lod, bi, bj);
    const c = lodRow(lod, cj) * columns + lodCol(lod, ci, cj);
    if (waterMeshCovers(shading.waterDistance, a, b, c, rings)) picked.push(a, b, c);
  });

  const vertexOf = new Int32Array(columns * rows).fill(-1);
  const nodeList: number[] = [];
  for (const node of picked) {
    if (vertexOf[node] === -1) {
      vertexOf[node] = nodeList.length;
      nodeList.push(node);
    }
  }

  const count = nodeList.length;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const nodeIndices = Int32Array.from(nodeList);
  const water = new Color(palette.water);
  const deep = new Color(palette.waterDeep);
  const c = new Color();
  const v = new Vector3();
  const up = simToWorld(0, 0, 1);
  const levelM = t.waterLevelDm / 10;
  for (let k = 0; k < count; k++) {
    const node = nodeList[k] ?? 0;
    const row = Math.floor(node / columns);
    const plan = toWorld(nodeOfOffset(node - row * columns, row));
    simToWorld(plan.x, plan.y, levelM, v);
    positions.set([v.x, v.y, v.z], 3 * k);
    normals.set([up.x, up.y, up.z], 3 * k);
    const depthDm = t.waterLevelDm - (t.heightsDm[node] ?? 0);
    if (depthDm > 0) c.copy(water).lerp(deep, smoothstep(0, WATER_DEEP_DM, depthDm));
    else c.copy(water);
    colors.set([c.r, c.g, c.b], 3 * k);
  }

  const indices = count > 0xffff ? new Uint32Array(picked.length) : new Uint16Array(picked.length);
  for (let i = 0; i < picked.length; i++) indices[i] = vertexOf[picked[i] ?? 0] ?? 0;
  return { positions, normals, colors, indices, nodeIndices, triangleCount: picked.length / 3 };
}

/**
 * Whether the water mesh covers the lattice triangle with corner nodes a, b and c (node indices, −1 for none):
 * one of them lies within `rings` of water. `buildWaterData` picks its triangles by it, and the ghost's ground
 * (`heightfieldRay.ts` `waterPlane`) reads the water plane only where it is drawn.
 */
export function waterMeshCovers(waterDistance: Uint8Array, a: number, b: number, c: number, rings: number = WATER_MESH_RINGS): boolean {
  return Math.min(waterDistance[a] ?? 255, waterDistance[b] ?? 255, waterDistance[c] ?? 255) <= rings;
}

/** Wraps mesh data in a BufferGeometry with bounds computed, so culling works. */
export function toBufferGeometry(data: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(data.normals, 3));
  geometry.setAttribute("color", new BufferAttribute(data.colors, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function writeVertex(
  k: number,
  node: number,
  v: Vector3,
  nodeNormals: Float32Array,
  nodeColors: Float32Array,
  positions: Float32Array,
  normals: Float32Array,
  colors: Float32Array,
): void {
  positions[3 * k] = v.x;
  positions[3 * k + 1] = v.y;
  positions[3 * k + 2] = v.z;
  for (let axis = 0; axis < 3; axis++) {
    normals[3 * k + axis] = nodeNormals[3 * node + axis] ?? 0;
    colors[3 * k + axis] = nodeColors[3 * node + axis] ?? 0;
  }
}

function emptyMesh(): MeshData {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    colors: new Float32Array(0),
    indices: new Uint16Array(0),
    nodeIndices: new Int32Array(0),
    triangleCount: 0,
  };
}
