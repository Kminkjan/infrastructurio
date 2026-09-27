import { type Piece, type PieceKey, nodeKey } from "./piece";
import { samplePiece } from "./sample";

/**
 * Track clearance, rule 6 (simulation model §9): `tracks-too-close` when two
 * centrelines come closer than 4.0 m in plan while less than 6.5 m apart in
 * height. Pieces sharing a node (same q, r and z) are exempt.
 *
 * This is one of the two float decisions in the core. It is taken when a
 * command runs and the outcome is kept as authored state; loads never
 * re-validate, and only exact-threshold cases could differ between engines.
 *
 * Arcs are sampled into chords with sagitta ≤ 0.05 m, and a piece containing
 * an arc pads the distance threshold by those 0.05 m, so the chord error only
 * ever makes the check stricter. Heights are compared as the gap between the
 * two chords' height ranges, which is also conservative.
 *
 * The broadphase is a spatial hash of 20 m cells, updated incrementally as
 * pieces are committed or removed; a check tests only new pieces, against the
 * committed ones and against earlier new pieces of the same edit.
 */

export const CLEARANCE_CELL_M = 20;
export const MIN_PLAN_DISTANCE_M = 4;
export const MIN_HEIGHT_SEPARATION_MM = 6500;
export const CLEARANCE_SAGITTA_M = 0.05;

/** A piece prepared for clearance tests: chord segments with interpolated heights. */
export interface ClearanceShape {
  readonly key: PieceKey;
  readonly nodeKeys: readonly [string, string];
  /** Six numbers per segment: x0, y0, z0Mm, x1, y1, z1Mm (plan metres, height mm). */
  readonly segs: Float64Array;
  readonly padM: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface ClearanceHit {
  /** Closest chord distance in metres (the true distance is within the pads of it). */
  readonly distanceM: number;
  /** Where on the first piece the pieces come closest, in world metres. */
  readonly x: number;
  readonly y: number;
}

export interface ClearanceConflict extends ClearanceHit {
  /** The new piece. */
  readonly piece: PieceKey;
  /** The piece it comes closest to among those too close (ties: the smaller key). */
  readonly other: PieceKey;
}

export function clearanceShape(piece: Piece): ClearanceShape {
  const points = samplePiece(piece, CLEARANCE_SAGITTA_M);
  const last = points[points.length - 1];
  const totalM = last ? last.sM : 0;
  const z0 = piece.ends[0].node.zMm;
  const dz = piece.ends[1].node.zMm - z0;
  const segs = new Float64Array(Math.max(0, points.length - 1) * 6);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach((p, i) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    const z = totalM > 0 ? z0 + (dz * p.sM) / totalM : z0;
    if (i > 0) segs.set([p.x, p.y, z], i * 6 - 3);
    if (i < points.length - 1) segs.set([p.x, p.y, z], i * 6);
  });
  return Object.freeze({
    key: piece.key,
    nodeKeys: Object.freeze([nodeKey(piece.ends[0].node), nodeKey(piece.ends[1].node)] as const),
    segs,
    padM: piece.prims.some((p) => p.kind === "arc") ? CLEARANCE_SAGITTA_M : 0,
    minX,
    minY,
    maxX,
    maxY,
  });
}

function sharesNode(a: ClearanceShape, b: ClearanceShape): boolean {
  const [a0, a1] = a.nodeKeys;
  const [b0, b1] = b.nodeKeys;
  return a0 === b0 || a0 === b1 || a1 === b0 || a1 === b1;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

interface Closest {
  d2: number;
  x: number;
  y: number;
}

/**
 * Squared distance between segments p1q1 and p2q2 and the closest point on
 * the first (Ericson, Real-Time Collision Detection §5.1.9). Crossing
 * segments give 0.
 */
function segmentDistance(
  p1x: number, p1y: number, q1x: number, q1y: number,
  p2x: number, p2y: number, q2x: number, q2y: number,
  out: Closest,
): void {
  const d1x = q1x - p1x;
  const d1y = q1y - p1y;
  const d2x = q2x - p2x;
  const d2y = q2y - p2y;
  const rx = p1x - p2x;
  const ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  let s = 0;
  let t = 0;
  if (a <= 1e-18 && e <= 1e-18) {
    s = 0;
    t = 0;
  } else if (a <= 1e-18) {
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= 1e-18) {
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom > 0 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const c1x = p1x + d1x * s;
  const c1y = p1y + d1y * s;
  const dx = c1x - (p2x + d2x * t);
  const dy = c1y - (p2y + d2y * t);
  out.d2 = dx * dx + dy * dy;
  out.x = c1x;
  out.y = c1y;
}

/**
 * The closest too-close contact between two pieces, or null when they are
 * exempt (shared node) or clear. Symmetric in outcome.
 */
export function shapesTooClose(a: ClearanceShape, b: ClearanceShape): ClearanceHit | null {
  if (a.key === b.key || sharesNode(a, b)) return null;
  const limit = MIN_PLAN_DISTANCE_M + a.padM + b.padM;
  if (b.minX - a.maxX >= limit || a.minX - b.maxX >= limit) return null;
  if (b.minY - a.maxY >= limit || a.minY - b.maxY >= limit) return null;
  const limit2 = limit * limit;
  const sa = a.segs;
  const sb = b.segs;
  const probe: Closest = { d2: 0, x: 0, y: 0 };
  let best: Closest | null = null;
  for (let i = 0; i < sa.length; i += 6) {
    const ax0 = sa[i] as number;
    const ay0 = sa[i + 1] as number;
    const az0 = sa[i + 2] as number;
    const ax1 = sa[i + 3] as number;
    const ay1 = sa[i + 4] as number;
    const az1 = sa[i + 5] as number;
    const aMinX = Math.min(ax0, ax1) - limit;
    const aMaxX = Math.max(ax0, ax1) + limit;
    const aMinY = Math.min(ay0, ay1) - limit;
    const aMaxY = Math.max(ay0, ay1) + limit;
    const aMinZ = Math.min(az0, az1);
    const aMaxZ = Math.max(az0, az1);
    for (let j = 0; j < sb.length; j += 6) {
      const bx0 = sb[j] as number;
      const by0 = sb[j + 1] as number;
      const bz0 = sb[j + 2] as number;
      const bx1 = sb[j + 3] as number;
      const by1 = sb[j + 4] as number;
      const bz1 = sb[j + 5] as number;
      if (Math.max(bx0, bx1) <= aMinX || Math.min(bx0, bx1) >= aMaxX) continue;
      if (Math.max(by0, by1) <= aMinY || Math.min(by0, by1) >= aMaxY) continue;
      const zGap = Math.max(0, Math.min(bz0, bz1) - aMaxZ, aMinZ - Math.max(bz0, bz1));
      if (zGap >= MIN_HEIGHT_SEPARATION_MM) continue;
      segmentDistance(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1, probe);
      if (probe.d2 < limit2 && (best === null || probe.d2 < best.d2)) best = { ...probe };
    }
  }
  return best === null ? null : { distanceM: Math.sqrt(best.d2), x: best.x, y: best.y };
}

/** Read-only side of the index, as validation sees it. */
export interface ClearanceView {
  readonly size: number;
  has(key: PieceKey): boolean;
  /**
   * The first entry of `added` (in order) that comes too close to a
   * committed piece not in `ignored` or to an earlier entry of `added`,
   * paired with its worst clash: the partner at the smallest distance, ties
   * going to the smaller key. That distance depends on the pair alone, so the
   * answer never depends on insertion order, and the message can quote the
   * worst case. Null when every entry clears. Does not modify the index.
   */
  findConflict(added: readonly Piece[], ignored: ReadonlySet<PieceKey>): ClearanceConflict | null;
}

export interface ClearanceIndex extends ClearanceView {
  insert(piece: Piece): void;
  remove(key: PieceKey): void;
}

/** Cells stay addressable within ±32,767 cells (±655 km); the map is 2 km. */
const CELL_RANGE = 32_768;

function cellKey(cx: number, cy: number): number {
  if (Math.abs(cx) >= CELL_RANGE || Math.abs(cy) >= CELL_RANGE) throw new RangeError(`clearance cell (${cx}, ${cy}) out of range`);
  return (cx + CELL_RANGE) * 2 * CELL_RANGE + (cy + CELL_RANGE);
}

/** Cells overlapped by any segment's box grown by `margin`, sorted and unique. */
function cellsOf(shape: ClearanceShape, margin: number): number[] {
  const out = new Set<number>();
  const s = shape.segs;
  for (let i = 0; i < s.length; i += 6) {
    const x0 = Math.floor((Math.min(s[i] as number, s[i + 3] as number) - margin) / CLEARANCE_CELL_M);
    const x1 = Math.floor((Math.max(s[i] as number, s[i + 3] as number) + margin) / CLEARANCE_CELL_M);
    const y0 = Math.floor((Math.min(s[i + 1] as number, s[i + 4] as number) - margin) / CLEARANCE_CELL_M);
    const y1 = Math.floor((Math.max(s[i + 1] as number, s[i + 4] as number) + margin) / CLEARANCE_CELL_M);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) out.add(cellKey(cx, cy));
  }
  return [...out].sort((a, b) => a - b);
}

interface Grid {
  readonly cells: Map<number, Set<PieceKey>>;
  readonly shapes: Map<PieceKey, { readonly shape: ClearanceShape; readonly cells: readonly number[] }>;
}

function gridInsert(grid: Grid, shape: ClearanceShape): void {
  if (grid.shapes.has(shape.key)) throw new Error(`clearance index already holds ${shape.key}`);
  const cells = cellsOf(shape, 0);
  for (const c of cells) {
    let set = grid.cells.get(c);
    if (!set) {
      set = new Set();
      grid.cells.set(c, set);
    }
    set.add(shape.key);
  }
  grid.shapes.set(shape.key, { shape, cells });
}

function gridCandidates(grid: Grid, queryCells: readonly number[], into: Set<PieceKey>): void {
  for (const c of queryCells) {
    const set = grid.cells.get(c);
    if (set) for (const k of set) into.add(k);
  }
}

/** An empty index; `insert` and `remove` keep it in step with the committed pieces. */
export function createClearanceIndex(): ClearanceIndex {
  const grid: Grid = { cells: new Map(), shapes: new Map() };

  function findConflict(added: readonly Piece[], ignored: ReadonlySet<PieceKey>): ClearanceConflict | null {
    const scratch: Grid = { cells: new Map(), shapes: new Map() };
    for (const piece of added) {
      const shape = clearanceShape(piece);
      const query = cellsOf(shape, MIN_PLAN_DISTANCE_M + shape.padM + CLEARANCE_SAGITTA_M);
      const candidates = new Set<PieceKey>();
      gridCandidates(grid, query, candidates);
      gridCandidates(scratch, query, candidates);
      const sorted = [...candidates].filter((k) => k !== shape.key && !ignored.has(k)).sort();
      let worst: ClearanceConflict | null = null;
      for (const key of sorted) {
        const other = (scratch.shapes.get(key) ?? grid.shapes.get(key))?.shape;
        if (!other) continue;
        const hit = shapesTooClose(shape, other);
        // Keys arrive sorted, so the strict < keeps the smaller key on a tie.
        if (hit && (worst === null || hit.distanceM < worst.distanceM)) worst = { piece: shape.key, other: key, ...hit };
      }
      if (worst) return worst;
      if (!scratch.shapes.has(shape.key)) gridInsert(scratch, shape);
    }
    return null;
  }

  return {
    get size() {
      return grid.shapes.size;
    },
    has: (key) => grid.shapes.has(key),
    insert(piece) {
      gridInsert(grid, clearanceShape(piece));
    },
    remove(key) {
      const entry = grid.shapes.get(key);
      if (!entry) throw new Error(`clearance index does not hold ${key}`);
      for (const c of entry.cells) {
        const set = grid.cells.get(c);
        set?.delete(key);
        if (set && set.size === 0) grid.cells.delete(c);
      }
      grid.shapes.delete(key);
    },
    findConflict,
  };
}
