import { Group, type Material, Mesh } from "three";
import type { Terrain } from "../../core/terrain";
import type { WorldBox } from "../art/shadowFit";
import type { TerrainLod } from "./offsetGrid";
import { buildChunkData, buildWaterData, chunkCounts, terrainHeightRangeM, terrainWorldBounds, toBufferGeometry } from "./terrainGeometry";
import { computeTerrainShading } from "./terrainShading";

interface Chunk {
  readonly lod0: Mesh;
  /** Absent when LOD1 has no triangles here (very small maps); LOD0 stands in. */
  readonly lod1: Mesh | undefined;
}

/**
 * The terrain's scene objects: one mesh per 64 × 64-node chunk and LOD, plus
 * a water surface per LOD. Chunks are culled by three against their bounds;
 * `setLod` swaps every chunk and the water at once, so neighbouring chunks
 * never mix LODs, no cracks open between them, and the water outline always
 * matches the terrain's. Both materials are owned by the caller (the lattice
 * overlay), which disposes them.
 *
 * Every mesh casts and receives shadows, but D1 terrain cannot cast a visible
 * shadow: with a FrontSide material three draws back faces into the shadow
 * map, and a heightfield only shows the 42° sun a back face on slopes over
 * 48° (the golden map's steepest triangle is 33°), nor can a slope under 42°
 * shade its neighbours. The fitted shadow map is for the casters D4 and D11a
 * add (bridges, trees, buildings).
 */
export class TerrainView {
  readonly group = new Group();
  /** World box of the terrain (XZ extent, Y height range), for camera and shadow fitting. */
  readonly box: WorldBox;
  private readonly chunks: Chunk[] = [];
  private readonly water0: Mesh | undefined;
  /** Absent when LOD1 has no water triangles (very small maps); LOD0's water stands in. */
  private readonly water1: Mesh | undefined;
  private lod: TerrainLod = 0;

  constructor(terrain: Terrain, material: Material, waterMaterial: Material) {
    this.group.name = "terrain";
    const shading = computeTerrainShading(terrain);
    const counts = chunkCounts(terrain);
    for (let y = 0; y < counts.y; y++) {
      for (let x = 0; x < counts.x; x++) {
        const lod0 = this.makeMesh(buildChunkData(terrain, shading, x, y, 0), material, `chunk ${x},${y} lod0`);
        if (!lod0) continue;
        const lod1 = this.makeMesh(buildChunkData(terrain, shading, x, y, 1), material, `chunk ${x},${y} lod1`);
        if (lod1) lod1.visible = false;
        this.chunks.push({ lod0, lod1 });
      }
    }
    this.water0 = this.makeMesh(buildWaterData(terrain, shading, 0), waterMaterial, "water lod0");
    this.water1 = this.makeMesh(buildWaterData(terrain, shading, 1), waterMaterial, "water lod1");
    for (const water of [this.water0, this.water1]) if (water) water.castShadow = false;
    if (this.water1) this.water1.visible = false;

    const bounds = terrainWorldBounds(terrain);
    const heights = terrainHeightRangeM(terrain);
    this.box = { minX: bounds.minX, maxX: bounds.maxX, minY: heights.minM, maxY: heights.maxM, minZ: bounds.minZ, maxZ: bounds.maxZ };
  }

  get currentLod(): TerrainLod {
    return this.lod;
  }

  setLod(lod: TerrainLod): void {
    if (lod === this.lod) return;
    this.lod = lod;
    for (const { lod0, lod1 } of this.chunks) {
      lod0.visible = lod === 0 || lod1 === undefined;
      if (lod1) lod1.visible = lod === 1;
    }
    if (this.water0) this.water0.visible = lod === 0 || this.water1 === undefined;
    if (this.water1) this.water1.visible = lod === 1;
  }

  dispose(): void {
    for (const { lod0, lod1 } of this.chunks) {
      lod0.geometry.dispose();
      lod1?.geometry.dispose();
    }
    this.water0?.geometry.dispose();
    this.water1?.geometry.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }

  private makeMesh(data: ReturnType<typeof buildChunkData>, material: Material, name: string): Mesh | undefined {
    if (data.triangleCount === 0) return undefined;
    const mesh = new Mesh(toBufferGeometry(data), material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Static: skip per-frame matrix recomputation.
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    return mesh;
  }
}
