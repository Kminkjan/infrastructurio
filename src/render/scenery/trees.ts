import { Color, Group, InstancedBufferAttribute, InstancedMesh, type Material, Matrix4, Quaternion, SRGBColorSpace, Vector3 } from "three";
import { TREE_BIRCH, TREE_PINE, TREE_SPRUCE, type Terrain, type TreeInstances } from "../../core/sim/api";
import { type AssetData, type AssetLod, type AssetRegistry } from "../art/AssetRegistry";
import { palette } from "../art/palette";
import { simToWorld } from "../coords";
import { sampleTerrainHeightM } from "../terrain/heightfieldRay";
import type { ClearableLayer } from "./clearance";
import { MeshBuilder } from "./meshBuilder";

/**
 * Trees (art direction "Trees and scenery"): spruce, pine and birch, each at
 * two LODs, flat-shaded and about 15% oversize. Geometry carries the foliage
 * mask in vertex alpha (crown 1, trunk 0) and baked AO; per-instance colour
 * blends the species' palette pair with a little HSL jitter (`foliageTint`
 * applies it to crowns only).
 *
 * Budgets: LOD0 60–120 triangles, LOD1 24–30. At the 20,000-tree cap that is
 * at most 2.4 M triangles at LOD0, but a Default view sees a few hundred trees;
 * Region draws LOD1 per chunk, and Far draws LOD1 from one whole-map mesh per
 * species.
 */

export const TREE_KINDS = ["tree-spruce", "tree-pine", "tree-birch"] as const;
export type TreeKind = (typeof TREE_KINDS)[number];
/** Species index (core `TREE_*`) → asset kind. */
export const TREE_KIND_OF_SPECIES: Readonly<Record<number, TreeKind>> = {
  [TREE_SPRUCE]: "tree-spruce",
  [TREE_PINE]: "tree-pine",
  [TREE_BIRCH]: "tree-birch",
};
export const TREE_BUDGETS: Readonly<Record<AssetLod, { min: number; max: number }>> = {
  0: { min: 60, max: 120 },
  1: { min: 24, max: 30 },
};
/** Diorama stylisation: trees about 15% over scale. */
export const TREE_OVERSIZE = 1.15;
export const TREE_SCALE_MIN = 0.8;
export const TREE_SCALE_MAX = 1.3;
/** LOD0 from this zoom up; below it LOD1 (the track far-LOD threshold). */
export const TREE_LOD0_FROM_PPM = 4;
/**
 * Below this zoom (the far band) trees cast no shadows, and one whole-map mesh
 * per species replaces the per-chunk meshes: the whole map is in view there,
 * so chunk culling saves nothing and each chunk × species would cost a draw.
 */
export const TREE_SHADOW_FROM_PPM = 2;
export const TREE_CHUNK_M = 256;

const CROWN_AO = { floor: 0.55, heightM: 12 };
const TRUNK_AO = { floor: 0.7, heightM: 2 };
/** Deterministic vertex nudge for blob crowns, so each lump is a little irregular. */
const jitter = (salt: number) => (i: number) => (((i * 7919 + salt * 104729) % 97) / 97 - 0.5) * 0.18;

function spruce(lod: AssetLod): MeshBuilder {
  const b = new MeshBuilder(true);
  b.ao(TRUNK_AO).color(palette.timberDark, 0);
  if (lod === 0) {
    b.prism({ x: 0, z: 0, y0: 0, y1: 2.4, radius: 0.28, radiusTop: 0.22, sides: 6, top: false });
    const tiers = [
      { y0: 1.6, y1: 6.0, r: 2.6, grey: 0.8 },
      { y0: 3.8, y1: 8.0, r: 2.1, grey: 0.87 },
      { y0: 5.8, y1: 10.0, r: 1.55, grey: 0.94 },
      { y0: 7.8, y1: 12.0, r: 1.0, grey: 1 },
    ];
    tiers.forEach((t, i) => {
      b.ao(CROWN_AO).neutral(t.grey);
      b.cone({ x: 0, z: 0, y0: t.y0, y1: t.y1, radius: t.r, sides: 8, phase: i * 0.4, bottom: true });
    });
  } else {
    b.prism({ x: 0, z: 0, y0: 0, y1: 2.2, radius: 0.28, sides: 3, top: false });
    b.ao(CROWN_AO).neutral(0.84).cone({ x: 0, z: 0, y0: 1.6, y1: 8.2, radius: 2.5, sides: 6, bottom: true });
    b.neutral(0.95).cone({ x: 0, z: 0, y0: 5.4, y1: 12, radius: 1.6, sides: 6, phase: 0.5, bottom: true });
  }
  return b;
}

function pine(lod: AssetLod): MeshBuilder {
  const b = new MeshBuilder(true);
  b.ao(TRUNK_AO).color(palette.timber, 0);
  if (lod === 0) {
    b.prism({ x: 0, z: 0, y0: 0, y1: 8.4, radius: 0.26, radiusTop: 0.17, sides: 6, top: false });
    b.ao(CROWN_AO).neutral(0.97);
    b.blob({ x: 0, y: 10.2, z: 0, rx: 2.5, ry: 1.5, rz: 2.3, shape: "icosahedron", jitter: jitter(1) });
    b.neutral(0.88);
    b.blob({ x: 1.3, y: 8.9, z: 0.7, rx: 1.7, ry: 1.1, rz: 1.6, shape: "icosahedron", jitter: jitter(2) });
    b.blob({ x: -1.1, y: 9.2, z: -0.9, rx: 1.8, ry: 1.2, rz: 1.6, shape: "icosahedron", jitter: jitter(3) });
  } else {
    b.prism({ x: 0, z: 0, y0: 0, y1: 8.4, radius: 0.24, sides: 4, top: false });
    b.ao(CROWN_AO).neutral(0.95);
    b.blob({ x: 0, y: 10, z: 0, rx: 2.7, ry: 1.6, rz: 2.5, shape: "octahedron" });
    b.neutral(0.86).blob({ x: 1.1, y: 8.9, z: 0.5, rx: 1.8, ry: 1.2, rz: 1.7, shape: "octahedron" });
  }
  return b;
}

function birch(lod: AssetLod): MeshBuilder {
  const b = new MeshBuilder(true);
  b.ao(TRUNK_AO).color(palette.birchTrunk, 0);
  if (lod === 0) {
    b.prism({ x: 0, z: 0, y0: 0, y1: 5.2, radius: 0.2, radiusTop: 0.13, sides: 5, top: false });
    b.ao({ floor: 0.6, heightM: 10 }).neutral(0.97);
    b.blob({ x: 0, y: 7.4, z: 0, rx: 2.2, ry: 2.9, rz: 2.1, shape: "icosahedron", jitter: jitter(4) });
    b.neutral(0.9);
    b.blob({ x: 1.0, y: 6.0, z: 0.5, rx: 1.6, ry: 1.9, rz: 1.5, shape: "icosahedron", jitter: jitter(5) });
    b.blob({ x: -0.9, y: 6.3, z: -0.6, rx: 1.5, ry: 2.0, rz: 1.5, shape: "icosahedron", jitter: jitter(6) });
  } else {
    b.prism({ x: 0, z: 0, y0: 0, y1: 5.0, radius: 0.2, sides: 4, top: false });
    b.ao({ floor: 0.6, heightM: 10 }).neutral(0.95);
    b.blob({ x: 0, y: 7.0, z: 0, rx: 2.3, ry: 3.0, rz: 2.2, shape: "icosahedron" });
  }
  return b;
}

const BUILDERS: Readonly<Record<TreeKind, (lod: AssetLod) => MeshBuilder>> = {
  "tree-spruce": spruce,
  "tree-pine": pine,
  "tree-birch": birch,
};

/** The tree's mesh builder, for tests that inspect parts and winding. */
export function buildTree(kind: TreeKind, lod: AssetLod): MeshBuilder {
  return BUILDERS[kind](lod);
}

export function registerTreeAssets(registry: AssetRegistry): void {
  for (const kind of TREE_KINDS) {
    registry.register(kind, (_variant, lod): AssetData => {
      const geometry = buildTree(kind, lod).build();
      const r = 2.6;
      return {
        slots: { foliage: geometry },
        anchors: {},
        footprint: [
          [r, 0],
          [0, -r],
          [-r, 0],
          [0, r],
        ],
        triangleBudget: TREE_BUDGETS[lod].max,
      };
    });
  }
}

/** Per-tree presentation drawn from its seed: yaw, scale and crown colour. */
export interface TreeLook {
  readonly yaw: number;
  readonly scale: number;
  readonly color: Color;
}

/** Crown colour pairs per species (paired tokens blend; pine has one token and only jitters). */
function crownPair(species: number): [number, number] {
  if (species === TREE_SPRUCE) return [palette.spruce, palette.spruceLight];
  if (species === TREE_PINE) return [palette.pineCrown, palette.pineCrown];
  return [palette.deciduous, palette.deciduousLight];
}

const pairA = new Color();
const pairB = new Color();
const hsl = { h: 0, s: 0, l: 0 };

/** Deterministic look for a tree seed: yaw, scale in [0.8, 1.3] × 1.15, blended and jittered crown. */
export function treeLook(species: number, seed: number, out: { yaw: number; scale: number; color: Color } = { yaw: 0, scale: 1, color: new Color() }): TreeLook {
  const u = (shift: number) => ((seed >>> shift) & 0xff) / 255;
  out.yaw = u(0) * 2 * Math.PI;
  out.scale = TREE_OVERSIZE * (TREE_SCALE_MIN + (TREE_SCALE_MAX - TREE_SCALE_MIN) * u(8));
  const [a, b] = crownPair(species);
  out.color.copy(pairA.setHex(a)).lerp(pairB.setHex(b), u(16));
  // Jitter in sRGB, where a lightness step reads the same on dark spruce as on pale birch.
  out.color.getHSL(hsl, SRGBColorSpace);
  const j = u(24);
  out.color.setHSL(
    hsl.h + (j - 0.5) * 0.024,
    Math.min(1, Math.max(0, hsl.s + (u(4) - 0.5) * 0.08)),
    Math.min(1, Math.max(0, hsl.l + (u(12) - 0.5) * 0.05)),
    SRGBColorSpace,
  );
  return out;
}

interface TreeChunkMeshes {
  readonly lod0: InstancedMesh;
  readonly lod1: InstancedMesh;
}

/** The 3×3 basis entries of a column-major 4×4 matrix (translation and the w row stay). */
const BASIS_ELEMENTS = [0, 1, 2, 4, 5, 6, 8, 9, 10] as const;

/** Zoom tiers: LOD0 per chunk, LOD1 per chunk, LOD1 whole-map (no shadows). */
export type TreeTier = 0 | 1 | 2;

export function treeTierForPpm(ppm: number): TreeTier {
  if (ppm < TREE_SHADOW_FROM_PPM) return 2;
  return ppm >= TREE_LOD0_FROM_PPM ? 0 : 1;
}

/**
 * Instanced trees, one pair of meshes per 256 m chunk × species. LOD1 shares
 * LOD0's `instanceMatrix` and `instanceColor` attributes, so switching LOD
 * only flips visibility and uploads nothing new. The far tier holds its own
 * copy of the instance data in one LOD1 mesh per species (about 76 bytes a
 * tree, 1.5 MB at the cap), filled once, so the far band costs three draws.
 */
export class TreeLayer implements ClearableLayer {
  readonly group = new Group();
  private readonly chunks = new Group();
  private readonly far = new Group();
  private readonly meshes: TreeChunkMeshes[] = [];
  private readonly farMeshes: InstancedMesh[] = [];
  private tier: TreeTier = 0;
  /** Per tree: chunk mesh, instance, far mesh, far instance (−1 where the tree has no mesh). */
  private readonly slots: Int32Array;
  /** Per tree: its placed instance matrix, to restore after earthworks clear it. */
  private readonly placed: Float32Array;
  private readonly cleared: Uint8Array;
  private readonly dirty = new Set<InstancedMesh>();

  constructor(
    private readonly trees: TreeInstances,
    terrain: Terrain,
    registry: AssetRegistry,
    material: Material,
  ) {
    this.group.name = "trees";
    this.slots = new Int32Array(trees.count * 4).fill(-1);
    this.placed = new Float32Array(trees.count * 16);
    this.cleared = new Uint8Array(trees.count);
    this.chunks.name = "trees by chunk";
    this.far.name = "trees far";
    this.far.visible = false;
    this.group.add(this.chunks, this.far);
    const buckets = new Map<string, number[]>();
    const perSpecies = new Map<number, number>();
    for (let i = 0; i < trees.count; i++) {
      const x = (trees.xMm[i] ?? 0) / 1000;
      const y = (trees.yMm[i] ?? 0) / 1000;
      const species = trees.species[i] ?? 0;
      const key = `${Math.floor(x / TREE_CHUNK_M)},${Math.floor(y / TREE_CHUNK_M)},${species}`;
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push(i);
      perSpecies.set(species, (perSpecies.get(species) ?? 0) + 1);
    }
    const farOf = new Map<number, { mesh: InstancedMesh; next: number; index: number }>();
    for (const [species, count] of [...perSpecies].sort((a, b) => a[0] - b[0])) {
      const kind = TREE_KIND_OF_SPECIES[species] ?? "tree-spruce";
      const geometry = registry.get(kind, 0, 1).slots.foliage;
      if (!geometry) continue;
      const mesh = new InstancedMesh(geometry, material, count);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
      mesh.name = `trees far ${kind}`;
      farOf.set(species, { mesh, next: 0, index: this.farMeshes.length });
      this.farMeshes.push(mesh);
    }
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    const look = { yaw: 0, scale: 1, color: new Color() };
    for (const key of [...buckets.keys()].sort()) {
      const list = buckets.get(key) ?? [];
      const species = Number(key.split(",")[2]);
      const kind = TREE_KIND_OF_SPECIES[species] ?? "tree-spruce";
      const geometry0 = registry.get(kind, 0, 0).slots.foliage;
      const geometry1 = registry.get(kind, 0, 1).slots.foliage;
      if (!geometry0 || !geometry1) continue;
      const lod0 = new InstancedMesh(geometry0, material, list.length);
      const colors = new InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
      lod0.instanceColor = colors;
      const far = farOf.get(species);
      list.forEach((tree, k) => {
        const xM = (trees.xMm[tree] ?? 0) / 1000;
        const yM = (trees.yMm[tree] ?? 0) / 1000;
        // Sink the trunk a little so it never floats on a slope.
        const hM = (sampleTerrainHeightM(terrain, xM, yM) ?? terrain.waterLevelDm / 10) - 0.15;
        treeLook(species, trees.seed[tree] ?? 0, look);
        simToWorld(xM, yM, hM, position);
        rotation.setFromAxisAngle(up, look.yaw);
        scale.setScalar(look.scale);
        lod0.setMatrixAt(k, matrix.compose(position, rotation, scale));
        lod0.setColorAt(k, look.color);
        matrix.toArray(this.placed, 16 * tree);
        this.slots[4 * tree] = this.meshes.length;
        this.slots[4 * tree + 1] = k;
        if (far) {
          far.mesh.setMatrixAt(far.next, matrix);
          far.mesh.setColorAt(far.next, look.color);
          this.slots[4 * tree + 2] = far.index;
          this.slots[4 * tree + 3] = far.next;
          far.next += 1;
        }
      });
      const lod1 = new InstancedMesh(geometry1, material, list.length);
      lod1.instanceMatrix = lod0.instanceMatrix;
      lod1.instanceColor = lod0.instanceColor;
      for (const mesh of [lod0, lod1]) {
        mesh.name = `trees ${key}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.computeBoundingSphere();
        mesh.computeBoundingBox();
        this.chunks.add(mesh);
      }
      lod1.visible = false;
      this.meshes.push({ lod0, lod1 });
    }
    for (const mesh of this.farMeshes) {
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      this.far.add(mesh);
    }
  }

  get instanceCount(): number {
    return this.meshes.reduce((n, m) => n + m.lod0.count, 0);
  }

  get clearableCount(): number {
    return this.trees.count;
  }

  clearablePosition(i: number, out: { x: number; y: number }): void {
    out.x = (this.trees.xMm[i] ?? 0) / 1000;
    out.y = (this.trees.yMm[i] ?? 0) / 1000;
  }

  /**
   * Hides (or restores) tree `i` where earthworks clear the ground: its
   * instances collapse to a point at the trunk (scale 0, so every triangle is
   * degenerate), and restoring writes back the placed matrix exactly. Returns
   * whether anything changed; `commitCleared` uploads the changed meshes.
   */
  setCleared(i: number, cleared: boolean): boolean {
    if ((this.cleared[i] === 1) === cleared || (this.slots[4 * i] ?? -1) < 0) return false;
    this.cleared[i] = cleared ? 1 : 0;
    const chunk = this.meshes[this.slots[4 * i] ?? -1];
    const far = this.farMeshes[this.slots[4 * i + 2] ?? -1];
    if (chunk) this.writeInstance(chunk.lod0, this.slots[4 * i + 1] ?? 0, i, cleared);
    if (far) this.writeInstance(far, this.slots[4 * i + 3] ?? 0, i, cleared);
    return true;
  }

  /** Uploads instance matrices changed by `setCleared` and refreshes their bounds. */
  commitCleared(): void {
    for (const mesh of this.dirty) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      // LOD1 chunk meshes share LOD0's matrix attribute: refresh their bounds too.
      for (const m of this.meshes) {
        if (m.lod0 !== mesh) continue;
        m.lod1.computeBoundingSphere();
        m.lod1.computeBoundingBox();
      }
    }
    this.dirty.clear();
  }

  /** Whether tree `i` is currently cleared. */
  isCleared(i: number): boolean {
    return this.cleared[i] === 1;
  }

  private writeInstance(mesh: InstancedMesh, k: number, tree: number, cleared: boolean): void {
    const array = mesh.instanceMatrix.array as Float32Array;
    const placed = this.placed.subarray(16 * tree, 16 * tree + 16);
    array.set(placed, 16 * k);
    // Column-major: zero the 3×3 basis, keep the translation.
    if (cleared) for (const e of BASIS_ELEMENTS) array[16 * k + e] = 0;
    this.dirty.add(mesh);
  }

  /** Chunk × species mesh pairs. */
  get meshCount(): number {
    return this.meshes.length;
  }

  /** Whole-map far-tier meshes, one per species present. */
  get farMeshCount(): number {
    return this.farMeshes.length;
  }

  /**
   * Per frame: picks the tier for the zoom (chunk LOD0, chunk LOD1 or the
   * whole-map far meshes). Chunk meshes always cast shadows and far meshes
   * never do. Allocation-free; only flips flags on a change.
   */
  update(ppm: number): void {
    const tier = treeTierForPpm(ppm);
    if (tier === this.tier) return;
    this.tier = tier;
    this.chunks.visible = tier !== 2;
    this.far.visible = tier === 2;
    if (tier === 2) return;
    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.meshes[i];
      if (!m) continue;
      m.lod0.visible = tier === 0;
      m.lod1.visible = tier === 1;
    }
  }

  dispose(): void {
    // Geometries belong to the registry; disposing the meshes frees their instance attributes.
    for (const m of this.meshes) {
      m.lod0.dispose();
      m.lod1.dispose();
    }
    for (const mesh of this.farMeshes) mesh.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
