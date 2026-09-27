import { LATTICE_SPACING_M, SQRT3, type Terrain } from "../../core/sim/api";
import { CHUNK_NODES, chunkCounts } from "../terrain/terrainGeometry";

/**
 * Scenery gives way to earthworks (art direction "Trees and scenery"; the
 * earthworks-lite finding in ADR 0010): trees and props standing where a
 * cutting or embankment moved the ground, or on the formation beside the
 * track, hide on that network revision and come back on undo or demolish.
 * Buildings are never moved. The layers stay in charge of their instances;
 * this only buckets them by terrain chunk, so a chunk's earthworks rebuild
 * re-tests just the instances on it.
 */

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
