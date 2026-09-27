import type { NetworkView, Terrain } from "../../core/sim/api";
import type { SceneryClearance } from "../scenery/clearance";
import {
  ChunkPass,
  DrawnHeightfield,
  type EarthworkPiece,
  FORMATION_HALF_WIDTH_M,
  chunksTouching,
  conforms,
  earthworkPiece,
  nearestOnPiece,
  piecesTouching,
} from "./earthworks";
import { buildEarthworkChunk } from "./earthworkMesh";
import type { TerrainLod } from "./offsetGrid";
import { type MeshData, buildChunkData } from "./terrainGeometry";
import type { TerrainShading } from "./terrainShading";

/**
 * Keeps the terrain's earthworks in step with `NetworkView` snapshots
 * (architecture "Per-frame order", step 3, beside `TrackView`). On a new
 * revision it diffs ground pieces by key; the reach boxes of pieces that left
 * or arrived mark the terrain chunks (both LODs) to rebuild, LOD0 first. Each
 * rebuild runs the chunk pass over every current piece near the chunk, so a
 * chunk is always rebuilt from scratch: undo gives back the natural chunk
 * exactly. Rebuilds are time-sliced like the track (8 ms, at least one step
 * per frame). A LOD0 rebuild also swaps the chunk's refined triangles into the
 * drawn heightfield (picking); once every LOD0 chunk of the revision is done,
 * the scenery on those chunks is re-tested, then LOD1 (only drawn below 2 ppm)
 * catches up.
 */

/** Queue order: LOD0 chunks, then the scenery on them, then LOD1 chunks. */
const STEP_LOD0 = 0;
const STEP_SCENERY = 1;
const STEP_LOD1 = 2;

export const EARTHWORKS_BUDGET_MS = 8;
/**
 * Scenery whose trunk or post stands within this plan distance of a centreline
 * is cleared: the 3 m formation plus 2 m, so crowns (up to about 3.9 m across
 * their widest tier) mostly stay off the ballast.
 */
export const SCENERY_CLEARANCE_M = FORMATION_HALF_WIDTH_M + 2;
/** Scenery also clears where the drawn ground moved more than this. */
export const SCENERY_MOVED_M = 0.1;

/** What the view needs of the terrain's chunk meshes (`TerrainView` has this shape). */
export interface EarthworkChunkTarget {
  readonly shading: TerrainShading;
  replaceChunk(x: number, y: number, lod: TerrainLod, data: ReturnType<typeof buildEarthworkChunk>): boolean;
}

export interface EarthworksViewOptions {
  readonly terrain: Terrain;
  readonly target: EarthworkChunkTarget;
  /** Asks for one more frame to continue a time-sliced rebuild. */
  readonly requestFrame: () => void;
  /** Wall clock in ms for the slice budget. */
  readonly now: () => number;
  readonly budgetMs?: number;
  readonly scenery?: SceneryClearance;
  /** False draws the natural terrain and clears nothing (`?earthworks=0`, for before/after checks). */
  readonly enabled?: boolean;
}

export interface EarthworksStats {
  /** The network revision fully applied, or −1 while chunks are pending. */
  readonly appliedRev: number;
  readonly pieces: number;
  readonly pendingChunks: number;
  /** Chunks (both LODs) currently drawn with earthworks. */
  readonly chunksWithEarthworks: number;
  /** The drawn heightfield's refined LOD0 triangles. */
  readonly refinedTriangles: number;
  /** The last revision's rebuild: chunks rebuilt, frames, total and longest slice (ms). */
  readonly lastRebuild: { readonly chunks: number; readonly slices: number; readonly totalMs: number; readonly longestSliceMs: number };
  readonly maxCutM: number;
  readonly maxFillM: number;
  readonly clearedScenery: number;
}

export class EarthworksView {
  /** The drawn LOD0 surface, conformed: what picking and scenery read. */
  readonly heightfield: DrawnHeightfield;
  /** The drawn LOD1 surface (tests and checks). */
  readonly heightfieldLod1: DrawnHeightfield;
  private readonly pieces = new Map<string, EarthworkPiece>();
  /** Pending steps as `${order}:${x}:${y}` (order: STEP_*), sorted so LOD0 goes first. */
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private readonly drawnWithEarthworks = new Set<string>();
  private readonly pass = new ChunkPass();
  /** The plain (natural) mesh of every chunk rebuilt so far, by step key: it never changes, so it is built once. */
  private readonly plain = new Map<string, MeshData>();
  private readonly budgetMs: number;
  private target: EarthworkChunkTarget;
  private scenery: SceneryClearance | undefined;
  private targetRev = -1;
  private rebuild = { chunks: 0, slices: 0, totalMs: 0, longestSliceMs: 0 };
  private maxCutM = 0;
  private maxFillM = 0;

  constructor(private readonly options: EarthworksViewOptions) {
    this.heightfield = new DrawnHeightfield(options.terrain, 0);
    this.heightfieldLod1 = new DrawnHeightfield(options.terrain, 1);
    this.budgetMs = options.budgetMs ?? EARTHWORKS_BUDGET_MS;
    this.target = options.target;
    this.scenery = options.scenery;
  }

  get enabled(): boolean {
    return this.options.enabled !== false;
  }

  /** True while chunks are queued. */
  get busy(): boolean {
    return this.queue.length > 0;
  }

  get stats(): EarthworksStats {
    return {
      appliedRev: this.queue.length === 0 ? this.targetRev : -1,
      pieces: this.pieces.size,
      pendingChunks: this.queue.length,
      chunksWithEarthworks: this.drawnWithEarthworks.size,
      refinedTriangles: this.heightfield.triangles.size,
      lastRebuild: { ...this.rebuild },
      maxCutM: this.maxCutM,
      maxFillM: this.maxFillM,
      clearedScenery: this.scenery?.clearedCounts().reduce((a, b) => a + b, 0) ?? 0,
    };
  }

  /**
   * Brings the earthworks toward `network`. Call once per frame; it costs a
   * revision compare when nothing changed. Returns true when the scene changed.
   */
  sync(network: NetworkView, budgetMs = this.budgetMs): boolean {
    if (!this.enabled) return false;
    if (network.rev !== this.targetRev) {
      this.targetRev = network.rev;
      this.applyRevision(network);
    }
    if (this.queue.length === 0) return false;
    const now = this.options.now;
    const start = now();
    let elapsed = 0;
    do {
      const key = this.queue.shift();
      if (key === undefined) break;
      this.queued.delete(key);
      this.runStep(key);
      elapsed = now() - start;
    } while (this.queue.length > 0 && elapsed < budgetMs);
    this.rebuild.slices += 1;
    this.rebuild.totalMs += elapsed;
    this.rebuild.longestSliceMs = Math.max(this.rebuild.longestSliceMs, elapsed);
    if (this.queue.length > 0) this.options.requestFrame();
    return true;
  }

  /**
   * Rebuilds every chunk that has earthworks onto a new target and scenery
   * (after the tweak panel rebuilt the terrain and scenery with new colours).
   */
  retarget(target: EarthworkChunkTarget, scenery: SceneryClearance | undefined): void {
    this.target = target;
    this.scenery = scenery;
    this.plain.clear();
    for (const key of this.drawnWithEarthworks) this.enqueue(key);
    // Scenery on chunks near pieces must be re-cleared too, even where the ground did not move.
    for (const p of this.pieces.values()) this.enqueueBox(p);
    this.sortQueue();
    if (this.queue.length > 0) this.options.requestFrame();
  }

  /** Whether earthworks claim plan (x, y) for scenery: on a formation, or where the drawn ground moved. */
  clearsScenery(x: number, y: number, near: readonly EarthworkPiece[]): boolean {
    for (const p of near) {
      if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) continue;
      if (nearestOnPiece(p, x, y).d <= SCENERY_CLEARANCE_M) return true;
    }
    if (this.heightfield.triangles.size === 0) return false;
    const drawn = this.heightfield.heightAtM(x, y);
    const natural = this.heightfield.naturalAtM(x, y);
    return Math.abs(drawn - natural) > SCENERY_MOVED_M;
  }

  private applyRevision(network: NetworkView): void {
    const terrain = this.options.terrain;
    const next = new Set<string>();
    for (const p of network.pieces) {
      if (!conforms(p)) continue;
      next.add(p.key);
      if (this.pieces.has(p.key)) continue;
      const piece = earthworkPiece(terrain, p);
      this.pieces.set(p.key, piece);
      this.enqueueBox(piece);
    }
    for (const [key, piece] of this.pieces) {
      if (next.has(key)) continue;
      this.pieces.delete(key);
      this.enqueueBox(piece);
    }
    this.rebuild = { chunks: 0, slices: 0, totalMs: 0, longestSliceMs: 0 };
    this.sortQueue();
  }

  private sortQueue(): void {
    // LOD0 (the drawn surface at every zoom above Far, and picking), its scenery, then LOD1.
    this.queue.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  private enqueueBox(box: { minX: number; minY: number; maxX: number; maxY: number }): void {
    const t = this.options.terrain;
    chunksTouching(t, 0, box, (x, y) => {
      this.enqueue(`${STEP_LOD0}:${x}:${y}`);
      if (this.scenery) this.enqueue(`${STEP_SCENERY}:${x}:${y}`);
    });
    chunksTouching(t, 1, box, (x, y) => this.enqueue(`${STEP_LOD1}:${x}:${y}`));
  }

  private enqueue(key: string): void {
    if (this.queued.has(key)) return;
    this.queued.add(key);
    this.queue.push(key);
  }

  private runStep(key: string): void {
    const [stepText, xText, yText] = key.split(":");
    const step = Number(stepText);
    const x = Number(xText);
    const y = Number(yText);
    const terrain = this.options.terrain;
    if (step === STEP_SCENERY) {
      const near = piecesTouching(this.pieces.values(), ChunkPass.chunkBox(terrain, 0, x, y));
      this.scenery?.update(x, y, (px, py) => this.clearsScenery(px, py, near));
      return;
    }
    const lod: TerrainLod = step === STEP_LOD0 ? 0 : 1;
    const near = piecesTouching(this.pieces.values(), ChunkPass.chunkBox(terrain, lod, x, y));
    const pass = this.pass;
    this.rebuild.chunks += 1;
    if (!pass.run(terrain, lod, x, y, near)) return;
    const moved = pass.stats.refined > 0 || pass.stats.fans > 0;
    if (moved || this.drawnWithEarthworks.has(key)) {
      let plain = this.plain.get(key);
      if (!plain) {
        plain = buildChunkData(terrain, this.target.shading, x, y, lod);
        this.plain.set(key, plain);
      }
      this.target.replaceChunk(x, y, lod, buildEarthworkChunk(pass, this.target.shading, plain));
      if (moved) this.drawnWithEarthworks.add(key);
      else this.drawnWithEarthworks.delete(key);
    }
    this.maxCutM = Math.max(this.maxCutM, pass.stats.maxCutM);
    this.maxFillM = Math.max(this.maxFillM, pass.stats.maxFillM);
    (lod === 0 ? this.heightfield : this.heightfieldLod1).setChunk(x, y, new Map(pass.refined));
  }
}
