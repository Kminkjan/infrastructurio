import type { Structure } from "../geometry/piece";
import { centrelineEnds, centrelineIndex, nearestOnCentreline, sampleCentrelineEvery } from "../geometry/sample";
import type { RenderPrim } from "../geometry/templates";
import { LATTICE_SPACING_M, SQRT3 } from "../lattice";
import type { Terrain } from "../terrain";

/**
 * Earthworks: the cuttings and embankments under ground track, one rule the
 * core owns (D4 feel-check fixes, after the owner's feel check of 2026-09-28,
 * "Not yet"). Until then the rule lived in the renderer (earthworks-lite, owner
 * decision 2026-09-27; ADR 0010's earthworks-lite and render pass iteration
 * findings) while the core judged structures against the natural terrain, so
 * a drag beside an existing cutting became a tunnel under ground that was no
 * longer drawn. Now the rule is a pure function of the terrain and the
 * authored pieces: `track/ground.ts` keeps it in step with the network for the
 * planner, validation and the track tool (the effective ground), and the
 * renderer meshes the same pieces through `sim/api.ts`. The rule itself moved
 * unchanged; the one new part is the end clip below.
 *
 * **The conformed surface.** For every ground-structure piece, with d the plan
 * distance from its centreline and z the track height at the nearest centreline
 * point (linear in arc length, as the track meshes draw it), the side slope
 * rises e(d) = ease(d − W) / S beside a flat formation: W = 3 m is the
 * formation's half width (a 6 m bed under the 4.4 m ballast base), S = 1.5 the
 * slopes' run per unit rise (1 : 1.5, about 34°), and `ease` bends the slope in
 * over CREST_ROUND_M past the formation edge (0, then x² / 2b, then x − b/2), so
 * crests and toes are rounded rather than kinked. Then
 * - the cut envelope U = z + e(d) bounds the terrain from above;
 * - the fill envelope L = z − e(d) bounds it from below.
 * Over all pieces, U is the lowest and L the highest envelope. The conformed
 * height clamps the natural surface N between them, C = min(U, max(N, L)), with
 * a smooth clamp at the daylight line (a polynomial smooth minimum over
 * DAYLIGHT_ROUND_M of height, narrowed on shallow ground) so the slope blends
 * into natural ground instead of meeting it at a kink. C never exceeds U (cuts
 * always win, so no fill and no other track's embankment can rise over a track)
 * and equals the bed exactly on the formation. Moves up to EARTHWORK_MIN_M stay
 * natural, blending in fully by twice that, so there is no step at the edge.
 * Fills continue their slope under water (the opaque water plane hides them),
 * so a bank meets the shore as a slope, not a shelf with vertical steps.
 *
 * **Ends at structures** (D4 feel-check fixes, 2026-09-28). Around an end node
 * the nearest centreline point is the node itself, so a piece's cut and fill
 * round off in a cone there, and along a chain each piece's cone reaches past
 * the chain's end too: the rounded end of a cutting at a buffer. Where the track
 * goes on as a bridge or a tunnel, those cones ran on under the bridge's first
 * span (the abutment cone the D4 render recorded) or carved a bowl into the
 * hill behind the portal, which the hill plug refilled from the natural ground,
 * over a neighbour's cutting too (the owner's tear). So every earthwork piece
 * carries the clip planes of its chain's ends within MAX_REACH_M along the
 * track (`ClipPlane`, `chainPlanes`): the plane through the end node square to
 * the track. A structure end's plane always clips (`fixed`): past it by t, a
 * piece's envelopes are those at the point's foot on the plane, the cut raised
 * and the fill lowered by HEADWALL_RISE · t, a 45° headwall behind the
 * portal face or the abutment (`envelopeAt`). A buffer end's
 * plane clips only a query that names its node (a command continuing from it),
 * and then hard: past it the chain moves nothing, as if it ended there, since
 * whatever the command continues with, a structure clips there and ground
 * track's own section covers the cone (`ground.ts`). Clipping only raises U and
 * lowers L (or drops a piece), so every reach bound below still holds.
 *
 * **Bridges: a cut only** (D4, owner decision 2026-09-28 "M2": a deck may sit
 * up to 2 m below the terrain within 15 m of an abutment). A bridge piece whose
 * deck the natural ground comes near (within DAYLIGHT_ROUND_M of its lowest bed,
 * anywhere its cut could reach: `cutsUnderDeck`) takes the cut envelope U and
 * no fill, so the ground is cut down to the deck where it would stand over it,
 * with the same 1 : 1.5 slopes, and never raised under a bridge. A deck clear of
 * the ground moves nothing, and tunnels never enter the rule.
 *
 * Floats in metres, as in `clearance.ts` and `structure.ts`: the rule decides
 * only at commit time (a command's inferred structures, stored with its
 * pieces) and in the planner, never in the step; `ground.ts` rounds heights
 * that feed node keys to integer mm. Curve maths is `geometry/sample.ts`'s.
 */

/** Half width of the flat formation (bed) each side of the centreline. */
export const FORMATION_HALF_WIDTH_M = 3;
/** Side slopes: horizontal run per unit rise (1 : 1.5, about 33.7°), for cuts and fills alike. */
export const SIDE_SLOPE_RUN = 1.5;
/** The side slope eases in over this plan band past the formation edge: a rounded crest or toe, not a kink. */
export const CREST_ROUND_M = 2;
/** Height band of the smooth clamp where a slope meets natural ground (the daylight line and the toe). */
export const DAYLIGHT_ROUND_M = 0.6;
/** The bed lies at the track height, 0.15 m under the drawn ballast top (TRACK_LIFT_M), so the ballast reads. */
export const BED_BELOW_TRACK_M = 0;
/** Departures from the natural ground up to this size are left natural; from twice this they are drawn in full. */
export const EARTHWORK_MIN_M = 0.05;

/**
 * Reach cap: beyond about 78 m of cut or fill the slope cannot reach natural ground (none on the diorama map, but
 * the track tool's height steps have no bound, so ground track can stand 90 m up). A capped piece's side slope
 * steepens over the last CAP_FADE_M before the cap until its envelopes clear the ground there, so the drawn face
 * stays continuous (steep, not a vertical wall; PR #83 re-review).
 */
export const MAX_REACH_M = 120;
export const CAP_FADE_M = 10;
/**
 * The LOD1 reach scans the relief this much wider: a 10 m LOD1 triangle interpolates corners up to one LOD1 cell
 * past any plan box, which the LOD0 node scan (one LOD0 step of slack) does not see.
 */
export const LOD1_SCAN_MARGIN_M = 2 * LATTICE_SPACING_M;
/** Only ground structure gets full earthworks; bridges near the ground get a cut only (`cutsUnderDeck`), tunnels none. */
const CONFORMED: ReadonlySet<Structure> = new Set(["ground"]);

const HALF_SQRT3 = SQRT3 / 2;

/** What the conform needs of a piece (a `NetworkPiece` has this shape). */
export interface PieceInput {
  readonly key: string;
  readonly prims: readonly RenderPrim[];
  readonly z0Mm: number;
  readonly z1Mm: number;
  readonly structure?: Structure;
}

/** How far a piece's earthworks can reach at one LOD, and its centreline's plan box grown by that. */
export interface PieceReach {
  /** Plan distance beyond which the piece cannot move the terrain. */
  readonly reachM: number;
  /**
   * Extra side-slope rise at the reach, faded in over its last CAP_FADE_M (`riseAt`): 0 unless the reach is capped
   * at MAX_REACH_M, where it lifts the cut envelope (and lowers the fill) clear of the ground and the neighbours.
   */
  readonly capRiseM: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** A piece prepared for the conform: its centreline, heights and how far its earthworks can reach (LOD0 here, LOD1 in `lod1`). */
export interface EarthworkPiece extends PieceReach {
  readonly key: string;
  /** A bridge: the cut envelope only, never a fill (see the module comment). */
  readonly cutOnly: boolean;
  readonly prims: readonly RenderPrim[];
  readonly lengthM: number;
  readonly z0M: number;
  readonly z1M: number;
  /** Arc length at each prim's start. */
  readonly primStartM: Float64Array;
  /** Arc prims' end points (sx, sy, ex, ey per prim; unused for lines). */
  readonly arcEnds: Float64Array;
  /** The reach at LOD1 (at least the LOD0 reach): sized from the relief scan widened by LOD1_SCAN_MARGIN_M. */
  readonly lod1: PieceReach;
  /** The centreline's own plan box (the reach boxes grow it), for skipping points out of reach. */
  readonly centreBox: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
  /**
   * The reach at LOD0 and LOD1 from the natural relief alone (`earthworkPiece`), where `settleReaches` starts
   * before it folds in the neighbours' beds; the reach fields above equal these until a piece is settled.
   */
  readonly naturalReachM: readonly [number, number];
  /**
   * Bed points along the centreline at most NEIGHBOUR_SAMPLE_M apart (x, y, z per point, ends included): what
   * another piece's reach search reads to bound this piece's cut and fill envelopes near it.
   */
  readonly bedSamples: Float64Array;
  /** The centreline's end frames (`centrelineEnds`): x, y and the unit tangent out of the piece, at s = 0 and at s = lengthM. */
  readonly ends: Float64Array;
  /** The clip planes of its chain's ends within MAX_REACH_M along the track (`chainPlanes`; see the module comment). */
  readonly planes: readonly ClipPlane[];
}

/**
 * A chain end's clip plane: the end node (x, y), the unit normal (tx, ty) pointing out of the chain (the side past
 * the plane has t > 0), the node's key ("q,r,zMm"; "" when unknown), and whether it always clips (a bridge or tunnel
 * goes on there) or only for a query naming `key` (a buffer end).
 */
export interface ClipPlane {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly tx: number;
  readonly ty: number;
  readonly fixed: boolean;
}

/** The renderer's terrain LODs: 0 (the 5 m lattice) and 1 (10 m), whose reach scans the relief wider. */
export type EarthworkLod = 0 | 1;

/** The piece's reach at a LOD. */
export function reachAt(p: EarthworkPiece, lod: EarthworkLod): PieceReach {
  return lod === 0 ? p : p.lod1;
}

export function conforms(piece: PieceInput): boolean {
  return piece.structure === undefined || CONFORMED.has(piece.structure);
}

/** The highest bed a piece's fill envelope stands on: −Infinity for a cut-only piece, whose fill is none. */
function fillBedMax(p: { readonly z0M: number; readonly z1M: number; readonly cutOnly: boolean }): number {
  return p.cutOnly ? Number.NEGATIVE_INFINITY : p.z0M < p.z1M ? p.z1M : p.z0M;
}

/**
 * Whether a bridge piece takes a cut (the module comment): the natural ground anywhere its cut envelope could
 * reach, at either LOD, rises within DAYLIGHT_ROUND_M of its lowest bed. Below that the envelope lies more than the
 * smooth clamp's band over every natural height it reaches, so it would move nothing. False for any other piece.
 */
export function cutsUnderDeck(terrain: Terrain, piece: PieceInput): boolean {
  if (piece.structure !== "bridge") return false;
  const c = centrelineIndex(piece);
  const bedMin = Math.min(piece.z0Mm, piece.z1Mm) / 1000 - BED_BELOW_TRACK_M;
  const reach1 = convergedReach(terrain, c, bedMin, Number.NEGATIVE_INFINITY, reachForRelief(0), LOD1_SCAN_MARGIN_M);
  const grow = reach1 + LOD1_SCAN_MARGIN_M;
  return naturalRange(terrain, c.minX - grow, c.minY - grow, c.maxX + grow, c.maxY + grow).max > bedMin - DAYLIGHT_ROUND_M;
}

/** Whether the conform takes a piece at all: ground (full earthworks) or a bridge near the ground (a cut only). */
export function takesEarthworks(terrain: Terrain, piece: PieceInput): boolean {
  return conforms(piece) || cutsUnderDeck(terrain, piece);
}

/**
 * Prepares a piece: its centreline index (prim lengths, arc ends and plan box,
 * all from `geometry/sample.ts`), and its reach at each LOD from the natural
 * relief around it (`convergedReach`). A piece drawn beside others also needs
 * their beds folded in (`settleReaches`; `earthworkPieces` does both).
 */
export function earthworkPiece(terrain: Terrain, piece: PieceInput, planes: readonly ClipPlane[] = NO_PLANES): EarthworkPiece {
  const c = centrelineIndex(piece);
  const z0M = piece.z0Mm / 1000 - BED_BELOW_TRACK_M;
  const z1M = piece.z1Mm / 1000 - BED_BELOW_TRACK_M;
  const cutOnly = piece.structure === "bridge";
  const bedMin = Math.min(z0M, z1M);
  const bedMax = fillBedMax({ z0M, z1M, cutOnly });
  const reach = convergedReach(terrain, c, bedMin, bedMax, reachForRelief(2), 0);
  // LOD1's fixed point lies at or past LOD0's (its scan is wider), so its search starts there.
  const reach1 = convergedReach(terrain, c, bedMin, bedMax, reach, LOD1_SCAN_MARGIN_M);
  const cap0 = reach < MAX_REACH_M ? 0 : naturalCapRise(terrain, c, bedMin, bedMax, 0);
  const cap1 = reach1 < MAX_REACH_M ? 0 : naturalCapRise(terrain, c, bedMin, bedMax, LOD1_SCAN_MARGIN_M);
  return withReach(
    {
      key: piece.key,
      cutOnly,
      prims: c.prims,
      lengthM: c.lengthM,
      z0M,
      z1M,
      primStartM: c.primStartM,
      arcEnds: c.arcEnds,
      centreBox: { minX: c.minX, minY: c.minY, maxX: c.maxX, maxY: c.maxY },
      naturalReachM: [reach, reach1],
      bedSamples: bedSamplesOf(piece, c.lengthM, z0M, z1M),
      ends: centrelineEnds(piece),
      planes,
    },
    reach,
    reach1,
    cap0,
    cap1,
  );
}

/** The piece with reaches `reach` (LOD0) and `reach1` (LOD1), their cap rises and their boxes; everything else is shared. */
export function withReach(p: Omit<EarthworkPiece, keyof PieceReach | "lod1">, reach: number, reach1: number, cap0 = 0, cap1 = 0): EarthworkPiece {
  const { minX, minY, maxX, maxY } = p.centreBox;
  return {
    key: p.key,
    cutOnly: p.cutOnly,
    prims: p.prims,
    lengthM: p.lengthM,
    z0M: p.z0M,
    z1M: p.z1M,
    primStartM: p.primStartM,
    arcEnds: p.arcEnds,
    reachM: reach,
    capRiseM: cap0,
    minX: minX - reach,
    minY: minY - reach,
    maxX: maxX + reach,
    maxY: maxY + reach,
    lod1: { reachM: reach1, capRiseM: cap1, minX: minX - reach1, minY: minY - reach1, maxX: maxX + reach1, maxY: maxY + reach1 },
    centreBox: p.centreBox,
    naturalReachM: p.naturalReachM,
    bedSamples: p.bedSamples,
    ends: p.ends,
    planes: p.planes,
  };
}

/** No clip plane. */
export const NO_PLANES: readonly ClipPlane[] = Object.freeze([]);

function samePlanes(a: readonly ClipPlane[], b: readonly ClipPlane[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => {
    const q = b[i];
    return q !== undefined && p.key === q.key && p.x === q.x && p.y === q.y && p.tx === q.tx && p.ty === q.ty && p.fixed === q.fixed;
  });
}

/** The piece with clip planes `planes` (the same object when they are unchanged). */
export function withPlanes(p: EarthworkPiece, planes: readonly ClipPlane[]): EarthworkPiece {
  if (samePlanes(p.planes, planes)) return p;
  return { ...p, planes: planes.length === 0 ? NO_PLANES : planes };
}

/** One step along a chain: piece `key`, entered at its end `end` (0 at arc length 0, 1 at the far end). */
export interface ChainStep {
  readonly key: string;
  readonly end: 0 | 1;
}

/** What `chainPlanes` reads of the track around a piece: the world's track index or a network view. */
export interface ChainAdjacency {
  /** What goes on past piece `key`'s end `end`: the next piece, "buffer" at a free end, or undefined at a junction. */
  next(key: string, end: 0 | 1): ChainStep | "buffer" | undefined;
  /** The key of the node at piece `key`'s end `end` ("q,r,zMm"), or "" when unknown. */
  nodeKey(key: string, end: 0 | 1): string;
  structure(key: string): Structure | undefined;
}

/**
 * The clip planes of piece `p`'s chain ends (see the module comment): walking the track both ways from `p` through
 * pieces of its own structure that take earthworks (`pieces`), up to MAX_REACH_M, the first node where the
 * structure changes gives a fixed plane and a buffer end a query plane; a junction, a piece of the same structure
 * without earthworks (a deck clear of the ground) or the distance ends the walk without one. Each plane lies at the
 * last earthwork piece's end, square to the track there.
 */
export function chainPlanes(p: EarthworkPiece, pieces: ReadonlyMap<string, EarthworkPiece>, adj: ChainAdjacency): readonly ClipPlane[] {
  const structure = adj.structure(p.key);
  let out: ClipPlane[] | null = null;
  for (const start of [0, 1] as const) {
    let cur = p;
    let curEnd: 0 | 1 = start;
    let walked = 0;
    for (let guard = 0; guard < 10_000; guard++) {
      const next = adj.next(cur.key, curEnd);
      if (next === undefined) break;
      const s = next === "buffer" ? undefined : adj.structure(next.key);
      if (next === "buffer" || s !== structure) {
        const k = curEnd === 0 ? 0 : 4;
        const e = cur.ends;
        (out ??= []).push({ key: adj.nodeKey(cur.key, curEnd), x: e[k] ?? 0, y: e[k + 1] ?? 0, tx: e[k + 2] ?? 0, ty: e[k + 3] ?? 0, fixed: next !== "buffer" });
        break;
      }
      const q = pieces.get(next.key);
      if (!q || q === p) break;
      walked += q.lengthM;
      if (walked > MAX_REACH_M) break;
      cur = q;
      curEnd = next.end === 0 ? 1 : 0;
    }
  }
  return out ?? NO_PLANES;
}

function bedSamplesOf(piece: PieceInput, lengthM: number, z0M: number, z1M: number): Float64Array {
  const points = sampleCentrelineEvery(piece, NEIGHBOUR_SAMPLE_M);
  const out = new Float64Array(3 * points.length);
  points.forEach((p, i) => {
    out[3 * i] = p.x;
    out[3 * i + 1] = p.y;
    out[3 * i + 2] = lengthM > 0 ? z0M + ((z1M - z0M) * p.sM) / lengthM : z0M;
  });
  return out;
}

/**
 * The reach for a relief (m, the natural ground's largest height above or below the bed): the daylight line lies
 * where e(d) reaches the relief, d = W + b/2 + S·relief once the slope is straight; its smooth clamp reaches
 * DAYLIGHT_ROUND_M of height further out, plus a metre of margin.
 */
function reachForRelief(relief: number): number {
  return FORMATION_HALF_WIDTH_M + CREST_ROUND_M / 2 + SIDE_SLOPE_RUN * (relief + DAYLIGHT_ROUND_M) + 1;
}

/**
 * Neighbour checks (`settledReach`): bed samples at most NEIGHBOUR_SAMPLE_M apart along each centreline, and the
 * grid of REACH_STEP_M a reach moves on once a neighbour needs more than the natural relief. The grid makes the
 * candidate reaches a finite set, so settling ends and its result does not depend on the order pieces settle in.
 */
export const NEIGHBOUR_SAMPLE_M = 0.5;
export const REACH_STEP_M = 0.25;
const near = { d: 0, s: 0 };
/** The largest shortfall (m) the last `neighbourShortfall` found, for a capped piece's cap rise. */
const shortfall = { worst: 0 };

type Box = { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };

/**
 * Grows the reach from `start` until the relief inside the centreline's box grown by it (and by `margin`) needs
 * no more: a fixed point, so the daylight line and its smooth clamp end inside the reach and the drawn ground
 * cannot step back to natural at it. (Round 1 stopped after 8 passes without rescanning the last growth, which on
 * a long slope near 1 : 1.5 could leave a ledge; PR #83 review.) It ends: the reach only grows, is capped at
 * MAX_REACH_M, and each value comes from a node height in a finite map.
 */
function convergedReach(t: Terrain, box: Box, bedMin: number, bedMax: number, start: number, margin: number): number {
  let reach = start;
  for (;;) {
    const need = naturalNeed(t, box, bedMin, bedMax, reach, margin);
    if (need <= reach) return reach;
    reach = need;
  }
}

/** The reach the natural relief inside the centreline's box grown by `reach` (and by `margin`) needs. */
function naturalNeed(t: Terrain, box: Box, bedMin: number, bedMax: number, reach: number, margin: number): number {
  const grow = reach + margin;
  const range = naturalRange(t, box.minX - grow, box.minY - grow, box.maxX + grow, box.maxY + grow);
  return Math.min(MAX_REACH_M, reachForRelief(Math.max(0, range.max - bedMin, bedMax - range.min)));
}

/**
 * The extra rise a piece capped at MAX_REACH_M needs at the cap so its envelopes clear the natural relief there by
 * the margin `reachForRelief` gives (DAYLIGHT_ROUND_M plus a metre of run).
 */
function naturalCapRise(t: Terrain, box: Box, bedMin: number, bedMax: number, margin: number): number {
  const grow = MAX_REACH_M + margin;
  const range = naturalRange(t, box.minX - grow, box.minY - grow, box.maxX + grow, box.maxY + grow);
  const relief = Math.max(0, range.max - bedMin, bedMax - range.min);
  return Math.max(0, relief + DAYLIGHT_ROUND_M + 1 / SIDE_SLOPE_RUN - slopeRiseM(MAX_REACH_M));
}

/**
 * How far a cut from bed height `zM` at plan point (x, y) reaches through the natural relief around it: the reach a
 * ground piece's rounded end has there (`convergedReach` for a point, cut only). The hill plug behind a tunnel portal
 * sizes itself by it, so it covers the approach cutting's whole rounded end however the hill rises behind the face.
 */
export function pointCutReachM(terrain: Terrain, x: number, y: number, zM: number): number {
  return convergedReach(terrain, { minX: x, minY: y, maxX: x, maxY: y }, zM - BED_BELOW_TRACK_M, Number.NEGATIVE_INFINITY, reachForRelief(0), 0);
}

/** Whether box `a` grown by `grow` meets box `b`. */
function boxesMeet(a: Box, grow: number, b: Box): boolean {
  return !(a.maxX + grow < b.minX || a.minX - grow > b.maxX || a.maxY + grow < b.minY || a.minY - grow > b.maxY);
}

/**
 * Whether two pieces can take part in each other's settled reach (their reach boxes, either LOD, come within a
 * bed sample's spacing): the pieces a view re-examines around an arrival.
 */
export function mayNeighbour(a: EarthworkPiece, b: EarthworkPiece): boolean {
  const ra = a.reachM > a.lod1.reachM ? a.reachM : a.lod1.reachM;
  const rb = b.reachM > b.lod1.reachM ? b.reachM : b.lod1.reachM;
  return boxesMeet(a.centreBox, ra + rb + NEIGHBOUR_SAMPLE_M, b.centreBox);
}

/** The pieces a settle reads, their reaches at one LOD, and a coarse grid of their centreline boxes for lookups. */
class SettleSet {
  private static readonly CELL_M = 32;
  private readonly x0: number;
  private readonly y0: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly cells: number[][];
  private readonly stamp: Uint32Array;
  private gen = 0;
  /** The largest current reach: a lookup grows its box by it, so it finds every piece whose reach box it meets. */
  maxReach = 0;

  constructor(
    readonly pieces: readonly EarthworkPiece[],
    readonly reach: Float64Array,
  ) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pieces) {
      x0 = Math.min(x0, p.centreBox.minX);
      y0 = Math.min(y0, p.centreBox.minY);
      x1 = Math.max(x1, p.centreBox.maxX);
      y1 = Math.max(y1, p.centreBox.maxY);
    }
    const c = SettleSet.CELL_M;
    this.x0 = Number.isFinite(x0) ? x0 : 0;
    this.y0 = Number.isFinite(y0) ? y0 : 0;
    this.nx = Number.isFinite(x1) ? Math.floor((x1 - this.x0) / c) + 1 : 1;
    this.ny = Number.isFinite(y1) ? Math.floor((y1 - this.y0) / c) + 1 : 1;
    this.cells = Array.from({ length: this.nx * this.ny }, () => []);
    pieces.forEach((p, i) => {
      const [a, b, e, f] = this.range(p.centreBox, 0);
      for (let y = b; y <= f; y++) for (let x = a; x <= e; x++) this.cells[y * this.nx + x]?.push(i);
    });
    this.stamp = new Uint32Array(pieces.length);
    for (let i = 0; i < reach.length; i++) if ((reach[i] ?? 0) > this.maxReach) this.maxReach = reach[i] ?? 0;
  }

  private range(b: Box, grow: number): [number, number, number, number] {
    const c = SettleSet.CELL_M;
    const clamp = (v: number, n: number) => (v < 0 ? 0 : v >= n ? n - 1 : v);
    return [clamp(Math.floor((b.minX - grow - this.x0) / c), this.nx), clamp(Math.floor((b.minY - grow - this.y0) / c), this.ny), clamp(Math.floor((b.maxX + grow - this.x0) / c), this.nx), clamp(Math.floor((b.maxY + grow - this.y0) / c), this.ny)];
  }

  /** Visits, once each, every piece other than `self` whose centreline box comes within `grow` + its reach of `box`. */
  forNear(self: number, box: Box, grow: number, visit: (j: number, q: EarthworkPiece, qReach: number) => void): void {
    this.gen += 1;
    const [a, b, e, f] = this.range(box, grow + this.maxReach);
    for (let y = b; y <= f; y++) {
      for (let x = a; x <= e; x++) {
        for (const j of this.cells[y * this.nx + x] ?? []) {
          if (j === self || this.stamp[j] === this.gen) continue;
          this.stamp[j] = this.gen;
          const q = this.pieces[j];
          const qReach = this.reach[j] ?? 0;
          if (q && boxesMeet(q.centreBox, qReach + grow, box)) visit(j, q, qReach);
        }
      }
    }
  }
}

/**
 * How far past `reach` piece `self` must reach before every neighbour clears its cutoff, or 0 when all already do.
 * At the cutoff (plan distance `reach` from the centreline) the piece's cut envelope is at least its lowest bed plus
 * the side slope's rise there, and its fill at most its highest bed less that rise. Dropping them there changes
 * nothing only if every other piece's fill reaching that line lies DAYLIGHT_ROUND_M (the smooth clamp's band) under
 * that cut, and its cut that far over that fill; natural ground is `convergedReach`'s part. Where a higher track's
 * fill meets this piece's cut, "cuts win" draws the cut, so without this the drawn ground would jump from the cut to
 * the fill at the cutoff (PR #83 re-review). A neighbour's nearest centreline point to a point on the cutoff lies
 * within NEIGHBOUR_SAMPLE_M of a bed sample whose bed is at least as high (or low), and that sample lies at least
 * |d − reach| − NEIGHBOUR_SAMPLE_M from the cutoff (d, its distance from this centreline), which bounds the
 * neighbour's fill under the sample's bed less the side slope's rise over that gap, and its cut over the bed plus
 * it. A failing sample needs the reach to grow by its shortfall over 4/3 (the cut rises 2/3 per metre, the bound
 * falls at most as fast) or until it stops reaching the cutoff, whichever comes first: the lower bound returned.
 */
function neighbourShortfall(set: SettleSet, self: number, reach: number): number {
  shortfall.worst = 0;
  const p = set.pieces[self];
  if (!p) return 0;
  const rise = slopeRiseM(reach);
  const cutFloor = (p.z0M < p.z1M ? p.z0M : p.z1M) + rise - DAYLIGHT_ROUND_M;
  // A cut-only piece has no fill to drop, so a neighbour's cut can pass under it.
  const fillTop = fillBedMax(p) - rise + DAYLIGHT_ROUND_M;
  let need = 0;
  set.forNear(self, p.centreBox, reach + NEIGHBOUR_SAMPLE_M, (_j, q, qReach) => {
    // A neighbour whose beds all lie between the two bounds cannot fail (its fill lies under its bed, its cut over
    // it; a cut-only neighbour has no fill to rise over the cut).
    if (fillBedMax(q) <= cutFloor && (q.z0M < q.z1M ? q.z0M : q.z1M) >= fillTop) return;
    const b = q.bedSamples;
    for (let k = 0; k + 2 < b.length; k += 3) {
      const z = b[k + 2] ?? 0;
      if ((q.cutOnly || z <= cutFloor) && z >= fillTop) continue;
      const d = nearestOnCentreline(p, b[k] ?? 0, b[k + 1] ?? 0, near).d;
      const gap = (d > reach ? d - reach : reach - d) - NEIGHBOUR_SAMPLE_M;
      if (gap >= qReach) continue;
      const e = slopeRiseM(gap);
      const short = Math.max(q.cutOnly ? Number.NEGATIVE_INFINITY : z - e - cutFloor, fillTop - (z + e));
      if (short <= 0) continue;
      if (short > shortfall.worst) shortfall.worst = short;
      const until = Math.min(reach + (short * SIDE_SLOPE_RUN) / 2, d + NEIGHBOUR_SAMPLE_M + qReach);
      if (until > need) need = until;
    }
  });
  return need;
}

/**
 * The settled reach of piece `self` at one LOD with its neighbours at their current reaches, searched from `from`
 * (its natural reach, or a settled reach found earlier with fewer or smaller neighbours): the natural reach itself
 * when every neighbour clears it, else the least REACH_STEP_M multiple above it where both the natural relief and
 * every neighbour pass. The search never skips a passing multiple, so it returns the same reach from either start.
 */
function settledReach(t: Terrain, set: SettleSet, self: number, margin: number, from: number): number {
  const p = set.pieces[self];
  if (!p) return from;
  const bedMin = p.z0M < p.z1M ? p.z0M : p.z1M;
  const bedMax = fillBedMax(p);
  let reach = from;
  for (;;) {
    if (reach >= MAX_REACH_M) return MAX_REACH_M;
    const need = naturalNeed(t, p.centreBox, bedMin, bedMax, reach, margin);
    const next = need > reach ? need : neighbourShortfall(set, self, reach);
    if (next <= reach) return reach;
    reach = Math.min(MAX_REACH_M, Math.ceil(next / REACH_STEP_M) * REACH_STEP_M);
  }
}

/**
 * Settles the reaches of `pieces` beside each other, per LOD (`settledReach`). `reach0` and `reach1` hold the
 * current reaches (in and out): each piece's natural reach, or a settled one from an earlier settle of fewer
 * pieces. `work` names the pieces to re-examine first; every piece whose reach grows queues the pieces it may now
 * reach. Reaches only grow over a finite set of values, so it ends, and the result is the least settled reaches at
 * or above the start whatever the order: a view that starts from its earlier reaches (with every piece a removal
 * could lower reset to its natural reach) gets exactly the reaches a fresh settle of the same pieces does.
 */
export function settleReaches(terrain: Terrain, pieces: readonly EarthworkPiece[], reach0: Float64Array, reach1: Float64Array, work: Iterable<number>): void {
  const first = [...work];
  settleLod(terrain, new SettleSet(pieces, reach0), 0, first);
  settleLod(terrain, new SettleSet(pieces, reach1), LOD1_SCAN_MARGIN_M, first);
}

function settleLod(terrain: Terrain, set: SettleSet, margin: number, work: readonly number[]): void {
  const { pieces, reach } = set;
  const queued = new Uint8Array(pieces.length);
  const queue: number[] = [];
  const enqueue = (i: number) => {
    if (queued[i] === 1) return;
    queued[i] = 1;
    queue.push(i);
  };
  for (const i of work) enqueue(i);
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] ?? 0;
    queued[i] = 0;
    const p = pieces[i];
    if (!p) continue;
    const now = reach[i] ?? 0;
    const next = settledReach(terrain, set, i, margin, now);
    if (next <= now) continue;
    reach[i] = next;
    if (next > set.maxReach) set.maxReach = next;
    // Every piece whose reach box this one's may now meet re-examines its cutoff.
    set.forNear(i, p.centreBox, next + NEIGHBOUR_SAMPLE_M, (j) => enqueue(j));
  }
}

/**
 * Piece `i` of a settle with its settled reaches (`reach0`, `reach1`) and, where a reach is capped, the cap rise
 * that clears the natural relief and every neighbour there; `pieces[i]` itself when nothing differs.
 */
export function settledPiece(terrain: Terrain, pieces: readonly EarthworkPiece[], reach0: Float64Array, reach1: Float64Array, i: number): EarthworkPiece | undefined {
  const p = pieces[i];
  if (!p) return undefined;
  const r0 = reach0[i] ?? p.reachM;
  const r1 = reach1[i] ?? p.lod1.reachM;
  const capAt = (reach: Float64Array, r: number, margin: number): number => {
    if (r < MAX_REACH_M) return 0;
    const bedMin = p.z0M < p.z1M ? p.z0M : p.z1M;
    const bedMax = fillBedMax(p);
    const natural = naturalCapRise(terrain, p.centreBox, bedMin, bedMax, margin);
    neighbourShortfall(new SettleSet(pieces, reach), i, MAX_REACH_M);
    return Math.max(natural, shortfall.worst);
  };
  const c0 = capAt(reach0, r0, 0);
  const c1 = capAt(reach1, r1, LOD1_SCAN_MARGIN_M);
  if (r0 === p.reachM && r1 === p.lod1.reachM && c0 === p.capRiseM && c1 === p.lod1.capRiseM) return p;
  return withReach(p, r0, r1, c0, c1);
}

/** Prepares `inputs` (the conformed ones) and settles their reaches beside each other, from scratch. */
export function earthworkPieces(terrain: Terrain, inputs: readonly PieceInput[], adjacency: ChainAdjacency | null = null): EarthworkPiece[] {
  const prepared = inputs.filter((p) => takesEarthworks(terrain, p)).map((p) => earthworkPiece(terrain, p));
  let pieces = prepared;
  if (adjacency) {
    const byKey = new Map(prepared.map((p) => [p.key, p]));
    pieces = prepared.map((p) => withPlanes(p, chainPlanes(p, byKey, adjacency)));
  }
  const reach0 = Float64Array.from(pieces, (p) => p.reachM);
  const reach1 = Float64Array.from(pieces, (p) => p.lod1.reachM);
  settleReaches(terrain, pieces, reach0, reach1, pieces.keys());
  return pieces.map((p, i) => settledPiece(terrain, pieces, reach0, reach1, i) ?? p);
}

/** Lowest and highest node height (m) inside a plan box, over the LOD0 nodes. */
function naturalRange(t: Terrain, x0: number, y0: number, x1: number, y1: number): { min: number; max: number } {
  const rowPitch = LATTICE_SPACING_M * HALF_SQRT3;
  const r0 = Math.max(0, Math.floor(y0 / rowPitch));
  const r1 = Math.min(t.rows - 1, Math.ceil(y1 / rowPitch));
  let min = Infinity;
  let max = -Infinity;
  for (let row = r0; row <= r1; row++) {
    const shift = (row & 1) / 2;
    const c0 = Math.max(0, Math.floor(x0 / LATTICE_SPACING_M - shift));
    const c1 = Math.min(t.columns - 1, Math.ceil(x1 / LATTICE_SPACING_M - shift));
    for (let col = c0; col <= c1; col++) {
      const h = (t.heightsDm[row * t.columns + col] ?? 0) / 10;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  if (min > max) return { min: 0, max: 0 };
  return { min, max };
}

/**
 * The centreline point nearest (x, y): its plan distance `d` and arc length
 * `s`, from the piece's own render prims (the analytic lines and arcs
 * `sample.ts` samples; the drawn chords sit within 2 cm), through
 * `geometry/sample.ts`'s `nearestOnCentreline`. Written to `out`, a fresh
 * object unless the caller passes its own scratch (the hot loops do).
 */
export function nearestOnPiece(p: EarthworkPiece, x: number, y: number, out: { d: number; s: number } = { d: 0, s: 0 }): { d: number; s: number } {
  return nearestOnCentreline(p, x, y, out);
}

/** The bed height (m) at arc length s along the piece. */
export function bedAt(p: EarthworkPiece, s: number): number {
  return p.lengthM > 0 ? p.z0M + ((p.z1M - p.z0M) * s) / p.lengthM : p.z0M;
}

/** Side-slope rise (m) at plan distance d from the centreline: 0 on the formation, eased in over CREST_ROUND_M, then 1 : SIDE_SLOPE_RUN. */
export function slopeRiseM(d: number): number {
  const x = d - FORMATION_HALF_WIDTH_M;
  if (x <= 0) return 0;
  return (x < CREST_ROUND_M ? (x * x) / (2 * CREST_ROUND_M) : x - CREST_ROUND_M / 2) / SIDE_SLOPE_RUN;
}

/**
 * The side slope's rise (m) at plan distance d for a piece reaching `r`: `slopeRiseM`, plus a capped piece's cap
 * rise faded in (smoothstep) over the last CAP_FADE_M of its reach.
 */
export function riseAt(r: PieceReach, d: number): number {
  const rise = slopeRiseM(d);
  const from = r.reachM - CAP_FADE_M;
  if (r.capRiseM === 0 || d <= from) return rise;
  const f = (d - from) / CAP_FADE_M;
  return rise + r.capRiseM * f * f * (3 - 2 * f);
}

/** Polynomial smooth minimum of a and b over band k: never above min(a, b), equal to it once |a − b| ≥ k. */
export function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return a < b ? a : b;
  const h = 1 - Math.abs(a - b) / k;
  return (a < b ? a : b) - (h > 0 ? (k / 4) * h * h : 0);
}

/** A piece's envelopes at a point (`envelopeAt`): the cut U and fill L (m; −Infinity for a cut-only piece) and the plan distance d. */
export interface Envelope {
  u: number;
  l: number;
  d: number;
}

/**
 * Past a fixed clip plane, the cut rises and the fill falls this much per metre on top of the section at the plane
 * (45°), so a cutting or embankment ends in a headwall behind a portal face or an abutment instead of a cone reaching
 * on under the structure. Tried first: 2 : 1, whose crest met the hill in a crease sharper than one 1.25 m
 * sub-triangle and drew a sawtooth behind the wings; and the side slopes' 1 : 1.5, which ate 12 m into the hill
 * behind a portal, so a tunnel piece laid later from the portal saw its cover gone and a portal of its own.
 */
export const HEADWALL_RISE = 1;

/**
 * Piece `p`'s envelopes at plan (x, y) with its reach `r` at one LOD, written to `out`: false beyond the reach (the
 * piece moves nothing there). Past a fixed clip plane, by t (the farthest one the point lies beyond), the envelopes
 * are the piece's own at the point's foot on the plane, U raised and L lowered by HEADWALL_RISE · t (see the module
 * comment). Past a buffer end's plane that `clipKeys` names (a query for a command continuing from that end,
 * `ground.ts`), the piece moves nothing at all: the command is judged as if the chain ended at the plane, whatever
 * it continues with. `near` is scratch for the nearest centreline point.
 */
export function envelopeAt(p: EarthworkPiece, r: PieceReach, x: number, y: number, clipKeys: ReadonlySet<string> | null, near: { d: number; s: number }, out: Envelope): boolean {
  let t = 0;
  let px = x;
  let py = y;
  const planes = p.planes;
  for (let i = 0; i < planes.length; i++) {
    const c = planes[i];
    if (!c) continue;
    if (!c.fixed) {
      if (clipKeys !== null && clipKeys.has(c.key) && (x - c.x) * c.tx + (y - c.y) * c.ty > 0) return false;
      continue;
    }
    const tc = (x - c.x) * c.tx + (y - c.y) * c.ty;
    if (tc <= t) continue;
    t = tc;
    px = x - tc * c.tx;
    py = y - tc * c.ty;
  }
  const n = nearestOnCentreline(p, px, py, near);
  if (n.d >= r.reachM) return false;
  const bed = bedAt(p, n.s);
  const rise = (r.capRiseM === 0 ? slopeRiseM(n.d) : riseAt(r, n.d)) + (t > 0 ? HEADWALL_RISE * t : 0);
  out.d = t > 0 ? n.d + t : n.d;
  out.u = bed + rise;
  out.l = p.cutOnly ? Number.NEGATIVE_INFINITY : bed - rise;
  return true;
}

/**
 * The analytic conformed height at plan (x, y) over natural height `natural`
 * (NaN off the map) for `pieces`, with their reach at `lod` and the query
 * planes in `clipKeys` clipping too. The effective ground (`ground.ts`) evaluates it at
 * points; the renderer's chunk pass evaluates the same envelopes on its
 * sub-lattice.
 */
export function conformedHeightM(pieces: Iterable<EarthworkPiece>, x: number, y: number, natural: number, lod: EarthworkLod = 0, clipKeys: ReadonlySet<string> | null = null): number {
  let u = Infinity;
  let l = -Infinity;
  const e = scratchEnvelope;
  for (const p of pieces) {
    const r = reachAt(p, lod);
    if (x < r.minX || x > r.maxX || y < r.minY || y > r.maxY) continue;
    if (!envelopeAt(p, r, x, y, clipKeys, scratchNear, e)) continue;
    if (e.u < u) u = e.u;
    if (e.l > l) l = e.l;
  }
  return conformRule(natural, u, l);
}

const scratchNear = { d: 0, s: 0 };
const scratchEnvelope: Envelope = { u: 0, l: 0, d: 0 };

/**
 * The natural height `natural` clamped smoothly between the fill envelope `l`
 * and the cut envelope `u` (both infinite where no piece reaches). The clamp
 * is mid + sign(x)·smoothMin(|x|, half, k) about the envelopes' middle, so it
 * is exact on the formation (half = 0) and never leaves [l, u]; k is
 * DAYLIGHT_ROUND_M, narrowed to twice the smaller of |x| and half so shallow
 * ground cannot flip sign. Conflicting envelopes (l ≥ u, two tracks close
 * together) give u: cuts win. Then the "leave natural" band: moves up to
 * EARTHWORK_MIN_M give N, from twice that the clamp in full, smoothly between.
 */
export function conformRule(natural: number, u: number, l: number): number {
  if (Number.isNaN(natural) || u === Infinity) return natural;
  let c: number;
  if (l >= u) c = u;
  // Only cut-only pieces (bridges) reach here: the two-sided clamp's limit as l falls away, a smooth minimum.
  else if (l === -Infinity) c = smoothMin(natural, u, DAYLIGHT_ROUND_M);
  else {
    const mid = (u + l) / 2;
    const half = (u - l) / 2;
    const x = natural - mid;
    const ax = x < 0 ? -x : x;
    const m = smoothMin(ax, half, Math.min(DAYLIGHT_ROUND_M, 2 * (ax < half ? ax : half)));
    c = x < 0 ? mid - m : mid + m;
  }
  const t = c > natural ? c - natural : natural - c;
  if (t <= EARTHWORK_MIN_M) return natural;
  if (t >= 2 * EARTHWORK_MIN_M) return c;
  const f = (t - EARTHWORK_MIN_M) / EARTHWORK_MIN_M;
  return natural + (c - natural) * f * f * (3 - 2 * f);
}

/**
 * The natural terrain height (m) at sim plan (x, y): planar inside its lattice
 * triangle, NaN off the map. The same arithmetic as the renderer's LOD0
 * `naturalHeightM` (tested bit for bit), so the effective ground and the drawn
 * mesh start from one surface; `structure.ts`'s `terrainMmAtPoint` is the same
 * surface in mm for rule 4's natural samples.
 */
export function naturalHeightAtM(t: Terrain, x: number, y: number): number {
  const a = LATTICE_SPACING_M;
  const rf = y / (a * HALF_SQRT3);
  const qf = x / a - rf / 2;
  const Q = Math.floor(qf);
  const R = Math.floor(rf);
  const fq = qf - Q;
  const fr = rf - R;
  if (fq + fr <= 1) {
    const w = 1 - fq - fr;
    return (w === 0 ? 0 : w * nodeHeightM(t, Q, R)) + (fq === 0 ? 0 : fq * nodeHeightM(t, Q + 1, R)) + (fr === 0 ? 0 : fr * nodeHeightM(t, Q, R + 1));
  }
  return (1 - fr) * nodeHeightM(t, Q + 1, R) + (1 - fq) * nodeHeightM(t, Q, R + 1) + (fq + fr - 1) * nodeHeightM(t, Q + 1, R + 1);
}

/** Node (q, r)'s terrain height (m), NaN off the map (the renderer's LOD0 `lodHeightM`). */
function nodeHeightM(t: Terrain, q: number, r: number): number {
  const i = q + Math.floor(r / 2);
  if (r < 0 || r >= t.rows || i < 0 || i >= t.columns) return Number.NaN;
  return (t.heightsDm[r * t.columns + q + Math.floor(r / 2)] ?? 0) / 10;
}

/** What `networkAdjacency` reads of a network (a `NetworkView` has this shape). */
export interface ChainTopology {
  readonly pieces: readonly (PieceInput & { readonly nodes?: readonly [number, number] })[];
  readonly nodes?: readonly {
    readonly q: number;
    readonly r: number;
    readonly zMm: number;
    readonly ports: { readonly a: readonly { readonly piece: number; readonly end: 0 | 1 }[]; readonly b: readonly { readonly piece: number; readonly end: 0 | 1 }[] };
  }[];
}

/**
 * A network's chains for `chainPlanes`, from its node ports (piece ids are indices into `pieces`, and a piece's
 * `nodes` are [at arc length 0, at the far end]); null for a plain list of pieces, which clips nothing. The world
 * reads the same from its track index (`ground.ts`).
 */
export function networkAdjacency(network: ChainTopology): ChainAdjacency | null {
  const nodes = network.nodes;
  if (!nodes) return null;
  const index = new Map(network.pieces.map((p, i) => [p.key, i]));
  const nodeOf = (key: string, end: 0 | 1) => {
    const i = index.get(key);
    const id = i === undefined ? undefined : network.pieces[i]?.nodes?.[end];
    return { i, node: id === undefined ? undefined : nodes[id] };
  };
  return {
    next(key, end) {
      const { i, node } = nodeOf(key, end);
      if (i === undefined || !node) return undefined;
      const others = [...node.ports.a, ...node.ports.b].filter((port) => !(port.piece === i && port.end === end));
      if (others.length === 0) return "buffer";
      const other = others.length === 1 ? others[0] : undefined;
      const piece = other ? network.pieces[other.piece] : undefined;
      return other && piece ? { key: piece.key, end: other.end } : undefined;
    },
    nodeKey(key, end) {
      const { node } = nodeOf(key, end);
      return node ? `${node.q},${node.r},${node.zMm}` : "";
    },
    structure(key) {
      const i = index.get(key);
      return i === undefined ? undefined : (network.pieces[i]?.structure ?? "ground");
    },
  };
}
