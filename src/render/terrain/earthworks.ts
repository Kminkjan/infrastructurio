import { centrelineIndex, nearestOnCentreline, sampleCentrelineEvery } from "../../core/geometry/sample";
import {
  BED_BELOW_TRACK_M,
  type ClipPlane,
  DAYLIGHT_ROUND_M,
  EARTHWORK_MIN_M,
  type EarthworkLod,
  type EarthworkPiece,
  type Envelope,
  type ChainTopology,
  LATTICE_SPACING_M,
  SQRT3,
  type Terrain,
  BAND_EDGE_RING_M,
  bandAt,
  conformRule,
  earthworkPieces,
  envelopeAt,
  inEdgeRing,
  networkAdjacency,
  reachAt,
  reachEdgeWeight,
} from "../../core/sim/api";
import { BORE_DEPTH_M, BORE_HALF_M } from "../structures/dimensions";
import { lodGridSize, type TerrainLod } from "./offsetGrid";
import { CHUNK_NODES, chunkCounts } from "./terrainGeometry";

// The rule (envelopes, reaches, the smooth clamp) lives in the core since the D4 feel-check fixes (2026-09-28), so
// the planner, validation and this mesh read one surface; re-exported here for the render modules and their tests.
export {
  BED_BELOW_TRACK_M,
  CAP_FADE_M,
  CREST_ROUND_M,
  DAYLIGHT_ROUND_M,
  EARTHWORK_MIN_M,
  type EarthworkLod,
  type EarthworkPiece,
  type Envelope,
  FORMATION_HALF_WIDTH_M,
  HEADWALL_RISE,
  LOD1_SCAN_MARGIN_M,
  MAX_REACH_M,
  NEIGHBOUR_SAMPLE_M,
  NO_PLANES,
  type PieceInput,
  type PieceReach,
  REACH_STEP_M,
  SIDE_SLOPE_RUN,
  bedAt,
  conformRule,
  conformedHeightM,
  conforms,
  cutsUnderDeck,
  earthworkPiece,
  earthworkPieces,
  envelopeAt,
  mayNeighbour,
  nearestOnPiece,
  pointCutReachM,
  reachAt,
  riseAt,
  settleReaches,
  settledPiece,
  slopeRiseM,
  smoothMin,
  takesEarthworks,
  withPlanes,
  withReach,
} from "../../core/sim/api";

/**
 * The earthworks mesh (earthworks-lite, owner decision 2026-09-27, ADR 0010 "Findings (2026-09-27,
 * earthworks-lite)"): cuttings and embankments that conform the drawn terrain to ground track, so track always
 * shows. Since the D4 feel-check fixes (2026-09-28) the rule itself (envelopes, reaches, the smooth clamp, the ends
 * clipped at bridges and tunnels) is the core's (`core/track/earthworks.ts`, re-exported above), and the core
 * keeps the settled pieces of each network revision (`sim.ground()`), which the planner, validation and the track
 * tool read as the effective ground. This module only meshes it. (Round-1 earthworks-lite, `329b69a`, had sharp
 * kinks, a hard 5 cm step and a fill capped 10 cm under the water; see the render pass iteration finding.)
 *
 * **Mesh.** The terrain is lattice triangles at 5 m (LOD0) or 10 m (LOD1).
 * Every triangle where the conformed height C departs from the natural N at a
 * sample is refined 4 × 4 into the finer triangular lattice (1.25 m at LOD0,
 * 2.5 m at LOD1) and its vertices take C. A plain triangle that shares an edge
 * with a refined one becomes a fan through the refined edge's vertices, so
 * there are no T-junctions or cracks. Under the track every drawn vertex lies
 * within one sub-triangle edge h of it, inside the flat bed whenever h + 1.6 m
 * ≤ W, so the ballast top stays clear.
 *
 * Pure data here: the pass reads the terrain and the pieces and writes only its
 * own scratch; `earthworkMesh.ts` turns a pass into chunk geometry and
 * `EarthworksView` keeps the chunks in step with the core's pieces.
 */

const HALF_SQRT3 = SQRT3 / 2;

/**
 * The colour attribute's first channel encodes the potential (`earthworkPotential`): 0 at
 * EARTHWORK_LIP_M outside the envelopes (the smooth clamp's lip starts inside that), the
 * earthwork colour weight from EARTHWORK_MIN_M inside them to full at EARTHWORK_FULL_M.
 * The terrain shader (`shaderChunks/earthwork.ts`) decodes it.
 */
export const EARTHWORK_LIP_M = 1;
export const EARTHWORK_FULL_M = 0.4;
/** Potentials below this are clamped before encoding (untouched sub-vertices take it). */
export const EARTHWORK_POTENTIAL_MIN_M = -3;
/** The encoded value at which the earthwork colour weight starts (the lip weight is full there). */
export const EARTHWORK_WEIGHT_FROM_X = (EARTHWORK_MIN_M + EARTHWORK_LIP_M) / (EARTHWORK_FULL_M + EARTHWORK_LIP_M);

/** The attribute's first channel for potential p (m): 0 at −EARTHWORK_LIP_M, 1 at EARTHWORK_FULL_M, linear and unclamped above. */
export function encodeEarthworkPotential(p: number): number {
  return ((p > EARTHWORK_POTENTIAL_MIN_M ? p : EARTHWORK_POTENTIAL_MIN_M) + EARTHWORK_LIP_M) / (EARTHWORK_FULL_M + EARTHWORK_LIP_M);
}
/** Each affected lattice triangle splits into REFINE² sub-triangles (a 4× finer triangular lattice). */
export const REFINE = 4;
/**
 * How far natural height `natural` lies outside the envelopes, metres: max(N − U, L − N),
 * positive inside a cut or fill (the sharp rule's daylight line is its zero), negative on
 * natural ground between them, −Infinity where no piece reaches. Where the envelopes conflict
 * (L ≥ U, where the rule draws U) it is |N − U|, which meets the other form at L = U. It is
 * continuous and piecewise smooth, so linear interpolation across the sub-lattice keeps its
 * contours: the earthwork colour weight is a ramp of it (`encodeEarthworkPotential`).
 */
export function earthworkPotential(natural: number, u: number, l: number): number {
  if (Number.isNaN(natural) || u === Infinity) return -Infinity;
  if (l >= u) return natural > u ? natural - u : u - natural;
  const cut = natural - u;
  const fill = l - natural;
  return cut > fill ? cut : fill;
}

// ---------------------------------------------------------------------------
// Lattice frames: the LOD lattice (5 m or 10 m) and its REFINE× sub-lattice.

/** A LOD's lattice: axial (Q, R) at `spacingM`, node (Q, R) = terrain node (step·Q, step·R). */
export interface LodLattice {
  readonly lod: TerrainLod;
  readonly spacingM: number;
  readonly step: 1 | 2;
  /** Vertex grid of the LOD in offset (i, j) = (Q + floor(R/2), R). */
  readonly columns: number;
  readonly rows: number;
  /** Chunk edge in LOD cells. */
  readonly chunkCells: number;
}

export function lodLattice(t: Pick<Terrain, "columns" | "rows">, lod: TerrainLod): LodLattice {
  const grid = lodGridSize(t.columns, t.rows, lod);
  return { lod, spacingM: lod === 0 ? LATTICE_SPACING_M : 2 * LATTICE_SPACING_M, step: lod === 0 ? 1 : 2, columns: grid.columns, rows: grid.rows, chunkCells: lod === 0 ? CHUNK_NODES : CHUNK_NODES / 2 };
}

/** Terrain node index of LOD node (Q, R), or −1 off the LOD's grid. */
export function lodNodeIndex(t: Terrain, lat: LodLattice, Q: number, R: number): number {
  const i = Q + Math.floor(R / 2);
  if (R < 0 || R >= lat.rows || i < 0 || i >= lat.columns) return -1;
  const q = lat.step * Q;
  const r = lat.step * R;
  return r * t.columns + q + Math.floor(r / 2);
}

/** Whether LOD node (Q, R) lies on the LOD's vertex grid. */
function onGrid(lat: LodLattice, Q: number, R: number): boolean {
  const i = Q + Math.floor(R / 2);
  return R >= 0 && R < lat.rows && i >= 0 && i < lat.columns;
}

/** LOD node height (m), NaN off the grid. */
function lodHeightM(t: Terrain, lat: LodLattice, Q: number, R: number): number {
  const n = lodNodeIndex(t, lat, Q, R);
  return n < 0 ? Number.NaN : (t.heightsDm[n] ?? 0) / 10;
}

/**
 * Natural height (m) at sim plan (x, y) on a LOD's lattice: the planar
 * interpolation inside its lattice triangle, exactly the plain chunk mesh's
 * surface (at LOD0, the sim heights that picking reads). Zero weights skip
 * their lookup, so points on the grid's outer edges stay defined; NaN off the
 * grid. The one copy of this interpolation: `DrawnHeightfield` and
 * `heightfieldRay` both call it, so where nothing is refined the drawn height
 * equals the natural one bit for bit.
 */
export function naturalHeightM(t: Terrain, lat: LodLattice, x: number, y: number): number {
  const a = lat.spacingM;
  const rf = y / (a * HALF_SQRT3);
  const qf = x / a - rf / 2;
  const Q = Math.floor(qf);
  const R = Math.floor(rf);
  const fq = qf - Q;
  const fr = rf - R;
  if (fq + fr <= 1) {
    const w = 1 - fq - fr;
    return (w === 0 ? 0 : w * lodHeightM(t, lat, Q, R)) + (fq === 0 ? 0 : fq * lodHeightM(t, lat, Q + 1, R)) + (fr === 0 ? 0 : fr * lodHeightM(t, lat, Q, R + 1));
  }
  return (1 - fr) * lodHeightM(t, lat, Q + 1, R) + (1 - fq) * lodHeightM(t, lat, Q, R + 1) + (fq + fr - 1) * lodHeightM(t, lat, Q + 1, R + 1);
}

/**
 * Natural height (m) at sub-lattice vertex (Qs, Rs) of a LOD: the planar
 * interpolation inside its LOD triangle, exactly the plain mesh's surface.
 * Zero weights skip their lookup, so points on the grid's outer edges stay
 * defined; NaN off the grid.
 */
export function naturalAtSub(t: Terrain, lat: LodLattice, Qs: number, Rs: number): number {
  const Q = Math.floor(Qs / REFINE);
  const R = Math.floor(Rs / REFINE);
  const a = Qs - REFINE * Q;
  const b = Rs - REFINE * R;
  if (a + b <= REFINE) {
    const wa = 1 - (a + b) / REFINE;
    let h = wa === 0 ? 0 : wa * lodHeightM(t, lat, Q, R);
    if (a > 0) h += (a / REFINE) * lodHeightM(t, lat, Q + 1, R);
    if (b > 0) h += (b / REFINE) * lodHeightM(t, lat, Q, R + 1);
    return h;
  }
  // Up triangle (Q+1, R+1), (Q, R+1), (Q+1, R) with local weights from (Q+1, R+1).
  const a2 = REFINE - a;
  const b2 = REFINE - b;
  const wa = 1 - (a2 + b2) / REFINE;
  let h = wa === 0 ? 0 : wa * lodHeightM(t, lat, Q + 1, R + 1);
  if (a2 > 0) h += (a2 / REFINE) * lodHeightM(t, lat, Q, R + 1);
  if (b2 > 0) h += (b2 / REFINE) * lodHeightM(t, lat, Q + 1, R);
  return h;
}

/** Triangle id of LOD cell (Q, R), down (0) or up (1); unique per LOD. */
export function triangleId(Q: number, R: number, up: 0 | 1): number {
  return ((R + 2) * 16384 + (Q + 8192)) * 2 + up;
}

/** Sub-vertex count of one refined triangle, and the index of barycentric sub-vertex (a, b), a + b ≤ REFINE. */
export const SUB_VERTS = ((REFINE + 1) * (REFINE + 2)) / 2;
export function subIndex(a: number, b: number): number {
  return b * (REFINE + 1) - (b * (b - 1)) / 2 + a;
}

/**
 * Sub-axial coordinates of barycentric sub-vertex (a, b) of triangle (Q, R,
 * up): a down triangle runs from (Q, R) along +Q and +R, an up triangle from
 * (Q+1, R+1) along −Q and −R, so both frames are counter-clockwise.
 */
export function subAxial(Q: number, R: number, up: 0 | 1, a: number, b: number, out: { qs: number; rs: number }): { qs: number; rs: number } {
  if (up === 0) {
    out.qs = REFINE * Q + a;
    out.rs = REFINE * R + b;
  } else {
    out.qs = REFINE * (Q + 1) - a;
    out.rs = REFINE * (R + 1) - b;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The chunk pass.

/** Per-triangle drawn heights (m) of the refined triangles, by triangle id, in `subIndex` order. */
export type RefinedTriangles = Map<number, Float32Array>;

export interface ChunkPassStats {
  /** Refined triangles inside the chunk. */
  readonly refined: number;
  /** Plain triangles turned into fans. */
  readonly fans: number;
  /** Outline vertices carrying the earthwork attribute for a refined triangle (`forEachSeamCorner`). */
  readonly seamCorners: number;
  /** Largest cut (N − C) and fill (C − N) on the chunk's modified sub-vertices, metres. */
  readonly maxCutM: number;
  readonly maxFillM: number;
  /** Sub-vertices evaluated against a piece. */
  readonly evaluated: number;
}

/** The chunk pass's slices (`ChunkPass.begin`): touched sub-vertices per resolve slice, LOD rows per collect slice. */
const RESOLVE_BLOCK = 8192;
const COLLECT_ROWS = 8;

/** Distance attribute of sub-vertices no piece reaches (beyond any shoulder). */
const FAR_M = 99;

const AFFECTED_DOWN = 1;
const AFFECTED_UP = 2;

/** The fixed clip plane a point lies farthest beyond, and how far (`farthestFixedPlane`). */
interface PastPlane {
  plane: ClipPlane | null;
  t: number;
}

/**
 * The fixed clip plane of `planes` that plan (x, y) lies farthest beyond, as `envelopeAt` picks it (the first of equal
 * ones), written to `out`; false when it lies beyond none. `envelopeAt` treats a tunnel end past that plane only.
 */
export function farthestFixedPlane(planes: readonly ClipPlane[], x: number, y: number, out: PastPlane): boolean {
  let t = 0;
  let plane: ClipPlane | null = null;
  for (let i = 0; i < planes.length; i++) {
    const c = planes[i];
    if (!c || !c.fixed) continue;
    const tc = (x - c.x) * c.tx + (y - c.y) * c.ty;
    if (tc <= t) continue;
    t = tc;
    plane = c;
  }
  out.plane = plane;
  out.t = t;
  return plane !== null;
}

/**
 * The terrain mesh's cap behind a tunnel plane at plan (x, y), `t` past it: the track bed at the plane inside the bore's
 * footprint (t ≤ `depth`, within `half` of the track across it), +Infinity elsewhere. Render only: the core's
 * effective ground there is the hill the portal retains, which the hill plug draws over the bore.
 */
export function boreBedAt(plane: ClipPlane, t: number, x: number, y: number, depth: number, half: number): number {
  if (!plane.tunnel || !(t > 0) || t > depth) return Number.POSITIVE_INFINITY;
  const across = (x - plane.x) * -plane.ty + (y - plane.y) * plane.tx;
  return Math.abs(across) <= half ? plane.zM - BED_BELOW_TRACK_M : Number.POSITIVE_INFINITY;
}

/**
 * The earthworks pass for one terrain chunk at one LOD, over the chunk's
 * triangles plus a one-triangle ring around it (so fans along a seam agree with
 * the neighbouring chunk). Holds its scratch between runs, so passes allocate
 * little; read its results before the next `run`. The refined triangles' drawn
 * heights are pooled: ordinal i has id `refinedIds[i]` and its SUB_VERTS
 * heights (`subIndex` order) at `refinedHeights[SUB_VERTS · i]`.
 */
export class ChunkPass {
  terrain!: Terrain;
  lat!: LodLattice;
  chunkX = 0;
  chunkY = 0;
  /** The chunk's vertex range in LOD offset coordinates. */
  i0 = 0;
  i1 = 0;
  j0 = 0;
  j1 = 0;
  /** Refined triangles of the chunk from the last run, and their pooled ids and heights (valid below the count). */
  refinedCount = 0;
  refinedIds = new Int32Array(0);
  refinedHeights = new Float32Array(0);
  stats: ChunkPassStats = { refined: 0, fans: 0, seamCorners: 0, maxCutM: 0, maxFillM: 0, evaluated: 0 };

  // Sub-lattice scratch over the chunk and its ring, indexed (rs − rs0)·width + (cs − cs0) with cs = Qs + floor(Rs/2).
  private rs0 = 0;
  private cs0 = 0;
  private width = 0;
  private height = 0;
  private gen = 0;
  private stamp = new Uint32Array(0);
  private upper = new Float32Array(0);
  /**
   * The cut envelope as the core shows the ground (`"ground"` mode): above the underlay's behind a tunnel portal, where
   * the hill plug draws the hill the portal retains (`structures/plug.ts`). The earthwork attribute's potential reads it,
   * so the colour weights and the relief's facet fading follow the visible ground at the plug's outline; the drawn
   * heights keep `upper`.
   */
  private upperShown = new Float32Array(0);
  private lower = new Float32Array(0);
  /**
   * The smooth clamp's band where a cut meets the natural ground (`conformRule`): the widest any piece reaching the
   * sub-vertex asks for (DAYLIGHT_ROUND_M, or past a tunnel plane beyond the wing ends up to `PORTAL_DAYLIGHT_ROUND_M`),
   * for the drawn and the shown ground alike, as the core folds it.
   */
  private band = new Float64Array(0);
  private drawn = new Float32Array(0);
  /** The shown conformed height (`shownDepartureAt`); `drawn` wherever no tunnel plane clips. */
  private shown = new Float32Array(0);
  private natural = new Float32Array(0);
  /** Plan distance to the nearest centreline of any piece reaching the sub-vertex. */
  private dist = new Float32Array(0);
  private modified = new Uint8Array(0);
  private touched = new Int32Array(0);
  private touchedCount = 0;
  // Affected flags per LOD cell, indexed (j − fj0)·fw + (i − fi0) with i = Q + floor(R/2).
  private fi0 = 0;
  private fj0 = 0;
  private fw = 0;
  private fh = 0;
  private flags = new Uint8Array(0);
  /** LOD rows holding a refined triangle (chunk and ring), for sweeping only the rows that can change. */
  private flagRowMin = Infinity;
  private flagRowMax = -Infinity;
  private readonly sub = { qs: 0, rs: 0 };
  private readonly near = { d: 0, s: 0 };
  private readonly envelope: Envelope = { u: 0, l: 0, d: 0, band: 0 };
  private readonly shownEnvelope: Envelope = { u: 0, l: 0, d: 0, band: 0 };
  private readonly past: PastPlane = { plane: null, t: 0 };

  /** Chunk box in plan metres, grown by one LOD cell (the ring), for picking candidate pieces. */
  static chunkBox(t: Pick<Terrain, "columns" | "rows">, lod: TerrainLod, chunkX: number, chunkY: number): { minX: number; minY: number; maxX: number; maxY: number } {
    const lat = lodLattice(t, lod);
    const i0 = chunkX * lat.chunkCells;
    const j0 = chunkY * lat.chunkCells;
    const i1 = Math.min(i0 + lat.chunkCells, lat.columns - 1);
    const j1 = Math.min(j0 + lat.chunkCells, lat.rows - 1);
    const a = lat.spacingM;
    return { minX: (i0 - 1.5) * a, maxX: (i1 + 1.5) * a, minY: (j0 - 1.5) * a * HALF_SQRT3, maxY: (j1 + 1.5) * a * HALF_SQRT3 };
  }

  /** Runs the pass; returns false for a chunk beyond the LOD's grid. */
  run(terrain: Terrain, lod: TerrainLod, chunkX: number, chunkY: number, pieces: readonly EarthworkPiece[]): boolean {
    const steps = this.begin(terrain, lod, chunkX, chunkY, pieces);
    if (!steps) return false;
    while (!steps.next().done);
    return true;
  }

  /**
   * Starts the pass and returns its work as steps, or undefined for a chunk beyond the LOD's grid. Each `next()`
   * does one slice (one piece's envelopes, a block of the resolve, a few rows of the collect); the results are
   * ready once it is done, and equal `run`'s. `EarthworksView` spreads a large chunk's steps over frames, so one
   * chunk no longer outlasts the slice (PR #83 re-review: 13.6 ms for a 20-piece run capped at 120 m). Nothing else
   * may use the pass until its steps are done or dropped.
   */
  begin(terrain: Terrain, lod: TerrainLod, chunkX: number, chunkY: number, pieces: readonly EarthworkPiece[]): Generator<void, void, void> | undefined {
    this.terrain = terrain;
    const lat = lodLattice(terrain, lod);
    this.lat = lat;
    this.chunkX = chunkX;
    this.chunkY = chunkY;
    this.i0 = chunkX * lat.chunkCells;
    this.j0 = chunkY * lat.chunkCells;
    this.i1 = Math.min(this.i0 + lat.chunkCells, lat.columns - 1);
    this.j1 = Math.min(this.j0 + lat.chunkCells, lat.rows - 1);
    this.refinedCount = 0;
    this.stats = { refined: 0, fans: 0, seamCorners: 0, maxCutM: 0, maxFillM: 0, evaluated: 0 };
    if (this.i1 <= this.i0 || this.j1 <= this.j0) return undefined;
    this.prepare();
    return this.steps(pieces);
  }

  private *steps(pieces: readonly EarthworkPiece[]): Generator<void, void, void> {
    let evaluated = 0;
    for (const p of pieces) {
      evaluated += this.accumulate(p);
      yield;
    }
    yield* this.resolve(pieces);
    yield* this.collect();
    this.stats = { ...this.stats, evaluated };
  }

  /** Whether LOD triangle (Q, R, up) is refined (its flags were computed by the last run: chunk and ring). */
  isRefined(Q: number, R: number, up: 0 | 1): boolean {
    const i = Q + Math.floor(R / 2) - this.fi0;
    const j = R - this.fj0;
    if (i < 0 || j < 0 || i >= this.fw || j >= this.fh) return false;
    return ((this.flags[j * this.fw + i] ?? 0) & (up === 0 ? AFFECTED_DOWN : AFFECTED_UP)) !== 0;
  }

  /** Drawn height (m) at sub-vertex (Qs, Rs): C where the pass modified it, else the natural surface. */
  drawnAt(Qs: number, Rs: number): number {
    const g = this.gridIndex(Qs, Rs);
    if (g >= 0 && this.stamp[g] === this.gen && this.modified[g] === 1) return this.drawn[g] ?? Number.NaN;
    return naturalAtSub(this.terrain, this.lat, Qs, Rs);
  }

  /**
   * The `earthwork` vertex attribute at sub-vertex (Qs, Rs), written to `out` at `offset`:
   * the encoded potential (`earthworkPotential`, clamped at −3 m below: untouched vertices
   * take that), the signed departure C − N (m; negative in cuts) and the plan distance to
   * the nearest centreline (m; far where no piece reaches). The colour weight ramps with the
   * potential, whose contours follow the smooth daylight line even across vertices the rule
   * left natural.
   */
  attributesAt(Qs: number, Rs: number, out: Float32Array, offset: number): void {
    const g = this.gridIndex(Qs, Rs);
    if (g < 0 || this.stamp[g] !== this.gen) {
      out[offset] = encodeEarthworkPotential(-Infinity);
      out[offset + 1] = 0;
      out[offset + 2] = FAR_M;
      return;
    }
    const n = this.natural[g] ?? Number.NaN;
    out[offset] = encodeEarthworkPotential(earthworkPotential(n, this.upperShown[g] ?? Infinity, this.lower[g] ?? -Infinity));
    out[offset + 1] = this.modified[g] === 1 ? (this.drawn[g] ?? n) - n : 0;
    out[offset + 2] = this.dist[g] ?? FAR_M;
  }

  /** The departure C − N (m) at sub-vertex (Qs, Rs): 0 wherever the pass left the natural surface. */
  departureAt(Qs: number, Rs: number): number {
    const g = this.gridIndex(Qs, Rs);
    if (g < 0 || this.stamp[g] !== this.gen || this.modified[g] !== 1) return 0;
    return (this.drawn[g] ?? 0) - (this.natural[g] ?? 0);
  }

  /**
   * The departure of the ground as the core shows it (`"ground"` mode): `departureAt`, except past a tunnel end's
   * plane, where the hill plug draws the hill the portal retains over the underlay. The mesh's normals tilt by it, so
   * the terrain round a plug is shaded as the visible hill, not toward the notch under the plug.
   */
  shownDepartureAt(Qs: number, Rs: number): number {
    const g = this.gridIndex(Qs, Rs);
    if (g < 0 || this.stamp[g] !== this.gen || this.modified[g] !== 1) return 0;
    return (this.shown[g] ?? 0) - (this.natural[g] ?? 0);
  }

  /** Whether the pass moved sub-vertex (Qs, Rs) off the natural surface. */
  isModified(Qs: number, Rs: number): boolean {
    const g = this.gridIndex(Qs, Rs);
    return g >= 0 && this.stamp[g] === this.gen && this.modified[g] === 1;
  }

  /** Natural height (m) at sub-vertex (Qs, Rs). */
  naturalAt(Qs: number, Rs: number): number {
    const g = this.gridIndex(Qs, Rs);
    if (g >= 0 && this.stamp[g] === this.gen) return this.natural[g] ?? Number.NaN;
    return naturalAtSub(this.terrain, this.lat, Qs, Rs);
  }

  /** Sub-lattice points in the pass's scratch grid (grid indices run below this). */
  get gridSize(): number {
    return this.width * this.height;
  }

  /** Grid index of sub-vertex (Qs, Rs), or −1 outside the pass's scratch. */
  gridIndex(Qs: number, Rs: number): number {
    const r = Rs - this.rs0;
    const c = Qs + Math.floor(Rs / 2) - this.cs0;
    if (r < 0 || c < 0 || r >= this.height || c >= this.width) return -1;
    return r * this.width + c;
  }

  private prepare(): void {
    const k = REFINE;
    const iLo = this.i0 - 1;
    const iHi = this.i1 + 1;
    const jLo = this.j0 - 1;
    const jHi = this.j1 + 1;
    this.rs0 = k * jLo;
    this.cs0 = k * iLo;
    this.width = k * (iHi - iLo) + Math.ceil(k / 2) + 1;
    this.height = k * (jHi - jLo) + 1;
    const n = this.width * this.height;
    if (this.stamp.length < n) {
      this.stamp = new Uint32Array(n);
      this.upper = new Float32Array(n);
      this.upperShown = new Float32Array(n);
      this.lower = new Float32Array(n);
      this.band = new Float64Array(n);
      this.drawn = new Float32Array(n);
      this.shown = new Float32Array(n);
      this.natural = new Float32Array(n);
      this.dist = new Float32Array(n);
      this.modified = new Uint8Array(n);
      this.touched = new Int32Array(n);
      this.gen = 0;
    }
    this.gen += 1;
    if (this.gen === 0xffffffff) {
      this.stamp.fill(0);
      this.gen = 1;
    }
    this.touchedCount = 0;
    this.fi0 = iLo - 2;
    this.fj0 = jLo - 2;
    this.fw = iHi - iLo + 5;
    this.fh = jHi - jLo + 5;
    const f = this.fw * this.fh;
    if (this.flags.length < f) this.flags = new Uint8Array(f);
    else this.flags.fill(0, 0, f);
    this.flagRowMin = Infinity;
    this.flagRowMax = -Infinity;
  }

  /**
   * The chunk's LOD rows [first, last] that can hold a refined triangle or a
   * fan (the refined rows plus one each side); first > last when none do.
   * Rows outside it are exactly the plain chunk's.
   */
  get activeRows(): readonly [number, number] {
    return [Math.max(this.j0, this.flagRowMin - 1), Math.min(this.j1 - 1, this.flagRowMax + 1)];
  }

  /** Folds one piece's envelopes into the scratch over its box; returns the sub-vertices it evaluated. */
  private accumulate(p: EarthworkPiece): number {
    const k = REFINE;
    const sub = this.lat.spacingM / k;
    const rowM = sub * HALF_SQRT3;
    const r = reachAt(p, this.lat.lod);
    const rsA = Math.max(this.rs0, Math.ceil(r.minY / rowM));
    const rsB = Math.min(this.rs0 + this.height - 1, Math.floor(r.maxY / rowM));
    // A point farther than the reach from the centreline's box is farther from the centreline: each row only spans
    // the x range within the reach (plus a micrometre, so rounding never drops a point the reach would keep).
    const c = p.centreBox;
    const out = r.reachM + 1e-6;
    const env = this.envelope;
    const shown = this.shownEnvelope;
    // Only past a tunnel end's plane do the modes differ (`envelopeAt`).
    const portal = p.planes.some((plane) => plane.fixed && plane.tunnel);
    const past = this.past;
    // The bore's footprint behind a tunnel plane, grown by one sub-lattice step so the terrain's rise out of it lies
    // wholly behind the bore's walls and back (`boreBedAt`).
    const boreS = BORE_DEPTH_M + sub;
    const boreU = BORE_HALF_M + sub;
    let evaluated = 0;
    for (let rs = rsA; rs <= rsB; rs++) {
      const parity = rs & 1;
      const y = sub * rs * HALF_SQRT3;
      const dy = y < c.minY ? c.minY - y : y > c.maxY ? y - c.maxY : 0;
      if (dy >= out) continue;
      const w = Math.sqrt(out * out - dy * dy);
      const csA = Math.max(this.cs0, Math.ceil(r.minX / sub - parity / 2), Math.ceil((c.minX - w) / sub - parity / 2));
      const csB = Math.min(this.cs0 + this.width - 1, Math.floor(r.maxX / sub - parity / 2), Math.floor((c.maxX + w) / sub - parity / 2));
      const rowBase = (rs - this.rs0) * this.width - this.cs0;
      for (let cs = csA; cs <= csB; cs++) {
        const x = sub * (cs + parity / 2);
        // The core's envelopes (`envelopeAt`: the nearest centreline point, the side slope, a clipped end's headwall),
        // in "underlay" mode: behind a tunnel portal the mesh keeps the 45° headwall from the track bed, which the hill
        // plug covers with the core's retained hill (`structures/plug.ts`); a 1.25 m mesh cannot draw the 7.65 m step
        // at the face without grass wedges in front of it (D4 second feel-check fixes, 2026-09-28).
        evaluated += 1;
        if (!envelopeAt(p, r, x, y, null, this.near, env, "underlay")) continue;
        let us = env.u;
        const plane = portal && farthestFixedPlane(p.planes, x, y, past) ? past.plane : null;
        if (plane?.tunnel) {
          // Past a tunnel plane: the ground the core shows (the second evaluation runs only here: over the whole reach
          // it cost a tunnel edit about 1.5 times the earthworks rebuild, verification finding 2026-09-29)...
          if (envelopeAt(p, r, x, y, null, this.near, shown, "ground")) us = shown.u;
          // ...and, inside the bore's footprint, the underlay no higher than the track bed: its 45° headwall rose
          // 1–5 m inside the 4.5 m bore and filled the arch with a sunlit slope (verification finding 2026-09-29).
          // The face, the bore's walls and back and the hill plug over it hide the step at the footprint's edges.
          const bed = boreBedAt(plane, past.t, x, y, boreS, boreU);
          if (bed < env.u) env.u = bed;
        }
        const g = rowBase + cs;
        // (Both modes ask for the same band: it depends only on where the point lies behind the plane.)
        const k = env.band;
        if (this.stamp[g] !== this.gen) {
          this.stamp[g] = this.gen;
          this.upper[g] = env.u;
          this.upperShown[g] = us;
          this.lower[g] = env.l;
          this.band[g] = k;
          this.dist[g] = env.d;
          this.touched[this.touchedCount++] = g;
        } else {
          if (env.u < (this.upper[g] ?? Infinity)) this.upper[g] = env.u;
          if (us < (this.upperShown[g] ?? Infinity)) this.upperShown[g] = us;
          if (env.l > (this.lower[g] ?? -Infinity)) this.lower[g] = env.l;
          if (k > (this.band[g] ?? 0)) this.band[g] = k;
          if (env.d < (this.dist[g] ?? Infinity)) this.dist[g] = env.d;
        }
      }
    }
    return evaluated;
  }

  /**
   * Applies the conform rule at every touched sub-vertex and flags the triangles it modifies. `pieces` are the pass's
   * (their reach boxes grown by BAND_EDGE_RING_M meet the chunk): a portal's wider band gives way near any of their
   * reach edges (`reachEdgeWeight`), as the core folds it.
   */
  private *resolve(pieces: readonly EarthworkPiece[]): Generator<void, void, void> {
    const k = REFINE;
    const sub = this.lat.spacingM / k;
    let maxCut = 0;
    let maxFill = 0;
    for (let t = 0; t < this.touchedCount; t++) {
      if (t > 0 && t % RESOLVE_BLOCK === 0) yield;
      const g = this.touched[t] ?? 0;
      const rs = this.rs0 + Math.floor(g / this.width);
      const cs = this.cs0 + (g % this.width);
      const qs = cs - Math.floor(rs / 2);
      const nat = naturalAtSub(this.terrain, this.lat, qs, rs);
      this.natural[g] = nat;
      const upper = this.upper[g] ?? Infinity;
      const upperShown = this.upperShown[g] ?? Infinity;
      const lower = this.lower[g] ?? -Infinity;
      let band = this.band[g] ?? DAYLIGHT_ROUND_M;
      let bandShown = band;
      if (band > DAYLIGHT_ROUND_M && !Number.isNaN(nat)) {
        // (The sub-vertex's plan position as `accumulate` computes it.) Per mode: the drawn underlay and the shown
        // ground fold their own cut envelopes.
        const x = sub * (cs + (rs & 1) / 2);
        const y = sub * rs * HALF_SQRT3;
        let w = 1;
        let ws = 1;
        for (let i = 0; i < pieces.length && (w > 0 || ws > 0); i++) {
          const p = pieces[i] as EarthworkPiece;
          const r = reachAt(p, this.lat.lod);
          if (!inEdgeRing(r, x, y)) continue;
          if (w > 0) {
            const e = reachEdgeWeight(p, r, x, y, nat, upper, lower, "underlay", this.near);
            if (e < w) w = e;
          }
          if (ws > 0) {
            const e = reachEdgeWeight(p, r, x, y, nat, upperShown, lower, "ground", this.near);
            if (e < ws) ws = e;
          }
        }
        bandShown = bandAt(band, ws);
        band = bandAt(band, w);
      }
      const c = conformRule(nat, upper, lower, band);
      if (Number.isNaN(nat) || c === nat) {
        this.modified[g] = 0;
        this.drawn[g] = nat;
        this.shown[g] = nat;
        continue;
      }
      this.modified[g] = 1;
      this.drawn[g] = c;
      // The ground as the core shows it: the underlay's own height except past a tunnel plane (`upperShown`).
      this.shown[g] = upperShown === upper && bandShown === band ? c : conformRule(nat, upperShown, lower, bandShown);
      if (nat - c > maxCut) maxCut = nat - c;
      if (c - nat > maxFill) maxFill = c - nat;
      // Flag every LOD triangle whose closure holds this sub-vertex.
      const Q = Math.floor(qs / k);
      const R = Math.floor(rs / k);
      const a = qs - k * Q;
      const b = rs - k * R;
      if (a === 0 && b === 0) {
        this.flag(Q, R, 0);
        this.flag(Q - 1, R, 0);
        this.flag(Q - 1, R, 1);
        this.flag(Q, R - 1, 0);
        this.flag(Q, R - 1, 1);
        this.flag(Q - 1, R - 1, 1);
      } else if (b === 0) {
        this.flag(Q, R, 0);
        this.flag(Q, R - 1, 1);
      } else if (a === 0) {
        this.flag(Q, R, 0);
        this.flag(Q - 1, R, 1);
      } else if (a + b === k) {
        this.flag(Q, R, 0);
        this.flag(Q, R, 1);
      } else {
        this.flag(Q, R, a + b < k ? 0 : 1);
      }
    }
    this.stats = { ...this.stats, maxCutM: maxCut, maxFillM: maxFill };
  }

  private flag(Q: number, R: number, up: 0 | 1): void {
    // Only triangles that exist on the LOD's grid (all three corners on it).
    const lat = this.lat;
    if (up === 0 ? !onGrid(lat, Q, R) || !onGrid(lat, Q + 1, R) || !onGrid(lat, Q, R + 1) : !onGrid(lat, Q + 1, R) || !onGrid(lat, Q, R + 1) || !onGrid(lat, Q + 1, R + 1)) return;
    const i = Q + Math.floor(R / 2);
    const fi = i - this.fi0;
    const fj = R - this.fj0;
    if (fi < 0 || fj < 0 || fi >= this.fw || fj >= this.fh) return;
    this.flags[fj * this.fw + fi] = (this.flags[fj * this.fw + fi] ?? 0) | (up === 0 ? AFFECTED_DOWN : AFFECTED_UP);
    if (R < this.flagRowMin) this.flagRowMin = R;
    if (R > this.flagRowMax) this.flagRowMax = R;
  }

  /** Stores the drawn sub-vertex heights of the chunk's refined triangles and counts its fans. */
  private *collect(): Generator<void, void, void> {
    let refined = 0;
    let fans = 0;
    const s = this.sub;
    const [first, last] = this.activeRows;
    const visit = (Q: number, R: number, up: 0 | 1): void => {
      if (this.isRefined(Q, R, up)) {
        if (refined >= this.refinedIds.length) this.growRefined();
        const heights = this.refinedHeights;
        const at = SUB_VERTS * refined;
        for (let b = 0; b <= REFINE; b++) {
          for (let a = 0; a + b <= REFINE; a++) {
            subAxial(Q, R, up, a, b, s);
            heights[at + subIndex(a, b)] = this.drawnAt(s.qs, s.rs);
          }
        }
        this.refinedIds[refined] = triangleId(Q, R, up);
        refined += 1;
      } else if (this.fanEdges(Q, R, up) !== 0) {
        fans += 1;
      }
    };
    for (let j = first; j <= last; j += COLLECT_ROWS) {
      const to = Math.min(last + 1, j + COLLECT_ROWS);
      forEachChunkTriangle(this.i0, this.i1, j, to, visit);
      if (to <= last) yield;
    }
    this.refinedCount = refined;
    this.stats = { ...this.stats, refined, fans, seamCorners: this.forEachSeamCorner() };
  }

  /**
   * Visits the chunk's outline vertices (the LOD nodes on its edges) that a refined
   * triangle uses unmoved, whether that triangle is this chunk's or a neighbour's (in
   * the ring), with their plain vertex index in the chunk mesh; returns how many. Such a
   * vertex carries the earthwork attribute in both chunks, so the lip agrees across the
   * seam (PR #83 review: the neighbour's separate vertex kept zeros). An interior
   * vertex's triangles are all this chunk's, so `buildEarthworkChunk` writes those as
   * its refined triangles reuse them.
   */
  forEachSeamCorner(visit?: (Q: number, R: number, plainIndex: number) => void): number {
    let n = 0;
    const across = this.i1 - this.i0 + 1;
    for (let j = this.j0; j <= this.j1; j++) {
      const step = j === this.j0 || j === this.j1 ? 1 : Math.max(1, this.i1 - this.i0);
      const half = Math.floor(j / 2);
      for (let i = this.i0; i <= this.i1; i += step) {
        const Q = i - half;
        if (!this.touchesRefined(Q, j) || this.isModified(REFINE * Q, REFINE * j)) continue;
        n += 1;
        visit?.(Q, j, (j - this.j0) * across + (i - this.i0));
      }
    }
    return n;
  }

  /** Whether any of the six lattice triangles around LOD node (Q, R) is refined. */
  private touchesRefined(Q: number, R: number): boolean {
    return this.isRefined(Q, R, 0) || this.isRefined(Q - 1, R, 0) || this.isRefined(Q - 1, R, 1) || this.isRefined(Q, R - 1, 0) || this.isRefined(Q, R - 1, 1) || this.isRefined(Q - 1, R - 1, 1);
  }

  /** Doubles the pooled refined storage, keeping what it holds. */
  private growRefined(): void {
    const capacity = Math.max(256, 2 * this.refinedIds.length);
    const ids = new Int32Array(capacity);
    ids.set(this.refinedIds);
    const heights = new Float32Array(capacity * SUB_VERTS);
    heights.set(this.refinedHeights);
    this.refinedIds = ids;
    this.refinedHeights = heights;
  }

  /**
   * Which edges of a plain triangle border a refined one, as bits in the
   * triangle's counter-clockwise edge order (bit 0: A→B, 1: B→C, 2: C→A, with
   * the corners of `triangleCorners`); 0 for a triangle that needs no fan.
   */
  fanEdges(Q: number, R: number, up: 0 | 1): number {
    let bits = 0;
    if (up === 0) {
      // A (Q,R) → B (Q+1,R): up (Q, R−1); B → C (Q,R+1): up (Q,R); C → A: up (Q−1,R).
      if (this.isRefined(Q, R - 1, 1)) bits |= 1;
      if (this.isRefined(Q, R, 1)) bits |= 2;
      if (this.isRefined(Q - 1, R, 1)) bits |= 4;
    } else {
      // A (Q+1,R+1) → B (Q,R+1): down (Q,R+1); B → C (Q+1,R): down (Q,R); C → A: down (Q+1,R).
      if (this.isRefined(Q, R + 1, 0)) bits |= 1;
      if (this.isRefined(Q, R, 0)) bits |= 2;
      if (this.isRefined(Q + 1, R, 0)) bits |= 4;
    }
    return bits;
  }
}

/** The corners (Q, R) of LOD triangle (Q, R, up) in the counter-clockwise order its sub-lattice frame uses. */
export function triangleCorners(Q: number, R: number, up: 0 | 1): readonly [number, number, number, number, number, number] {
  return up === 0 ? [Q, R, Q + 1, R, Q, R + 1] : [Q + 1, R + 1, Q, R + 1, Q + 1, R];
}

/**
 * Visits a chunk's LOD triangles as (Q, R, up) in the same order
 * `forEachLatticeTriangle` emits them (so a triangle's ordinal matches the
 * plain chunk mesh's index buffer).
 */
export function forEachChunkTriangle(i0: number, i1: number, j0: number, j1: number, visit: (Q: number, R: number, up: 0 | 1, ordinal: number) => void, firstOrdinal = 0): void {
  let t = firstOrdinal;
  for (let j = j0; j < j1; j++) {
    const half = Math.floor(j / 2);
    const even = (j & 1) === 0;
    for (let i = i0; i < i1; i++) {
      const Q = i - half;
      visit(Q, j, 0, t++);
      // Even rows: (i+1, j), (i+1, j+1), (i, j+1) is up (Q, R); odd rows: (i, j), (i+1, j+1), (i, j+1) is up (Q − 1, R).
      visit(even ? Q : Q - 1, j, 1, t++);
    }
  }
}

// ---------------------------------------------------------------------------
// The whole map, and sampling what is drawn.

/**
 * The drawn terrain surface of one LOD: the natural lattice interpolation,
 * except inside refined triangles, where it interpolates their sub-lattice
 * heights. It is exactly what the chunk meshes draw, so picking and scenery
 * read the conformed ground the player sees. Refined triangles are stored
 * by id (views into one height buffer per chunk); `EarthworksView` swaps a
 * chunk's set when it rebuilds the chunk.
 */
export class DrawnHeightfield {
  readonly lat: LodLattice;
  readonly triangles: RefinedTriangles = new Map();
  /** Height range of the refined triangles, grown only (for the ray march's box). */
  minZ = Infinity;
  maxZ = -Infinity;
  private readonly waterLevelM: number;
  /** Each chunk's refined triangle ids, by chunk key, so a rebuild deletes only that chunk's own. */
  private readonly chunkIds = new Map<number, Int32Array>();

  constructor(
    readonly terrain: Terrain,
    lod: TerrainLod = 0,
  ) {
    this.lat = lodLattice(terrain, lod);
    this.waterLevelM = terrain.waterLevelDm / 10;
  }

  /**
   * Replaces the refined triangles of the pass's chunk with the pass's (run at this LOD).
   * Only that chunk's previous triangles are deleted, and a chunk that had none and gets
   * none costs a lookup; the new heights are copied into one buffer for the chunk.
   */
  setChunk(pass: ChunkPass): void {
    if (pass.lat.lod !== this.lat.lod) throw new Error(`setChunk: a LOD${pass.lat.lod} pass for a LOD${this.lat.lod} heightfield`);
    const key = pass.chunkY * 65536 + pass.chunkX;
    const old = this.chunkIds.get(key);
    const n = pass.refinedCount;
    if (old === undefined && n === 0) return;
    if (old !== undefined) {
      for (let i = 0; i < old.length; i++) this.triangles.delete(old[i] ?? 0);
      this.chunkIds.delete(key);
    }
    if (n === 0) return;
    const ids = pass.refinedIds.slice(0, n);
    const heights = pass.refinedHeights.slice(0, n * SUB_VERTS);
    for (let i = 0; i < n; i++) this.triangles.set(ids[i] ?? 0, heights.subarray(SUB_VERTS * i, SUB_VERTS * (i + 1)));
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i] ?? 0;
      if (h < this.minZ) this.minZ = h;
      if (h > this.maxZ) this.maxZ = h;
    }
    this.chunkIds.set(key, ids);
  }

  /** Drawn height (m) at sim plan (x, y), NaN off the LOD's grid. Allocation-free. */
  heightAtM(x: number, y: number): number {
    const a = this.lat.spacingM;
    const rf = y / (a * HALF_SQRT3);
    const qf = x / a - rf / 2;
    const Q = Math.floor(qf);
    const R = Math.floor(rf);
    const fq = qf - Q;
    const fr = rf - R;
    const up: 0 | 1 = fq + fr <= 1 ? 0 : 1;
    const heights = this.triangles.size === 0 ? undefined : this.triangles.get(triangleId(Q, R, up));
    if (!heights) return naturalHeightM(this.terrain, this.lat, x, y);
    // Inside a refined triangle: local sub-lattice coordinates (a, b) from its corner A
    // (scaling by REFINE = 4 is exact, so a + b ≤ REFINE holds wherever fq + fr ≤ 1 did).
    const la = up === 0 ? fq * REFINE : (1 - fq) * REFINE;
    const lb = up === 0 ? fr * REFINE : (1 - fr) * REFINE;
    const a0 = Math.floor(la);
    const b0 = Math.floor(lb);
    if (a0 + b0 >= REFINE) {
      // Exactly on a sub-vertex of the far edge.
      const a = Math.min(a0, REFINE);
      return heights[subIndex(a, REFINE - a)] ?? Number.NaN;
    }
    const ga = la - a0;
    const gb = lb - b0;
    const h00 = heights[subIndex(a0, b0 + 1)] ?? Number.NaN;
    const h10 = heights[subIndex(a0 + 1, b0)] ?? Number.NaN;
    if (ga + gb <= 1 || a0 + b0 + 2 > REFINE) {
      const w = 1 - ga - gb;
      return w * (heights[subIndex(a0, b0)] ?? Number.NaN) + ga * h10 + gb * h00;
    }
    return (1 - gb) * h10 + (1 - ga) * h00 + (ga + gb - 1) * (heights[subIndex(a0 + 1, b0 + 1)] ?? Number.NaN);
  }

  /** Natural height (m) at plan (x, y) on this LOD (the plain mesh), NaN off the grid. */
  naturalAtM(x: number, y: number): number {
    return naturalHeightM(this.terrain, this.lat, x, y);
  }

  get waterLevel(): number {
    return this.waterLevelM;
  }
}

/** Chunks (x, y) at a LOD whose ringed box meets the plan box. */
export function chunksTouching(t: Pick<Terrain, "columns" | "rows">, lod: TerrainLod, box: { minX: number; minY: number; maxX: number; maxY: number }, visit: (x: number, y: number) => void): void {
  const counts = chunkCounts(t);
  for (let y = 0; y < counts.y; y++) {
    for (let x = 0; x < counts.x; x++) {
      const c = ChunkPass.chunkBox(t, lod, x, y);
      if (c.maxX < box.minX || c.minX > box.maxX || c.maxY < box.minY || c.minY > box.maxY) continue;
      visit(x, y);
    }
  }
}

/**
 * Pieces whose reach box at `lod`, grown by `grow`, meets a plan box: by default BAND_EDGE_RING_M, the pieces a point
 * reads (their envelopes within the reach box, a portal's band weight within the ring; `reachEdgeWeight`).
 */
export function piecesTouching(
  pieces: Iterable<EarthworkPiece>,
  box: { minX: number; minY: number; maxX: number; maxY: number },
  lod: TerrainLod = 0,
  grow: number = BAND_EDGE_RING_M,
): EarthworkPiece[] {
  const out: EarthworkPiece[] = [];
  for (const p of pieces) {
    const r = reachAt(p, lod);
    if (!(r.maxX + grow < box.minX || r.minX - grow > box.maxX || r.maxY + grow < box.minY || r.minY - grow > box.maxY)) out.push(p);
  }
  return out;
}

/**
 * The pure whole-map conform: the drawn heightfield of `lod` for the network's
 * ground pieces (and bridges near the ground), built chunk by chunk with the
 * same pass `EarthworksView` uses. Terrain in, conformed render heights out;
 * the terrain is never changed. The ends where a bridge or tunnel continues
 * are clipped when the input is a whole network (its nodes name the pieces at
 * each end); a plain list of pieces clips nothing. The app meshes the core's
 * settled pieces instead (`sim.ground()`), which equal these (tested).
 */
export function conformTerrain(
  terrain: Terrain,
  network: ChainTopology,
  lod: TerrainLod = 0,
  pass: ChunkPass = new ChunkPass(),
): DrawnHeightfield {
  const field = new DrawnHeightfield(terrain, lod);
  const pieces = earthworkPieces(terrain, network.pieces, networkAdjacency(network));
  const chunks = new Set<string>();
  for (const p of pieces) chunksTouching(terrain, lod, reachAt(p, lod), (x, y) => chunks.add(`${x},${y}`));
  for (const key of chunks) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    const box = ChunkPass.chunkBox(terrain, lod, x, y);
    if (!pass.run(terrain, lod, x, y, piecesTouching(pieces, box, lod))) continue;
    field.setChunk(pass);
  }
  return field;
}
