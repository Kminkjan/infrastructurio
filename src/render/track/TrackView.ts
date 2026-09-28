import { Group } from "three";
import type { NetworkPiece, NetworkView } from "../../core/sim/api";
import type { TrackMaterials } from "../art/materials";
import { type TrackBatch, createTrackBatch } from "./TrackBatch";
import { buildTrackMeshes } from "./trackGeometry";
import { type TrackLod, trackLodForPpm } from "./trackLod";

/**
 * The built track (architecture "Per-frame order", step 3): three layers
 * behind `TrackBatch`, kept in step with `NetworkView` snapshots by piece
 * key. When the network has a newer revision than the one applied, removed
 * keys leave at once and new keys queue for building; building stops once a
 * frame's slice passes the budget (8 ms) and asks the scheduler for another
 * frame, so a large rebuild spreads over frames instead of stalling one.
 * Diffing keys against the current view, never replaying `Result.diff`s,
 * lets the view heal itself after undo, redo or a full rebuild.
 *
 * D4: ground track and bridge track sit in separate batch sets, so H (hide
 * decks) hides the track on bridges with their structures; ground track gets
 * ballast skirts. Track inside a tunnel is not drawn at all (the underground
 * x-ray shows tunnels, `StructureView`).
 */

/** Longest a frame spends building track before it yields. */
export const TRACK_REBUILD_BUDGET_MS = 8;

export interface TrackViewOptions {
  readonly materials: TrackMaterials;
  /** Whether `WEBGL_multi_draw` is available; without it the chunk-merged fallback is used. */
  readonly multiDraw: boolean;
  /** Asks for one more frame to continue a time-sliced rebuild. */
  readonly requestFrame: () => void;
  /** Wall clock in ms for the slice budget (render may read the clock; the core never does). */
  readonly now: () => number;
  readonly budgetMs?: number;
}

export interface TrackViewStats {
  /** The network revision fully applied, or −1. */
  readonly appliedRev: number;
  /** Pieces drawn (ground and bridge). */
  readonly pieces: number;
  readonly bridgePieces: number;
  /** Tunnel pieces, never drawn here. */
  readonly tunnelPieces: number;
  readonly pending: number;
  /** Frames the last rebuild took, and the longest single slice (ms). */
  readonly lastRebuildSlices: number;
  readonly longestSliceMs: number;
  readonly batch: "batched" | "chunked";
}

type TrackLayer = "ground" | "bridge";

interface LayerBatches {
  readonly ballast: TrackBatch;
  readonly sleepers: TrackBatch;
  readonly rails: TrackBatch;
}

export class TrackView {
  readonly group = new Group();
  private readonly layers: Record<TrackLayer, LayerBatches>;
  private readonly batches: readonly TrackBatch[];
  /** Built pieces and the layer each sits in. */
  private readonly built = new Map<string, TrackLayer>();
  private pending: NetworkPiece[] = [];
  private tunnelPieces = 0;
  private targetRev = -1;
  private lod: TrackLod = "near";
  private decksHidden = false;
  private slices = 0;
  private longestSliceMs = 0;
  private readonly budgetMs: number;

  constructor(private readonly options: TrackViewOptions) {
    this.group.name = "track";
    const { materials, multiDraw } = options;
    const layer = (prefix: string): LayerBatches => ({
      ballast: createTrackBatch(materials.ballast, `${prefix}ballast`, multiDraw),
      sleepers: createTrackBatch(materials.sleepers, `${prefix}sleepers`, multiDraw),
      rails: createTrackBatch(materials.rails, `${prefix}rails`, multiDraw),
    });
    this.layers = { ground: layer("track "), bridge: layer("bridge track ") };
    this.batches = [...Object.values(this.layers.ground), ...Object.values(this.layers.bridge)];
    for (const b of this.batches) this.group.add(b.object);
    this.budgetMs = options.budgetMs ?? TRACK_REBUILD_BUDGET_MS;
  }

  get stats(): TrackViewStats {
    let bridgePieces = 0;
    for (const layer of this.built.values()) if (layer === "bridge") bridgePieces += 1;
    return {
      appliedRev: this.pending.length === 0 ? this.targetRev : -1,
      pieces: this.built.size,
      bridgePieces,
      tunnelPieces: this.tunnelPieces,
      pending: this.pending.length,
      lastRebuildSlices: this.slices,
      longestSliceMs: this.longestSliceMs,
      batch: this.layers.ground.ballast.kind,
    };
  }

  /** True while queued pieces are still being built. */
  get busy(): boolean {
    return this.pending.length > 0;
  }

  /**
   * Brings the batches toward `network`. Call once per frame; it costs a
   * revision compare when nothing changed. Returns true when the scene changed.
   */
  sync(network: NetworkView): boolean {
    let changed = false;
    if (network.rev !== this.targetRev) {
      this.targetRev = network.rev;
      // Every drawn piece and the layer it belongs in; tunnel pieces are not drawn.
      const wanted = new Map<string, TrackLayer>();
      this.tunnelPieces = 0;
      for (const p of network.pieces) {
        if (p.structure === "tunnel") this.tunnelPieces += 1;
        else wanted.set(p.key, layerOf(p));
      }
      for (const [key, layer] of this.built) {
        if (wanted.get(key) === layer) continue;
        for (const b of Object.values(this.layers[layer])) b.remove(key);
        this.built.delete(key);
        changed = true;
      }
      this.pending = network.pieces.filter((p) => p.structure !== "tunnel" && !this.built.has(p.key));
      this.slices = 0;
      this.longestSliceMs = 0;
    }
    if (this.pending.length > 0) {
      const start = this.options.now();
      let elapsed = 0;
      // Always build at least one piece, so a slow machine still makes progress.
      do {
        const piece = this.pending.pop();
        if (!piece) break;
        this.add(piece);
        elapsed = this.options.now() - start;
      } while (this.pending.length > 0 && elapsed < this.budgetMs);
      this.slices += 1;
      this.longestSliceMs = Math.max(this.longestSliceMs, elapsed);
      changed = true;
      if (this.pending.length > 0) this.options.requestFrame();
    }
    if (changed) for (const b of this.batches) b.flush();
    return changed;
  }

  /** Far LOD below 4 ppm: sleepers hidden, the ballast stripe shown. */
  setLod(ppm: number): void {
    const lod = trackLodForPpm(ppm);
    if (lod === this.lod) return;
    this.lod = lod;
    this.syncShown();
    this.options.materials.stripe.uTrackStripe.value = lod === "far" ? 1 : 0;
  }

  /** H: hides the track on bridges (their structures hide in `StructureView`). */
  setDecksHidden(hidden: boolean): void {
    if (hidden === this.decksHidden) return;
    this.decksHidden = hidden;
    this.syncShown();
  }

  get bridgeTrackShown(): boolean {
    return !this.decksHidden;
  }

  private syncShown(): void {
    for (const [name, layer] of Object.entries(this.layers) as [TrackLayer, LayerBatches][]) {
      const on = name === "ground" || !this.decksHidden;
      layer.ballast.setShown(on);
      layer.rails.setShown(on);
      layer.sleepers.setShown(on && this.lod === "near");
    }
  }

  get currentLod(): TrackLod {
    return this.lod;
  }

  /** Drops every piece; the next `sync` rebuilds from its view (palette change, context restore). */
  invalidate(): void {
    for (const [key, layer] of this.built) for (const b of Object.values(this.layers[layer])) b.remove(key);
    for (const b of this.batches) b.flush();
    this.built.clear();
    this.pending = [];
    this.targetRev = -1;
  }

  dispose(): void {
    for (const b of this.batches) b.dispose();
    this.group.clear();
    this.built.clear();
    this.pending = [];
  }

  private add(piece: NetworkPiece): void {
    const layer = layerOf(piece);
    const meshes = buildTrackMeshes({ prims: piece.prims, z0M: piece.z0Mm / 1000, z1M: piece.z1Mm / 1000 }, { skirts: layer === "ground" });
    const batches = this.layers[layer];
    batches.ballast.add(piece.key, meshes.ballast);
    batches.sleepers.add(piece.key, meshes.sleepers);
    batches.rails.add(piece.key, meshes.rails);
    this.built.set(piece.key, layer);
  }
}

function layerOf(piece: NetworkPiece): TrackLayer {
  return piece.structure === "bridge" ? "bridge" : "ground";
}
