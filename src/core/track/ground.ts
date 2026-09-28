import { type NodeRef, type Piece, type PieceKey, nodeKey } from "../geometry/piece";
import { toWorld } from "../lattice";
import { type Terrain, groundMmAt, offsetOfNode } from "../terrain";
import {
  type ChainAdjacency,
  type EarthworkPiece,
  type Envelope,
  MAX_REACH_M,
  type PieceInput,
  chainPlanes,
  conformRule,
  conforms,
  cutsUnderDeck,
  earthworkPiece,
  envelopeAt,
  mayNeighbour,
  naturalHeightAtM,
  settleReaches,
  settledPiece,
  withPlanes,
} from "./earthworks";

/**
 * The effective ground (D4 feel-check fixes, 2026-09-28): the terrain as the
 * network's earthworks shape it (`earthworks.ts`), kept in step with the
 * authored track by the world. The planner's auto-grade target, rule 4's
 * structure inference and checks, and the track tool's ground heights read
 * it, and the renderer meshes its pieces (`sim.ground()`), so a drag through
 * an existing cutting is ground in that cutting, exactly where the cutting is
 * drawn. Before, the core judged against the natural terrain alone: a new
 * track 8 m under the natural hill was a tunnel although the neighbour's
 * cutting had lowered the drawn ground to a few metres above it (the owner's
 * portal on flat ground, 2026-09-28).
 *
 * **Pieces.** Ground pieces, and bridge pieces whose deck the natural ground
 * comes near (a cut only, `cutsUnderDeck`, decided once per key since the
 * terrain never changes); tunnels never. Each piece's reach is settled beside
 * its neighbours (`settleReaches`) incrementally: after an edit only the
 * pieces beside it are re-derived, and after a removal every piece a
 * neighbour had raised starts again from its natural reach, so the result
 * equals a fresh settle of the same pieces (tested, as the renderer's view
 * tested it before the rule moved here). Each piece carries its chain ends'
 * clip planes (`earthworks.ts`, "Ends at structures"), re-derived along the
 * chains an edit touches, up to MAX_REACH_M either way.
 *
 * **Queries.** `heightM` is the conformed height at a plan point (m, float);
 * `nodeMm` is the ground at a lattice node as the planner and the tool use it
 * (`groundMmAt`: the water surface over a lower bed, else the conformed height
 * rounded to integer mm, which feeds node keys). A query may name the buffer
 * ends a command joins (`clip`): their chains' planes clip too, since whatever
 * the command continues with (a bridge or a tunnel clips there, ground track's
 * own section covers the cone), so a chained drag sees the ground a single
 * drag would. Pieces are found through a grid of their reach boxes. Node
 * results without a clip are cached until the next edit.
 *
 * **Portals** (D4 second feel-check fixes, 2026-09-28). The envelopes are
 * evaluated in `"ground"` mode (`earthworks.ts`, "Portals retain the hill"):
 * behind a tunnel portal the effective ground is the natural hill up to the
 * portal's retained skyline, trimmed at 45° above it, not the 3–5 m pit the
 * headwall from the track bed carved there before.
 */

/** A network revision's settled earthwork pieces, for the renderer to mesh (a new map per revision; never mutate it). */
export interface GroundView {
  readonly rev: number;
  readonly pieces: ReadonlyMap<PieceKey, EarthworkPiece>;
}

/** What the planner and validation read of the effective ground. */
export interface GroundQuery {
  /** The conformed height (m) at sim plan (x, y), NaN off the map; the query planes of the nodes in `clip` clip too. */
  heightM(x: number, y: number, clip?: ReadonlySet<string> | null): number;
  /** The ground at node (q, r) in integer mm: the water surface over a lower bed, else the conformed height; undefined off the map. */
  nodeMm(q: number, r: number, clip?: ReadonlySet<string> | null): number | undefined;
  /** The conformed height at node (q, r) in integer mm, ignoring water (rule 4's cover and abutments); undefined off the map. */
  nodeEarthMm(q: number, r: number, clip?: ReadonlySet<string> | null): number | undefined;
  /** Whether any earthwork piece may move the ground inside the plan box (m): its reach box meets it. */
  meets(minX: number, minY: number, maxX: number, maxY: number): boolean;
}

/** The track after an edit, as the planes read it: the pieces at each node (plain track: at most two), and the pieces. */
export interface GroundTopology {
  readonly nodes: ReadonlyMap<string, readonly { readonly key: PieceKey }[]>;
  readonly pieces: ReadonlyMap<PieceKey, Piece>;
}

const CELL_M = 32;

function cellKey(cx: number, cy: number): number {
  return (cy + 2048) * 4096 + (cx + 2048);
}

/** What the rule needs of a core piece: its centreline, heights and structure (arc length 0 is `ends[0]`). */
export function earthworkInput(p: Piece): PieceInput {
  const [a, b] = p.ends;
  return { key: p.key, prims: p.prims, z0Mm: a.node.zMm, z1Mm: b.node.zMm, structure: p.structure };
}

/** The track's chains as `chainPlanes` walks them, from the track index. */
export function topologyAdjacency(topology: GroundTopology): ChainAdjacency {
  const endKey = (key: string, end: 0 | 1): string => {
    const piece = topology.pieces.get(key);
    return piece ? nodeKey(piece.ends[end].node) : "";
  };
  return {
    next(key, end) {
      const k = endKey(key, end);
      if (k === "") return undefined;
      const others = (topology.nodes.get(k) ?? []).filter((e) => e.key !== key);
      if (others.length === 0) return "buffer";
      const other = others.length === 1 ? topology.pieces.get(others[0]?.key ?? "") : undefined;
      if (!other) return undefined;
      return { key: other.key, end: nodeKey(other.ends[0].node) === k ? 0 : 1 };
    },
    nodeKey: endKey,
    structure: (key) => topology.pieces.get(key)?.structure,
  };
}

export class EffectiveGround implements GroundQuery {
  private readonly pieces = new Map<PieceKey, EarthworkPiece>();
  private readonly bridgeCuts = new Map<PieceKey, boolean>();
  private readonly cells = new Map<number, Set<PieceKey>>();
  private readonly cellsOf = new Map<PieceKey, readonly number[]>();
  private readonly nodeCache = new Map<number, number>();
  private cachedView: GroundView | undefined;
  private readonly near = { d: 0, s: 0 };
  private readonly envelope: Envelope = { u: 0, l: 0, d: 0 };
  private readonly found: EarthworkPiece[] = [];

  constructor(
    readonly terrain: Terrain,
    pieces: Iterable<Piece> = [],
    topology?: GroundTopology,
  ) {
    const all = [...pieces];
    if (all.length > 0 && topology) this.apply([], all, topology);
  }

  /** The revision's settled pieces for the renderer; the same object until the next `apply`. */
  view(rev: number): GroundView {
    if (!this.cachedView || this.cachedView.rev !== rev) this.cachedView = Object.freeze({ rev, pieces: new Map(this.pieces) });
    return this.cachedView;
  }

  /** The settled piece of a key, or undefined (tests). */
  piece(key: PieceKey): EarthworkPiece | undefined {
    return this.pieces.get(key);
  }

  get size(): number {
    return this.pieces.size;
  }

  /**
   * Brings the pieces in step with an edit: `removed` left and `added` arrived (`topology` is the track after it).
   * Settles the reaches beside the edit, then re-derives the planes of every earthwork piece on the chains through
   * the nodes the edit touched.
   */
  apply(removed: readonly Piece[], added: readonly Piece[], topology: GroundTopology): void {
    let anyRemoved = false;
    for (const p of removed) {
      if (!this.pieces.has(p.key)) continue;
      this.pieces.delete(p.key);
      this.unindex(p.key);
      anyRemoved = true;
    }
    const arrivals: EarthworkPiece[] = [];
    for (const p of added) {
      if (!this.takes(p)) continue;
      arrivals.push(earthworkPiece(this.terrain, earthworkInput(p)));
    }
    const changed = arrivals.length > 0 || anyRemoved ? this.settle(arrivals, anyRemoved) : new Set<PieceKey>();
    for (const a of arrivals) changed.add(a.key);
    const adjacency = topologyAdjacency(topology);
    const seeds = new Set<PieceKey>();
    for (const p of [...removed, ...added]) {
      for (const end of p.ends) for (const entry of topology.nodes.get(nodeKey(end.node)) ?? []) seeds.add(entry.key);
    }
    for (const key of this.chainNear(seeds, adjacency)) {
      const piece = this.pieces.get(key);
      if (!piece) continue;
      const next = withPlanes(piece, chainPlanes(piece, this.pieces, adjacency));
      if (next === piece) continue;
      this.pieces.set(key, next);
      changed.add(key);
    }
    for (const key of changed) {
      const piece = this.pieces.get(key);
      this.unindex(key);
      if (piece) this.index(piece);
    }
    this.nodeCache.clear();
    this.cachedView = undefined;
  }

  heightM(x: number, y: number, clip: ReadonlySet<string> | null = null): number {
    const natural = naturalHeightAtM(this.terrain, x, y);
    if (Number.isNaN(natural)) return natural;
    const near = this.candidates(x, y);
    if (near.length === 0) return natural;
    let u = Infinity;
    let l = -Infinity;
    const e = this.envelope;
    for (const p of near) {
      if (!envelopeAt(p, p, x, y, clip, this.near, e, "ground")) continue;
      if (e.u < u) u = e.u;
      if (e.l > l) l = e.l;
    }
    return conformRule(natural, u, l);
  }

  nodeMm(q: number, r: number, clip: ReadonlySet<string> | null = null): number | undefined {
    const water = groundMmAt(this.terrain, { q, r });
    if (water === undefined) return undefined;
    const o = offsetOfNode(this.terrain, { q, r });
    const i = o === undefined ? -1 : o.row * this.terrain.columns + o.col;
    // Over water the planner's ground is the surface, as before (the sim's water never changes).
    if (i >= 0 && this.terrain.water[i] === 1 && this.terrain.waterLevelDm > (this.terrain.heightsDm[i] ?? 0)) return water;
    return this.nodeEarthMm(q, r, clip);
  }

  nodeEarthMm(q: number, r: number, clip: ReadonlySet<string> | null = null): number | undefined {
    const o = offsetOfNode(this.terrain, { q, r });
    if (o === undefined) return undefined;
    const naturalMm = (this.terrain.heightsDm[o.row * this.terrain.columns + o.col] ?? 0) * 100;
    const w = toWorld({ q, r });
    const near = this.candidates(w.x, w.y);
    if (near.length === 0) return naturalMm;
    const clipped = clip !== null && clip.size > 0 && near.some((p) => p.planes.some((c) => !c.fixed && clip.has(c.key)));
    const cacheKey = (r + 2048) * 8192 + (q + 4096);
    if (!clipped) {
      const hit = this.nodeCache.get(cacheKey);
      if (hit !== undefined) return hit;
    }
    const h = this.heightM(w.x, w.y, clipped ? clip : null);
    const mm = Number.isNaN(h) ? naturalMm : Math.round(h * 1000);
    if (!clipped) this.nodeCache.set(cacheKey, mm);
    return mm;
  }

  meets(minX: number, minY: number, maxX: number, maxY: number): boolean {
    if (this.pieces.size === 0) return false;
    const cx0 = Math.floor(minX / CELL_M);
    const cx1 = Math.floor(maxX / CELL_M);
    const cy0 = Math.floor(minY / CELL_M);
    const cy1 = Math.floor(maxY / CELL_M);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const set = this.cells.get(cellKey(cx, cy));
        if (!set) continue;
        for (const key of set) {
          const p = this.pieces.get(key);
          if (p && !(p.maxX < minX || p.minX > maxX || p.maxY < minY || p.minY > maxY)) return true;
        }
      }
    }
    return false;
  }

  /** The pieces whose LOD0 reach box holds (x, y), in a reused array. */
  private candidates(x: number, y: number): readonly EarthworkPiece[] {
    const out = this.found;
    out.length = 0;
    const set = this.cells.get(cellKey(Math.floor(x / CELL_M), Math.floor(y / CELL_M)));
    if (!set) return out;
    for (const key of set) {
      const p = this.pieces.get(key);
      if (p && x >= p.minX && x <= p.maxX && y >= p.minY && y <= p.maxY) out.push(p);
    }
    return out;
  }

  private index(p: EarthworkPiece): void {
    const cells: number[] = [];
    const cx0 = Math.floor(p.minX / CELL_M);
    const cx1 = Math.floor(p.maxX / CELL_M);
    const cy0 = Math.floor(p.minY / CELL_M);
    const cy1 = Math.floor(p.maxY / CELL_M);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = cellKey(cx, cy);
        let set = this.cells.get(k);
        if (!set) {
          set = new Set();
          this.cells.set(k, set);
        }
        set.add(p.key);
        cells.push(k);
      }
    }
    this.cellsOf.set(p.key, cells);
  }

  private unindex(key: PieceKey): void {
    for (const k of this.cellsOf.get(key) ?? []) {
      const set = this.cells.get(k);
      if (!set) continue;
      set.delete(key);
      if (set.size === 0) this.cells.delete(k);
    }
    this.cellsOf.delete(key);
  }

  /** Whether the rule takes a piece: ground always, a bridge where the ground comes near its deck. */
  private takes(p: Piece): boolean {
    if (p.structure === "tunnel") return false;
    const input = earthworkInput(p);
    if (conforms(input)) return true;
    let cut = this.bridgeCuts.get(p.key);
    if (cut === undefined) {
      cut = cutsUnderDeck(this.terrain, input);
      this.bridgeCuts.set(p.key, cut);
    }
    return cut;
  }

  /**
   * The earthwork pieces on the chains through `seeds` within MAX_REACH_M (plus a piece) along the track either way:
   * the pieces whose planes an edit at the seeds may change.
   */
  private chainNear(seeds: ReadonlySet<PieceKey>, adjacency: ChainAdjacency): Set<PieceKey> {
    const out = new Set<PieceKey>();
    for (const seed of seeds) {
      if (this.pieces.has(seed)) out.add(seed);
      for (const start of [0, 1] as const) {
        let key = seed;
        let end: 0 | 1 = start;
        let walked = 0;
        for (let guard = 0; guard < 10_000; guard++) {
          const next = adjacency.next(key, end);
          if (next === undefined || next === "buffer") break;
          const piece = this.pieces.get(next.key);
          if (!piece || next.key === seed) break;
          out.add(next.key);
          walked += piece.lengthM;
          if (walked > MAX_REACH_M + piece.lengthM) break;
          key = next.key;
          end = next.end === 0 ? 1 : 0;
        }
      }
    }
    return out;
  }

  /**
   * Re-derives the reaches beside an edit (the renderer's view did this until the rule moved here): every kept
   * piece an arrival may neighbour re-examines its reach, and after a removal every piece a neighbour had raised
   * starts again from its natural reach. Returns the keys whose piece changed.
   */
  private settle(added: readonly EarthworkPiece[], removed: boolean): Set<PieceKey> {
    const changed = new Set<PieceKey>();
    const kept = this.pieces.size;
    const list = [...this.pieces.values(), ...added];
    const reach0 = Float64Array.from(list, (p) => p.reachM);
    const reach1 = Float64Array.from(list, (p) => p.lod1.reachM);
    const work: number[] = [];
    for (let i = 0; i < kept; i++) {
      const p = list[i];
      if (!p) continue;
      if (removed && (p.reachM !== p.naturalReachM[0] || p.lod1.reachM !== p.naturalReachM[1])) {
        reach0[i] = p.naturalReachM[0];
        reach1[i] = p.naturalReachM[1];
        work.push(i);
        continue;
      }
      for (const a of added) {
        if (mayNeighbour(p, a)) {
          work.push(i);
          break;
        }
      }
    }
    for (let i = kept; i < list.length; i++) work.push(i);
    settleReaches(this.terrain, list, reach0, reach1, work);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p) continue;
      // A capped piece's cap rise depends on its neighbours even when its reach stays at the cap.
      const capped = (reach0[i] ?? 0) >= MAX_REACH_M || (reach1[i] ?? 0) >= MAX_REACH_M || p.capRiseM > 0 || p.lod1.capRiseM > 0;
      if (i < kept && !capped && reach0[i] === p.reachM && reach1[i] === p.lod1.reachM) continue;
      const settled = settledPiece(this.terrain, list, reach0, reach1, i) ?? p;
      if (i < kept && settled === p) continue;
      this.pieces.set(p.key, settled);
      changed.add(p.key);
    }
    return changed;
  }
}

/** The ground of node n for rule 4 (earth, ignoring water): the effective ground when given, else the terrain. */
export function nodeGroundMm(t: Terrain, n: { readonly q: number; readonly r: number }, ground: GroundQuery | null | undefined, clip: ReadonlySet<string> | null): number | undefined {
  if (ground) return ground.nodeEarthMm(n.q, n.r, clip);
  const o = offsetOfNode(t, n);
  return o === undefined ? undefined : (t.heightsDm[o.row * t.columns + o.col] ?? 0) * 100;
}

/** A node's key when the committed track has it (`nodes` is the track index's), for a command's clip set. */
export function committedKey(nodes: ReadonlyMap<string, unknown>, n: NodeRef): string | undefined {
  const k = nodeKey(n);
  return nodes.has(k) ? k : undefined;
}
