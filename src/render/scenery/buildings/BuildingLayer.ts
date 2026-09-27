import { type BufferGeometry, Group, Matrix4, Mesh, type MeshLambertMaterial, Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { BuildingLot, DioramaScenery, Terrain } from "../../../core/sim/api";
import { type AssetLod, type AssetRegistry, type MaterialSlot, buildingVariant } from "../../art/AssetRegistry";
import { type WorldMaterials, materialForSlot } from "../../art/materials";
import { simToWorld } from "../../coords";
import { sampleTerrainHeightM } from "../../terrain/heightfieldRay";
import { chunkOf, headingYaw } from "../placement";

/**
 * Grammar-built buildings, merged per 256 m chunk × material × LOD (art
 * direction "Buildings"): a town becomes a few draws, not a hundred. LOD1
 * (silhouettes) shows in the far band. The windmill's sails stay a separate
 * mesh that turns about its hub while ambient animation runs.
 */

export const BUILDING_CHUNK_M = 256;
/** LOD0 from this zoom up (the mid band); silhouettes below. */
export const BUILDING_LOD0_FROM_PPM = 2;
/** Sail speed: one turn in about 9 s, a calm breeze. */
export const SAIL_RADIANS_PER_S = 0.7;

interface Sails {
  readonly pivot: Group;
  readonly mesh: Mesh;
}

/** Where a lot's model origin sits: the mean ground height of its centre and corners, a little sunk. */
function seatHeightM(terrain: Terrain, lot: BuildingLot): number {
  const a = (lot.heading * Math.PI) / 6;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const hl = lot.lengthMm / 2000;
  const hw = lot.widthMm / 2000;
  const x = lot.xMm / 1000;
  const y = lot.yMm / 1000;
  let sum = 0;
  let n = 0;
  for (const [u, v] of [[0, 0], [hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]] as const) {
    const h = sampleTerrainHeightM(terrain, x + u * c - v * s, y + u * s + v * c);
    if (h !== undefined) {
      sum += h;
      n += 1;
    }
  }
  return (n > 0 ? sum / n : terrain.waterLevelDm / 10) - 0.1;
}

export class BuildingLayer {
  readonly group = new Group();
  private readonly byLod: Record<AssetLod, Mesh[]> = { 0: [], 1: [] };
  private readonly sails: Sails[] = [];
  private lod: AssetLod = 0;
  /** Chimney tops in world space (smoke emitters for a later slice). */
  readonly smokeAnchors: Vector3[] = [];

  constructor(scenery: DioramaScenery, terrain: Terrain, registry: AssetRegistry, materials: WorldMaterials) {
    this.group.name = "buildings";
    const buckets = new Map<string, Map<MeshLambertMaterial, BufferGeometry[]>>();
    const matrix = new Matrix4();
    const rotation = new Matrix4();
    const position = new Vector3();
    const hub = new Vector3();

    for (const lot of scenery.lots) {
      const variant = buildingVariant(lot.lengthMm / 1000, lot.widthMm / 1000, lot.seed);
      const yaw = headingYaw(lot.heading);
      simToWorld(lot.xMm / 1000, lot.yMm / 1000, seatHeightM(terrain, lot), position);
      rotation.makeRotationY(yaw);
      matrix.copy(rotation).setPosition(position);
      const { cx, cy } = chunkOf(lot.xMm / 1000, lot.yMm / 1000, BUILDING_CHUNK_M);
      for (const lod of [0, 1] as const) {
        const asset = registry.get(lot.kind, variant, lod);
        for (const [slot, geometry] of Object.entries(asset.slots) as [MaterialSlot, BufferGeometry][]) {
          if (slot === "sails") {
            if (lod === 0) {
              const h = asset.anchors.sail_hub?.[0] ?? { x: 0, y: 0, z: 0 };
              geometry.translate(-h.x, -h.y, -h.z);
              this.addSails(geometry, materialForSlot(materials, slot), hub.set(h.x, h.y, h.z).applyMatrix4(matrix), yaw);
            } else {
              geometry.dispose();
            }
            continue;
          }
          geometry.applyMatrix4(matrix);
          const key = `${cx},${cy},${lod}`;
          let byMaterial = buckets.get(key);
          if (!byMaterial) buckets.set(key, (byMaterial = new Map()));
          const material = materialForSlot(materials, slot);
          let list = byMaterial.get(material);
          if (!list) byMaterial.set(material, (list = []));
          list.push(geometry);
        }
        if (lod === 0) for (const p of asset.anchors.smoke ?? []) this.smokeAnchors.push(new Vector3(p.x, p.y, p.z).applyMatrix4(matrix));
      }
    }

    for (const key of [...buckets.keys()].sort()) {
      const lod = Number(key.split(",")[2]) as AssetLod;
      for (const [material, list] of buckets.get(key) ?? []) {
        const merged = mergeGeometries(list, false);
        for (const g of list) g.dispose();
        if (!merged) continue;
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
        const mesh = new Mesh(merged, material);
        mesh.name = `buildings ${key} ${material.name}`;
        mesh.castShadow = material !== materials.glass;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.visible = lod === 0;
        this.byLod[lod].push(mesh);
        this.group.add(mesh);
      }
    }
  }

  get meshCount(): number {
    return this.byLod[0].length + this.byLod[1].length;
  }

  /** Whether anything here animates (the windmill), so the app knows to run `ambient`. */
  get animated(): boolean {
    return this.sails.length > 0;
  }

  /** Per frame: LOD by zoom and the sails' angle by ambient time. Allocation-free. */
  update(ppm: number, ambientTimeS: number): void {
    const lod: AssetLod = ppm >= BUILDING_LOD0_FROM_PPM ? 0 : 1;
    if (lod !== this.lod) {
      this.lod = lod;
      for (let i = 0; i < this.byLod[0].length; i++) (this.byLod[0][i] as Mesh).visible = lod === 0;
      for (let i = 0; i < this.byLod[1].length; i++) (this.byLod[1][i] as Mesh).visible = lod === 1;
    }
    for (let i = 0; i < this.sails.length; i++) {
      const sails = this.sails[i] as Sails;
      sails.mesh.rotation.x = ambientTimeS * SAIL_RADIANS_PER_S;
      sails.mesh.updateMatrix();
    }
  }

  dispose(): void {
    for (const mesh of [...this.byLod[0], ...this.byLod[1]]) mesh.geometry.dispose();
    for (const s of this.sails) s.mesh.geometry.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }

  private addSails(geometry: BufferGeometry, material: MeshLambertMaterial, hubWorld: Vector3, yaw: number): void {
    const pivot = new Group();
    pivot.position.copy(hubWorld);
    pivot.rotation.y = yaw;
    pivot.updateMatrix();
    pivot.matrixAutoUpdate = false;
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, material);
    mesh.name = "windmill sails";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    pivot.add(mesh);
    this.group.add(pivot);
    this.sails.push({ pivot, mesh });
  }
}
