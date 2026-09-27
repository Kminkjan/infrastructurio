import { primLengthM, primitives } from "../../core/geometry/sample";
import { LATTICE_SPACING_M, type RenderPrim, SQRT3, type Structure, type Terrain } from "../../core/sim/api";
import { lodGridSize, type TerrainLod } from "./offsetGrid";
import { CHUNK_NODES, chunkCounts } from "./terrainGeometry";

/**
 * Earthworks-lite (owner decision 2026-09-27, ADR 0010 "Findings (2026-09-27,
 * earthworks-lite)"): render-only cuttings and embankments that conform the
 * drawn terrain to the track, so track always shows. The sim's heights, and the
 * validation that reads them, never change.
 *
 * **The conformed surface.** For every ground-structure piece, with d the plan
 * distance from its centreline and z the track height at the nearest centreline
 * point (linear in arc length, as the track meshes draw it):
 * - the cut envelope U = z + max(0, d − W) / S bounds the terrain from above;
 * - the fill envelope L = z − max(0, d − W) / S bounds it from below;
 * W = 3 m is the formation's half width (a 6 m bed under the 4.4 m ballast
 * base) and S = 1.5 the side slopes' run per unit rise (1 : 1.5, about 34°).
 * Over all pieces, U is the lowest and L the highest envelope, and the drawn
 * height is C = min(U, max(N, L)) for the natural surface N: cuts always win,
 * so no fill (and no other track's embankment) can rise over a track. Under
 * water the fill stops 10 cm below the surface, so it never z-fights the water
 * plane. Where |C − N| ≤ 5 cm the ground stays natural, so ground-level track
 * on gentle ground leaves the terrain untouched.
 *
 * **Mesh.** The terrain is lattice triangles at 5 m (LOD0) or 10 m (LOD1).
 * Every triangle where C departs from N at a sample is refined 4 × 4 into the
 * finer triangular lattice (1.25 m at LOD0, 2.5 m at LOD1) and its vertices take
 * C. A plain triangle that shares an edge with a refined one becomes a fan
 * through the refined edge's vertices, so there are no T-junctions or cracks.
 * Under the track every drawn vertex lies within one sub-triangle edge h of it,
 * inside the flat bed whenever h + 1.6 m ≤ W, so the ballast top stays clear.
 *
 * Pure data here: the pass reads the terrain and the pieces and writes only its
 * own scratch; `earthworkMesh.ts` turns a pass into chunk geometry and
 * `EarthworksView` keeps the chunks in step with the network.
 */

/** Half width of the flat formation (bed) each side of the centreline. */
export const FORMATION_HALF_WIDTH_M = 3;
/** Side slopes: horizontal run per unit rise (1 : 1.5, about 33.7°), for cuts and fills alike. */
export const SIDE_SLOPE_RUN = 1.5;
/** The bed lies at the track height, 0.15 m under the drawn ballast top (TRACK_LIFT_M), so the ballast reads. */
export const BED_BELOW_TRACK_M = 0;
/** Departures from the natural ground up to this size are left natural. */
export const EARTHWORK_MIN_M = 0.05;
/** An underwater fill stops this far below the water surface. */
export const WATER_FILL_CLEARANCE_M = 0.1;
/** Each affected lattice triangle splits into REFINE² sub-triangles (a 4× finer triangular lattice). */
export const REFINE = 4;
/** Reach cap: beyond about 78 m of cut or fill the slope stops short (none on the diorama map). */
export const MAX_REACH_M = 120;
/** Only ground structure gets earthworks; bridges and tunnels are D4's. */
const CONFORMED: ReadonlySet<Structure> = new Set(["ground"]);

const HALF_SQRT3 = SQRT3 / 2;
const TWO_PI = 2 * Math.PI;

/** What the conform needs of a piece (a `NetworkPiece` has this shape). */
export interface PieceInput {
  readonly key: string;
  readonly prims: readonly RenderPrim[];
  readonly z0Mm: number;
  readonly z1Mm: number;
  readonly structure?: Structure;
}

/** A piece prepared for the conform: its centreline, heights and how far its earthworks can reach. */
export interface EarthworkPiece {
  readonly key: string;
  readonly prims: readonly RenderPrim[];
  readonly lengthM: number;
  readonly z0M: number;
  readonly z1M: number;
  /** Arc length at each prim's start. */
  readonly primStartM: Float64Array;
  /** Arc prims' end points (sx, sy, ex, ey per prim; unused for lines). */
  readonly arcEnds: Float64Array;
  /** Plan distance beyond which the piece cannot move the terrain. */
  readonly reachM: number;
  /** The centreline's plan box grown by the reach. */
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function conforms(piece: PieceInput): boolean {
  return piece.structure === undefined || CONFORMED.has(piece.structure);
}

/**
 * Prepares a piece: prim lengths through `geometry/sample.ts`, and the reach
 * from the natural relief around it (found by growing the box until the
 * relief inside it cannot reach further).
 */
export function earthworkPiece(terrain: Terrain, piece: PieceInput): EarthworkPiece {
  const prims = primitives(piece);
  const primStartM = new Float64Array(prims.length);
  const arcEnds = new Float64Array(prims.length * 4);
  let length = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  prims.forEach((p, i) => {
    primStartM[i] = length;
    length += primLengthM(p);
    if (p.kind === "line") {
      grow(p.x0, p.y0);
      grow(p.x1, p.y1);
      return;
    }
    const a1 = p.startRad + p.sweepRad;
    arcEnds[4 * i] = p.cx + p.radiusM * Math.cos(p.startRad);
    arcEnds[4 * i + 1] = p.cy + p.radiusM * Math.sin(p.startRad);
    arcEnds[4 * i + 2] = p.cx + p.radiusM * Math.cos(a1);
    arcEnds[4 * i + 3] = p.cy + p.radiusM * Math.sin(a1);
    // The arc's box: its ends plus any axis extreme inside the sweep.
    grow(arcEnds[4 * i] ?? 0, arcEnds[4 * i + 1] ?? 0);
    grow(arcEnds[4 * i + 2] ?? 0, arcEnds[4 * i + 3] ?? 0);
    for (let k = 0; k < 4; k++) {
      const angle = (k * Math.PI) / 2;
      let delta = (angle - p.startRad) * (p.sweepRad >= 0 ? 1 : -1);
      delta -= TWO_PI * Math.floor(delta / TWO_PI);
      if (delta <= Math.abs(p.sweepRad)) grow(p.cx + p.radiusM * Math.cos(angle), p.cy + p.radiusM * Math.sin(angle));
    }
  });
  const z0M = piece.z0Mm / 1000 - BED_BELOW_TRACK_M;
  const z1M = piece.z1Mm / 1000 - BED_BELOW_TRACK_M;
  const bedMin = Math.min(z0M, z1M);
  const bedMax = Math.max(z0M, z1M);
  let reach = FORMATION_HALF_WIDTH_M + 2 * SIDE_SLOPE_RUN;
  for (let pass = 0; pass < 8; pass++) {
    const range = naturalRange(terrain, minX - reach, minY - reach, maxX + reach, maxY + reach);
    const need = Math.min(MAX_REACH_M, FORMATION_HALF_WIDTH_M + SIDE_SLOPE_RUN * Math.max(0, range.max - bedMin, bedMax - range.min) + 1);
    if (need <= reach) break;
    reach = need;
  }
  return { key: piece.key, prims, lengthM: length, z0M, z1M, primStartM, arcEnds, reachM: reach, minX: minX - reach, minY: minY - reach, maxX: maxX + reach, maxY: maxY + reach };
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

/** Nearest centreline point of the last `nearestOnPiece` call: plan distance and arc length. */
const near = { d: 0, s: 0 };

/**
 * The centreline point nearest (x, y): projection onto each line, or the
 * angle clamp onto each arc, of the piece's own render prims (the analytic
 * lines and arcs `sample.ts` samples; the drawn chords sit within 2 cm).
 */
export function nearestOnPiece(p: EarthworkPiece, x: number, y: number): { readonly d: number; readonly s: number } {
  let bestD2 = Infinity;
  let bestS = 0;
  const prims = p.prims;
  for (let i = 0; i < prims.length; i++) {
    const prim = prims[i];
    if (!prim) continue;
    const s0 = p.primStartM[i] ?? 0;
    if (prim.kind === "line") {
      const dx = prim.x1 - prim.x0;
      const dy = prim.y1 - prim.y0;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((x - prim.x0) * dx + (y - prim.y0) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = prim.x0 + dx * t - x;
      const ey = prim.y0 + dy * t - y;
      const d2 = ex * ex + ey * ey;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestS = s0 + t * Math.sqrt(len2);
      }
      continue;
    }
    const vx = x - prim.cx;
    const vy = y - prim.cy;
    const sweep = Math.abs(prim.sweepRad);
    let delta = (Math.atan2(vy, vx) - prim.startRad) * (prim.sweepRad >= 0 ? 1 : -1);
    delta -= TWO_PI * Math.floor(delta / TWO_PI);
    if (delta <= sweep) {
      const d = Math.sqrt(vx * vx + vy * vy) - prim.radiusM;
      if (d * d < bestD2) {
        bestD2 = d * d;
        bestS = s0 + prim.radiusM * delta;
      }
      continue;
    }
    const sx = (p.arcEnds[4 * i] ?? 0) - x;
    const sy = (p.arcEnds[4 * i + 1] ?? 0) - y;
    const ex = (p.arcEnds[4 * i + 2] ?? 0) - x;
    const ey = (p.arcEnds[4 * i + 3] ?? 0) - y;
    const ds = sx * sx + sy * sy;
    const de = ex * ex + ey * ey;
    if (ds < bestD2) {
      bestD2 = ds;
      bestS = s0;
    }
    if (de < bestD2) {
      bestD2 = de;
      bestS = s0 + prim.radiusM * sweep;
    }
  }
  near.d = Math.sqrt(bestD2);
  near.s = bestS;
  return near;
}

/** The bed height (m) at arc length s along the piece. */
export function bedAt(p: EarthworkPiece, s: number): number {
  return p.lengthM > 0 ? p.z0M + ((p.z1M - p.z0M) * s) / p.lengthM : p.z0M;
}

/**
 * The analytic conformed height at plan (x, y) over natural height `natural`
 * (NaN off the map): C = min(U, max(N, L)) over `pieces`. Used by tests and
 * for single points; the chunk pass evaluates the same rule on the sub-lattice.
 */
export function conformedHeightM(pieces: readonly EarthworkPiece[], x: number, y: number, natural: number, waterLevelM: number): number {
  let u = Infinity;
  let l = -Infinity;
  for (const p of pieces) {
    if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) continue;
    const n = nearestOnPiece(p, x, y);
    if (n.d >= p.reachM) continue;
    const bed = bedAt(p, n.s);
    const slope = Math.max(0, n.d - FORMATION_HALF_WIDTH_M) / SIDE_SLOPE_RUN;
    if (bed + slope < u) u = bed + slope;
    if (bed - slope > l) l = bed - slope;
  }
  return conformRule(natural, u, l, waterLevelM);
}

/** C = min(U, max(N, L)), the fill capped under water; N itself when the change is within EARTHWORK_MIN_M. */
export function conformRule(natural: number, u: number, l: number, waterLevelM: number): number {
  if (Number.isNaN(natural)) return natural;
  const fill = natural < waterLevelM ? Math.min(l, waterLevelM - WATER_FILL_CLEARANCE_M) : l;
  const c = Math.min(u, Math.max(natural, fill));
  return Math.abs(c - natural) > EARTHWORK_MIN_M ? c : natural;
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
  /** Largest cut (N − C) and fill (C − N) on the chunk's modified sub-vertices, metres. */
  readonly maxCutM: number;
  readonly maxFillM: number;
  /** Sub-vertices evaluated against a piece. */
  readonly evaluated: number;
}

const AFFECTED_DOWN = 1;
const AFFECTED_UP = 2;

/**
 * The earthworks pass for one terrain chunk at one LOD, over the chunk's
 * triangles plus a one-triangle ring around it (so fans along a seam agree with
 * the neighbouring chunk). Holds its scratch between runs, so passes allocate
 * little; read its results before the next `run`.
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
  readonly refined: RefinedTriangles = new Map();
  stats: ChunkPassStats = { refined: 0, fans: 0, maxCutM: 0, maxFillM: 0, evaluated: 0 };

  // Sub-lattice scratch over the chunk and its ring, indexed (rs − rs0)·width + (cs − cs0) with cs = Qs + floor(Rs/2).
  private rs0 = 0;
  private cs0 = 0;
  private width = 0;
  private height = 0;
  private gen = 0;
  private stamp = new Uint32Array(0);
  private upper = new Float32Array(0);
  private lower = new Float32Array(0);
  private drawn = new Float32Array(0);
  private natural = new Float32Array(0);
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
  private waterLevelM = 0;
  private readonly sub = { qs: 0, rs: 0 };

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
    this.terrain = terrain;
    const lat = lodLattice(terrain, lod);
    this.lat = lat;
    this.chunkX = chunkX;
    this.chunkY = chunkY;
    this.i0 = chunkX * lat.chunkCells;
    this.j0 = chunkY * lat.chunkCells;
    this.i1 = Math.min(this.i0 + lat.chunkCells, lat.columns - 1);
    this.j1 = Math.min(this.j0 + lat.chunkCells, lat.rows - 1);
    this.refined.clear();
    this.waterLevelM = terrain.waterLevelDm / 10;
    this.stats = { refined: 0, fans: 0, maxCutM: 0, maxFillM: 0, evaluated: 0 };
    if (this.i1 <= this.i0 || this.j1 <= this.j0) return false;
    this.prepare();
    let evaluated = 0;
    for (const p of pieces) evaluated += this.accumulate(p);
    this.resolve();
    this.collect();
    this.stats = { ...this.stats, evaluated };
    return true;
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
   * How far the conform rule moves sub-vertex (Qs, Rs), metres, before the
   * "leave natural" threshold: |min(U, max(N, L)) − N|, 0 where no piece reaches.
   * The earthwork colour ramps with it, so the edge of a cutting follows this
   * smooth field even where the drawn height snapped back to natural.
   */
  departureAt(Qs: number, Rs: number): number {
    const g = this.gridIndex(Qs, Rs);
    if (g < 0 || this.stamp[g] !== this.gen) return 0;
    const n = this.natural[g] ?? Number.NaN;
    if (Number.isNaN(n)) return 0;
    const l = this.lower[g] ?? -Infinity;
    const fill = n < this.waterLevelM ? Math.min(l, this.waterLevelM - WATER_FILL_CLEARANCE_M) : l;
    return Math.abs(Math.min(this.upper[g] ?? Infinity, Math.max(n, fill)) - n);
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
      this.lower = new Float32Array(n);
      this.drawn = new Float32Array(n);
      this.natural = new Float32Array(n);
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
    const rsA = Math.max(this.rs0, Math.ceil(p.minY / rowM));
    const rsB = Math.min(this.rs0 + this.height - 1, Math.floor(p.maxY / rowM));
    let evaluated = 0;
    for (let rs = rsA; rs <= rsB; rs++) {
      const parity = rs & 1;
      const y = sub * rs * HALF_SQRT3;
      const csA = Math.max(this.cs0, Math.ceil(p.minX / sub - parity / 2));
      const csB = Math.min(this.cs0 + this.width - 1, Math.floor(p.maxX / sub - parity / 2));
      const rowBase = (rs - this.rs0) * this.width - this.cs0;
      for (let cs = csA; cs <= csB; cs++) {
        const x = sub * (cs + parity / 2);
        const n = nearestOnPiece(p, x, y);
        evaluated += 1;
        if (n.d >= p.reachM) continue;
        const bed = bedAt(p, n.s);
        const slope = n.d > FORMATION_HALF_WIDTH_M ? (n.d - FORMATION_HALF_WIDTH_M) / SIDE_SLOPE_RUN : 0;
        const g = rowBase + cs;
        if (this.stamp[g] !== this.gen) {
          this.stamp[g] = this.gen;
          this.upper[g] = bed + slope;
          this.lower[g] = bed - slope;
          this.touched[this.touchedCount++] = g;
        } else {
          if (bed + slope < (this.upper[g] ?? Infinity)) this.upper[g] = bed + slope;
          if (bed - slope > (this.lower[g] ?? -Infinity)) this.lower[g] = bed - slope;
        }
      }
    }
    return evaluated;
  }

  /** Applies the conform rule at every touched sub-vertex and flags the triangles it modifies. */
  private resolve(): void {
    const k = REFINE;
    let maxCut = 0;
    let maxFill = 0;
    for (let t = 0; t < this.touchedCount; t++) {
      const g = this.touched[t] ?? 0;
      const rs = this.rs0 + Math.floor(g / this.width);
      const cs = this.cs0 + (g % this.width);
      const qs = cs - Math.floor(rs / 2);
      const nat = naturalAtSub(this.terrain, this.lat, qs, rs);
      this.natural[g] = nat;
      const c = conformRule(nat, this.upper[g] ?? Infinity, this.lower[g] ?? -Infinity, this.waterLevelM);
      if (Number.isNaN(nat) || c === nat) {
        this.modified[g] = 0;
        this.drawn[g] = nat;
        continue;
      }
      this.modified[g] = 1;
      this.drawn[g] = c;
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
  private collect(): void {
    let refined = 0;
    let fans = 0;
    const s = this.sub;
    const [first, last] = this.activeRows;
    forEachChunkTriangle(this.i0, this.i1, first, last + 1, (Q, R, up) => {
      if (this.isRefined(Q, R, up)) {
        const heights = new Float32Array(SUB_VERTS);
        for (let b = 0; b <= REFINE; b++) {
          for (let a = 0; a + b <= REFINE; a++) {
            subAxial(Q, R, up, a, b, s);
            heights[subIndex(a, b)] = this.drawnAt(s.qs, s.rs);
          }
        }
        this.refined.set(triangleId(Q, R, up), heights);
        refined += 1;
      } else if (this.fanEdges(Q, R, up) !== 0) {
        fans += 1;
      }
    });
    this.stats = { ...this.stats, refined, fans };
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
 * by id; `EarthworksView` swaps a chunk's set when it rebuilds the chunk.
 */
export class DrawnHeightfield {
  readonly lat: LodLattice;
  readonly triangles: RefinedTriangles = new Map();
  /** Height range of the refined triangles, grown only (for the ray march's box). */
  minZ = Infinity;
  maxZ = -Infinity;
  private readonly waterLevelM: number;

  constructor(
    readonly terrain: Terrain,
    lod: TerrainLod = 0,
  ) {
    this.lat = lodLattice(terrain, lod);
    this.waterLevelM = terrain.waterLevelDm / 10;
  }

  /** Replaces the refined triangles of chunk (cx, cy) with `refined`. */
  setChunk(chunkX: number, chunkY: number, refined: RefinedTriangles): void {
    const lat = this.lat;
    const i0 = chunkX * lat.chunkCells;
    const j0 = chunkY * lat.chunkCells;
    const i1 = Math.min(i0 + lat.chunkCells, lat.columns - 1);
    const j1 = Math.min(j0 + lat.chunkCells, lat.rows - 1);
    if (this.triangles.size > 0) {
      forEachChunkTriangle(i0, i1, j0, j1, (Q, R, up) => {
        this.triangles.delete(triangleId(Q, R, up));
      });
    }
    for (const [id, heights] of refined) {
      this.triangles.set(id, heights);
      for (const h of heights) {
        if (h < this.minZ) this.minZ = h;
        if (h > this.maxZ) this.maxZ = h;
      }
    }
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
    if (!heights) {
      const t = this.terrain;
      const lat = this.lat;
      if (up === 0) {
        const w = 1 - fq - fr;
        return (w === 0 ? 0 : w * lodHeightM(t, lat, Q, R)) + (fq === 0 ? 0 : fq * lodHeightM(t, lat, Q + 1, R)) + (fr === 0 ? 0 : fr * lodHeightM(t, lat, Q, R + 1));
      }
      return (1 - fr) * lodHeightM(t, lat, Q + 1, R) + (1 - fq) * lodHeightM(t, lat, Q, R + 1) + (fq + fr - 1) * lodHeightM(t, lat, Q + 1, R + 1);
    }
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
    const a = this.lat.spacingM;
    const rf = y / (a * HALF_SQRT3);
    const qf = x / a - rf / 2;
    const Q = Math.floor(qf);
    const R = Math.floor(rf);
    const fq = qf - Q;
    const fr = rf - R;
    const t = this.terrain;
    const lat = this.lat;
    if (fq + fr <= 1) {
      const w = 1 - fq - fr;
      return (w === 0 ? 0 : w * lodHeightM(t, lat, Q, R)) + (fq === 0 ? 0 : fq * lodHeightM(t, lat, Q + 1, R)) + (fr === 0 ? 0 : fr * lodHeightM(t, lat, Q, R + 1));
    }
    return (1 - fr) * lodHeightM(t, lat, Q + 1, R) + (1 - fq) * lodHeightM(t, lat, Q, R + 1) + (fq + fr - 1) * lodHeightM(t, lat, Q + 1, R + 1);
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

/** Pieces whose reach box meets a plan box. */
export function piecesTouching(pieces: Iterable<EarthworkPiece>, box: { minX: number; minY: number; maxX: number; maxY: number }): EarthworkPiece[] {
  const out: EarthworkPiece[] = [];
  for (const p of pieces) if (!(p.maxX < box.minX || p.minX > box.maxX || p.maxY < box.minY || p.minY > box.maxY)) out.push(p);
  return out;
}

/**
 * The pure whole-map conform: the drawn heightfield of `lod` for the network's
 * ground pieces, built chunk by chunk with the same pass `EarthworksView`
 * uses. Terrain in, conformed render heights out; the terrain is never changed.
 */
export function conformTerrain(terrain: Terrain, network: { readonly pieces: readonly PieceInput[] }, lod: TerrainLod = 0, pass: ChunkPass = new ChunkPass()): DrawnHeightfield {
  const field = new DrawnHeightfield(terrain, lod);
  const pieces = network.pieces.filter(conforms).map((p) => earthworkPiece(terrain, p));
  const chunks = new Set<string>();
  for (const p of pieces) chunksTouching(terrain, lod, p, (x, y) => chunks.add(`${x},${y}`));
  for (const key of chunks) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    const box = ChunkPass.chunkBox(terrain, lod, x, y);
    if (!pass.run(terrain, lod, x, y, piecesTouching(pieces, box))) continue;
    field.setChunk(x, y, new Map(pass.refined));
  }
  return field;
}
