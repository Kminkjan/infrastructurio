import { type CentrelineIndex, centrelineIndex, nearestOnCentreline } from "../../core/geometry/sample";
import { type GroundView, type NetworkView, type Terrain, earthworkPieces, networkAdjacency, toWorld } from "../../core/sim/api";
import type { SceneryClearance } from "../scenery/clearance";
import { isPortalEnd, structureRuns } from "../structures/runs";
import { ChunkPass, DrawnHeightfield, type EarthworkPiece, type Envelope, FORMATION_HALF_WIDTH_M, chunksTouching, envelopeAt, nearestOnPiece, piecesTouching } from "./earthworks";
import { type buildEarthworkChunk, earthworkChunkSteps } from "./earthworkMesh";
import type { TerrainLod } from "./offsetGrid";
import { type MeshData, buildChunkData } from "./terrainGeometry";
import type { TerrainShading } from "./terrainShading";

/**
 * Keeps the terrain's earthworks in step with `NetworkView` snapshots
 * (architecture "Per-frame order", step 3, beside `TrackView`). On a new
 * revision it takes the core's settled earthwork pieces (`sim.ground()`, since
 * the D4 feel-check fixes, 2026-09-28: the core settles the reaches beside
 * each edit and clips the chains at bridges and tunnels, and judges new track
 * against the same surface) and diffs them by object: the reach boxes of
 * pieces that left, arrived or changed mark the terrain chunks (both LODs) to
 * rebuild, LOD0 first. Each rebuild runs the
 * chunk pass over every current piece near the chunk, so a chunk is always
 * rebuilt from scratch: undo gives back the natural chunk exactly, and the
 * incremental result equals a fresh view's. Rebuilds are time-sliced like the
 * track (8 ms, at least one slice per frame), and a chunk too big for a slice
 * spreads its pass and mesh over frames, swapped in only once whole. A LOD0
 * rebuild also swaps the chunk's refined triangles into the
 * drawn heightfield (picking); once every LOD0 chunk of the revision is done,
 * the scenery on those chunks is re-tested, then LOD1 (only drawn below 2 ppm)
 * catches up.
 */

/** Queue order: LOD0 chunks, then the scenery on them, then LOD1 chunks. */
const STEP_LOD0 = 0;
const STEP_SCENERY = 1;
const STEP_LOD1 = 2;
/** The first character of a LOD0 step's key ("0"): the queue is sorted, so LOD0 steps come first. */
const STEP_LOD0_CODE = 48 + STEP_LOD0;

export const EARTHWORKS_BUDGET_MS = 8;
/**
 * Scenery whose trunk or post stands within this plan distance of a centreline
 * is cleared: the 3 m formation plus 2 m, so crowns (up to about 3.9 m across
 * their widest tier) mostly stay off the ballast.
 */
export const SCENERY_CLEARANCE_M = FORMATION_HALF_WIDTH_M + 2;
/** Scenery also clears where the drawn ground moved more than this. */
export const SCENERY_MOVED_M = 0.1;
/**
 * Bridges and tunnels are never conformed (the earthworks move ground only for ground track), but scenery gives
 * way to them too (D4): trees and props within SCENERY_CLEARANCE_M of a bridge's centreline would stand in its
 * deck or piers, and within this radius of a portal node in its face and wings.
 */
export const PORTAL_SCENERY_CLEARANCE_M = 9;

/** A bridge piece or a portal the scenery gives way to: a centreline or a disc, and its plan box. */
interface Clearing {
  readonly index: CentrelineIndex | null;
  readonly x: number;
  readonly y: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

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
  /** Bridges and portals scenery clears around (by `b:<key>` and `p:<node>`); never conformed. */
  private readonly clearing = new Map<string, Clearing>();
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
  private readonly near = { d: 0, s: 0 };
  /** The step in flight: its queue key (still at the queue's head) and its remaining slices. */
  private current: { readonly key: string; readonly work: Generator<void, void, void> } | undefined;

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

  /**
   * The network revision whose LOD0 surface (the heightfield that picking and the ghost read) is fully drawn, or −1
   * while its chunks are pending; scenery and LOD1 may still follow. Allocation-free, for the frame loop.
   */
  get surfaceRev(): number {
    const head = this.queue[0];
    return head === undefined || head.charCodeAt(0) !== STEP_LOD0_CODE ? this.targetRev : -1;
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
  sync(network: NetworkView, ground?: GroundView, budgetMs = this.budgetMs): boolean {
    if (!this.enabled) return false;
    if (network.rev !== this.targetRev) {
      this.targetRev = network.rev;
      // A step in flight may read pieces the revision replaced: it starts again (its key stays queued).
      this.current = undefined;
      this.applyRevision(network, ground && ground.rev === network.rev ? ground : undefined);
    }
    if (this.queue.length === 0) return false;
    const now = this.options.now;
    const start = now();
    let elapsed = 0;
    do {
      let current = this.current;
      if (!current) {
        const key = this.queue[0];
        if (key === undefined) break;
        current = this.current = { key, work: this.stepWork(key) };
      }
      if (current.work.next().done) {
        this.queue.shift();
        this.queued.delete(current.key);
        this.current = undefined;
      }
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
    this.current = undefined;
    this.plain.clear();
    for (const key of this.drawnWithEarthworks) this.enqueue(key);
    // Scenery on chunks near pieces must be re-cleared too, even where the ground did not move (bridges and portals too).
    for (const p of this.pieces.values()) this.enqueueBox(p);
    if (this.scenery) for (const c of this.clearing.values()) chunksTouching(this.options.terrain, 0, c, (x, y) => this.enqueue(`${STEP_SCENERY}:${x}:${y}`));
    this.sortQueue();
    if (this.queue.length > 0) this.options.requestFrame();
  }

  /**
   * The lowest cut envelope (m) of the earthwork pieces reaching into a plan box, as a function of (x, y) (Infinity
   * where none reaches), leaving out the chain whose fixed clip plane is at node key `except` (a portal's own
   * approach, whose headwall the portal face stands in). The hill plug is capped by it (`plug.ts`).
   */
  cutEnvelopeIn(box: { minX: number; minY: number; maxX: number; maxY: number }, except: string): (x: number, y: number) => number {
    const pieces = piecesTouching(this.pieces.values(), box).filter((p) => !p.planes.some((c) => c.fixed && c.key === except));
    const near = { d: 0, s: 0 };
    const e: Envelope = { u: 0, l: 0, d: 0 };
    return (x, y) => {
      let u = Number.POSITIVE_INFINITY;
      for (const p of pieces) {
        if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) continue;
        if (envelopeAt(p, p, x, y, null, near, e) && e.u < u) u = e.u;
      }
      return u;
    };
  }

  /** A ground piece's current reach at LOD0 and LOD1 (settled beside its neighbours), or undefined (tests, checks). */
  reachOf(key: string): readonly [number, number] | undefined {
    const p = this.pieces.get(key);
    return p ? [p.reachM, p.lod1.reachM] : undefined;
  }

  /** Whether earthworks claim plan (x, y) for scenery: on a formation, under a bridge, at a portal, or where the drawn ground moved. */
  clearsScenery(x: number, y: number, near: readonly EarthworkPiece[], clearing: readonly Clearing[] = []): boolean {
    for (const p of near) {
      if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) continue;
      if (nearestOnPiece(p, x, y, this.near).d <= SCENERY_CLEARANCE_M) return true;
    }
    for (const c of clearing) {
      if (x < c.minX || x > c.maxX || y < c.minY || y > c.maxY) continue;
      if (c.index ? nearestOnCentreline(c.index, x, y, this.near).d <= SCENERY_CLEARANCE_M : Math.hypot(x - c.x, y - c.y) <= PORTAL_SCENERY_CLEARANCE_M) return true;
    }
    if (this.heightfield.triangles.size === 0) return false;
    const drawn = this.heightfield.heightAtM(x, y);
    const natural = this.heightfield.naturalAtM(x, y);
    return Math.abs(drawn - natural) > SCENERY_MOVED_M;
  }

  /**
   * Takes the revision's earthwork pieces: the core's (`ground`), or, for a caller without a sim (tests), the same
   * rule applied to the whole network afresh, keeping the pieces that did not change. A piece that left, arrived or
   * changed (its reach, cap rise or clip planes) queues the chunks of its old and new boxes.
   */
  private applyRevision(network: NetworkView, ground: GroundView | undefined): void {
    const next = ground?.pieces ?? this.fresh(network);
    for (const [key, piece] of this.pieces) {
      if (next.get(key) === piece) continue;
      this.enqueueBox(piece);
      if (!next.has(key)) this.pieces.delete(key);
    }
    for (const [key, piece] of next) {
      if (this.pieces.get(key) === piece) continue;
      this.pieces.set(key, piece);
      this.enqueueBox(piece);
    }
    this.syncClearing(network);
    this.rebuild = { chunks: 0, slices: 0, totalMs: 0, longestSliceMs: 0 };
    this.sortQueue();
  }

  /** The rule over the whole network, reusing each current piece whose settled form is the same. */
  private fresh(network: NetworkView): ReadonlyMap<string, EarthworkPiece> {
    const out = new Map<string, EarthworkPiece>();
    for (const p of earthworkPieces(this.options.terrain, network.pieces, networkAdjacency(network))) {
      const old = this.pieces.get(p.key);
      out.set(p.key, old && sameSettled(old, p) ? old : p);
    }
    return out;
  }

  /** Bridges and portals: the scenery on the chunks of any that came or went is re-tested. */
  private syncClearing(network: NetworkView): void {
    const wanted = new Map<string, () => Clearing>();
    const m = SCENERY_CLEARANCE_M;
    for (const p of network.pieces) {
      if (p.structure !== "bridge") continue;
      wanted.set(`b:${p.key}`, () => {
        const index = centrelineIndex(p);
        return { index, x: 0, y: 0, minX: index.minX - m, minY: index.minY - m, maxX: index.maxX + m, maxY: index.maxY + m };
      });
    }
    for (const run of structureRuns(network)) {
      if (run.structure !== "tunnel") continue;
      for (const end of [0, 1] as const) {
        if (!isPortalEnd(this.options.terrain, run, end)) continue;
        const n = run.nodes[end];
        const { x, y } = toWorld(n);
        const r = PORTAL_SCENERY_CLEARANCE_M;
        wanted.set(`p:${n.q},${n.r},${n.zMm}`, () => ({ index: null, x, y, minX: x - r, minY: y - r, maxX: x + r, maxY: y + r }));
      }
    }
    const t = this.options.terrain;
    const touch = (c: Clearing): void => {
      if (this.scenery) chunksTouching(t, 0, c, (x, y) => this.enqueue(`${STEP_SCENERY}:${x}:${y}`));
    };
    for (const [key, c] of this.clearing) {
      if (wanted.has(key)) continue;
      this.clearing.delete(key);
      touch(c);
    }
    for (const [key, make] of wanted) {
      if (this.clearing.has(key)) continue;
      const c = make();
      this.clearing.set(key, c);
      touch(c);
    }
  }

  private sortQueue(): void {
    // LOD0 (the drawn surface at every zoom above Far, and picking), its scenery, then LOD1.
    this.queue.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** Queues the chunks (and their scenery) a piece's reach meets, at each LOD's reach. */
  private enqueueBox(piece: EarthworkPiece): void {
    const t = this.options.terrain;
    chunksTouching(t, 0, piece, (x, y) => {
      this.enqueue(`${STEP_LOD0}:${x}:${y}`);
      if (this.scenery) this.enqueue(`${STEP_SCENERY}:${x}:${y}`);
    });
    chunksTouching(t, 1, piece.lod1, (x, y) => this.enqueue(`${STEP_LOD1}:${x}:${y}`));
  }

  private enqueue(key: string): void {
    if (this.queued.has(key)) return;
    this.queued.add(key);
    this.queue.push(key);
  }

  /**
   * One queued step as slices: a chunk's pass one piece (or block) at a time, then its mesh a few rows at a time,
   * swapped in only once whole, so a chunk too big for one 8 ms slice spreads over frames (PR #83 re-review).
   */
  private *stepWork(key: string): Generator<void, void, void> {
    const [stepText, xText, yText] = key.split(":");
    const step = Number(stepText);
    const x = Number(xText);
    const y = Number(yText);
    const terrain = this.options.terrain;
    if (step === STEP_SCENERY) {
      const box = ChunkPass.chunkBox(terrain, 0, x, y);
      const near = piecesTouching(this.pieces.values(), box);
      const clearing = [...this.clearing.values()].filter((c) => !(c.maxX < box.minX || c.minX > box.maxX || c.maxY < box.minY || c.minY > box.maxY));
      this.scenery?.update(x, y, (px, py) => this.clearsScenery(px, py, near, clearing));
      return;
    }
    const lod: TerrainLod = step === STEP_LOD0 ? 0 : 1;
    const near = piecesTouching(this.pieces.values(), ChunkPass.chunkBox(terrain, lod, x, y), lod);
    const pass = this.pass;
    this.rebuild.chunks += 1;
    const steps = pass.begin(terrain, lod, x, y, near);
    if (!steps) return;
    while (!steps.next().done) yield;
    // Drawn with earthworks: refined triangles, fans, or outline corners of a neighbour's refined triangles.
    const moved = pass.stats.refined > 0 || pass.stats.fans > 0 || pass.stats.seamCorners > 0;
    if (moved || this.drawnWithEarthworks.has(key)) {
      let plain = this.plain.get(key);
      if (!plain) {
        plain = buildChunkData(terrain, this.target.shading, x, y, lod);
        this.plain.set(key, plain);
      }
      const mesh = yield* earthworkChunkSteps(pass, this.target.shading, plain);
      this.target.replaceChunk(x, y, lod, mesh);
      if (moved) this.drawnWithEarthworks.add(key);
      else this.drawnWithEarthworks.delete(key);
    }
    this.maxCutM = Math.max(this.maxCutM, pass.stats.maxCutM);
    this.maxFillM = Math.max(this.maxFillM, pass.stats.maxFillM);
    (lod === 0 ? this.heightfield : this.heightfieldLod1).setChunk(pass);
  }
}

/** Whether two preparations of one piece draw the same: equal reaches, cap rises and clip planes. */
function sameSettled(a: EarthworkPiece, b: EarthworkPiece): boolean {
  if (a.reachM !== b.reachM || a.lod1.reachM !== b.lod1.reachM || a.capRiseM !== b.capRiseM || a.lod1.capRiseM !== b.lod1.capRiseM) return false;
  if (a.planes.length !== b.planes.length) return false;
  return a.planes.every((p, i) => {
    const q = b.planes[i];
    return q !== undefined && p.x === q.x && p.y === q.y && p.tx === q.tx && p.ty === q.ty && p.fixed === q.fixed && p.key === q.key;
  });
}
