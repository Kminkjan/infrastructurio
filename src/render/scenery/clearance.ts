import type { InstancedMesh } from "three";
import { LATTICE_SPACING_M, SQRT3, type Terrain } from "../../core/sim/api";
import { CHUNK_NODES, chunkCounts } from "../terrain/terrainGeometry";

/**
 * Scenery gives way to earthworks (art direction "Trees and scenery"; the
 * earthworks-lite finding in ADR 0010): trees and props standing where a
 * cutting or embankment moved the ground, or on the formation beside the
 * track, hide on that network revision and come back on undo or demolish.
 * Buildings are never moved. The layers stay in charge of their instances;
 * this only buckets them by terrain chunk, so a chunk's earthworks rebuild
 * re-tests just the instances on it. The layers share the mechanics below:
 * `writeClearedInstance` collapses or restores one instance matrix, and
 * `commitClearedMeshes` uploads the changed meshes.
 */

/** The 3×3 basis entries of a column-major 4×4 matrix (translation and the w row stay). */
const BASIS_ELEMENTS = [0, 1, 2, 4, 5, 6, 8, 9, 10] as const;

/**
 * Writes instance `k` of `mesh`: its placed matrix (the 16 floats of `placed` from
 * `offset`), or, when `cleared`, that matrix collapsed to a point at its translation (the
 * 3×3 basis zeroed, so every triangle is degenerate). Restoring writes the placed matrix
 * back exactly. The caller marks the mesh dirty for `commitClearedMeshes`.
 */
export function writeClearedInstance(mesh: InstancedMesh, k: number, placed: Float32Array, offset: number, cleared: boolean): void {
  const array = mesh.instanceMatrix.array as Float32Array;
  const at = 16 * k;
  for (let e = 0; e < 16; e++) array[at + e] = placed[offset + e] ?? 0;
  if (cleared) for (const e of BASIS_ELEMENTS) array[at + e] = 0;
}

/** A mesh's own instance bounds, recomputed (the default for `commitClearedMeshes`). */
export function refreshInstanceBounds(mesh: InstancedMesh): void {
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
}

/**
 * Uploads the instance matrices of every mesh in `dirty`, refreshes bounds through
 * `rebound` (by default each mesh's own), then empties the set.
 */
export function commitClearedMeshes(dirty: Set<InstancedMesh>, rebound: (mesh: InstancedMesh) => void = refreshInstanceBounds): void {
  for (const mesh of dirty) {
    mesh.instanceMatrix.needsUpdate = true;
    rebound(mesh);
  }
  dirty.clear();
}

/** Instanced scenery that can hide where earthworks clear the ground. */
export interface ClearableLayer {
  readonly clearableCount: number;
  clearablePosition(i: number, out: { x: number; y: number }): void;
  /** Returns whether the instance's state changed. */
  setCleared(i: number, cleared: boolean): boolean;
  isCleared(i: number): boolean;
  /** Uploads the changes made since the last commit. */
  commitCleared(): void;
}

export class SceneryClearance {
  /** Per layer: instance indices by LOD0 terrain chunk (y · countX + x). */
  private readonly buckets: Int32Array[][];
  private readonly countX: number;
  private readonly point = { x: 0, y: 0 };

  constructor(
    terrain: Pick<Terrain, "columns" | "rows">,
    private readonly layers: readonly ClearableLayer[],
  ) {
    const counts = chunkCounts(terrain);
    this.countX = counts.x;
    // A LOD0 chunk spans 64 columns (320 m, odd rows half a step east) and 64 rows (277 m).
    const chunkW = LATTICE_SPACING_M * CHUNK_NODES;
    const chunkH = ((LATTICE_SPACING_M * SQRT3) / 2) * CHUNK_NODES;
    this.buckets = layers.map((layer) => {
      const lists: number[][] = Array.from({ length: counts.x * counts.y }, () => []);
      for (let i = 0; i < layer.clearableCount; i++) {
        layer.clearablePosition(i, this.point);
        const x = Math.min(counts.x - 1, Math.max(0, Math.floor(this.point.x / chunkW)));
        const y = Math.min(counts.y - 1, Math.max(0, Math.floor(this.point.y / chunkH)));
        lists[y * counts.x + x]?.push(i);
      }
      return lists.map((l) => Int32Array.from(l));
    });
  }

  /**
   * Re-tests the instances bucketed on LOD0 chunk (x, y) against `cleared`
   * (plan metres → whether earthworks claim the spot) and commits the layers
   * that changed. Returns the number of instances whose state changed.
   */
  update(chunkX: number, chunkY: number, cleared: (x: number, y: number) => boolean): number {
    let changed = 0;
    this.layers.forEach((layer, l) => {
      const list = this.buckets[l]?.[chunkY * this.countX + chunkX];
      if (!list || list.length === 0) return;
      let layerChanged = false;
      for (const i of list) {
        layer.clearablePosition(i, this.point);
        if (layer.setCleared(i, cleared(this.point.x, this.point.y))) {
          changed += 1;
          layerChanged = true;
        }
      }
      if (layerChanged) layer.commitCleared();
    });
    return changed;
  }

  /** Instances currently cleared, per layer. */
  clearedCounts(): number[] {
    return this.layers.map((layer) => {
      let n = 0;
      for (let i = 0; i < layer.clearableCount; i++) if (layer.isCleared(i)) n += 1;
      return n;
    });
  }
}
