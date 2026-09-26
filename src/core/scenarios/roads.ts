import { HEADINGS, stepLengthMm, stepOf } from "../lattice";
import { nodePositionMm } from "../terrain";
import { MinHeap } from "../util/heap";
import { divFloor, isqrt } from "../util/int";
import { type Ground, WATER_RINGS_FAR, colNear, rowNear } from "./ground";
import { type PointMm, distanceMm } from "./shapes";

/**
 * Dirt roads for the static diorama: A* over the 10 m sub-lattice (nodes with
 * even q and r, all 12 headings), then corner cutting so a road reads as a
 * country lane rather than a lattice zig-zag. Costs are integer mm with slope
 * and bank penalties; water is impassable, because bridges belong to D4.
 * Ties break on node index, so the route never depends on heap order.
 */

/** Sub-lattice step: two lattice steps along a heading. */
const SUB_STEPS = HEADINGS.map((h) => {
  const s = stepOf(h);
  return { dq: 2 * s.q, dr: 2 * s.r, lengthMm: 2 * stepLengthMm(h) };
});

/** A node closer than this many rings to water costs extra; closer than one is impassable. */
const BANK_RINGS = 3;
const SLOPE_COST_PER_DM = 400;
const SLOPE_COST_PER_DM_SQ = 60;
/** Search nodes an A* run may expand before it gives up (the default map has about 35k). */
const MAX_EXPANSIONS = 60_000;

export interface RoadQuery {
  readonly from: PointMm;
  /** A point goal, or undefined to head for the nearest map edge. */
  readonly to: PointMm | undefined;
  /** Nodes a road must not use (building lots, the windmill), by full-grid index. */
  readonly blocked: Uint8Array;
}

/** Offset (col, row) → axial q. */
function axialQ(col: number, row: number): number {
  return col - divFloor(row, 2);
}

/** The sub-lattice node (even q and r) nearest to `p`, as a full-grid index; −1 if none on the map. */
export function snapToSubLattice(g: Ground, p: PointMm): number {
  const t = g.terrain;
  const row = rowNear(g, p.yMm);
  const col = colNear(g, row, p.xMm);
  const q = axialQ(col, row);
  let best = -1;
  let bestSq = Number.MAX_SAFE_INTEGER;
  for (const dq of [-1, 0, 1]) {
    for (const dr of [-1, 0, 1]) {
      const qq = q + dq;
      const rr = row + dr;
      if ((qq & 1) !== 0 || (rr & 1) !== 0 || rr < 0 || rr >= t.rows) continue;
      const cc = qq + divFloor(rr, 2);
      if (cc < 0 || cc >= t.columns) continue;
      const pos = nodePositionMm(cc, rr);
      const dx = pos.xMm - p.xMm;
      const dy = pos.yMm - p.yMm;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestSq) {
        bestSq = dSq;
        best = rr * t.columns + cc;
      }
    }
  }
  return best;
}

function positionOf(g: Ground, index: number): PointMm {
  const row = divFloor(index, g.terrain.columns);
  return nodePositionMm(index - row * g.terrain.columns, row);
}

/**
 * Routes a road; returns its node positions from `from` to the goal, or
 * undefined when no dry route exists (for example, across the river).
 */
export function routeRoad(g: Ground, query: RoadQuery): PointMm[] | undefined {
  const t = g.terrain;
  const start = snapToSubLattice(g, query.from);
  if (start < 0) return undefined;
  const goal = query.to === undefined ? -1 : snapToSubLattice(g, query.to);
  if (query.to !== undefined && goal < 0) return undefined;
  const goalPos = goal >= 0 ? positionOf(g, goal) : undefined;
  const edgeReachMm = 12_000;

  const heuristic = (p: PointMm): number =>
    goalPos !== undefined ? distanceMm(p, goalPos) : Math.max(0, Math.min(p.xMm, p.yMm, g.widthMm - p.xMm, g.heightMm - p.yMm) - edgeReachMm);
  const isGoal = (index: number, p: PointMm): boolean =>
    goal >= 0 ? index === goal : Math.min(p.xMm, p.yMm, g.widthMm - p.xMm, g.heightMm - p.yMm) <= edgeReachMm;

  const cost = new Float64Array(t.columns * t.rows).fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(t.columns * t.rows).fill(-1);
  const closed = new Uint8Array(t.columns * t.rows);
  const heap = new MinHeap<{ f: number; index: number }>((a, b) => a.f - b.f || a.index - b.index);
  cost[start] = 0;
  heap.push({ f: heuristic(positionOf(g, start)), index: start });
  let expansions = 0;
  let reached = -1;
  for (let item = heap.pop(); item !== undefined; item = heap.pop()) {
    const { index } = item;
    if (closed[index] === 1) continue;
    closed[index] = 1;
    const pos = positionOf(g, index);
    if (isGoal(index, pos)) {
      reached = index;
      break;
    }
    if (++expansions > MAX_EXPANSIONS) break;
    const row = divFloor(index, t.columns);
    const col = index - row * t.columns;
    const q = axialQ(col, row);
    const h0 = t.heightsDm[index] ?? 0;
    for (const step of SUB_STEPS) {
      const rr = row + step.dr;
      if (rr < 0 || rr >= t.rows) continue;
      const cc = q + step.dq + divFloor(rr, 2);
      if (cc < 0 || cc >= t.columns) continue;
      const next = rr * t.columns + cc;
      if (closed[next] === 1 || query.blocked[next] === 1) continue;
      const rings = g.waterRings[next] ?? WATER_RINGS_FAR;
      if (rings <= 1) continue;
      const dh = Math.abs((t.heightsDm[next] ?? 0) - h0);
      let stepCost = step.lengthMm + dh * SLOPE_COST_PER_DM + dh * dh * SLOPE_COST_PER_DM_SQ;
      if (rings <= BANK_RINGS) stepCost += divFloor(step.lengthMm, 2);
      const total = (cost[index] ?? 0) + stepCost;
      if (total < (cost[next] ?? Number.POSITIVE_INFINITY)) {
        cost[next] = total;
        parent[next] = index;
        heap.push({ f: total + heuristic(positionOf(g, next)), index: next });
      }
    }
  }
  if (reached < 0) return undefined;
  const path: PointMm[] = [];
  for (let i = reached; i >= 0; i = parent[i] ?? -1) path.push(positionOf(g, i));
  path.reverse();
  return path;
}

/** Drops interior points that continue straight on, keeping every turn. */
export function simplifyPath(points: readonly PointMm[]): PointMm[] {
  const out: PointMm[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    const a = out[out.length - 1];
    const b = points[i + 1];
    if (a && b) {
      const cross = (p.xMm - a.xMm) * (b.yMm - p.yMm) - (p.yMm - a.yMm) * (b.xMm - p.xMm);
      if (cross === 0) continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * Chaikin corner cutting in integer mm: every segment is replaced by points at
 * its quarter and three-quarter marks, keeping both end points.
 */
export function smoothPath(points: readonly PointMm[], iterations = 2): PointMm[] {
  let current = points.slice();
  for (let n = 0; n < iterations && current.length > 2; n++) {
    const next: PointMm[] = [current[0] as PointMm];
    for (let i = 0; i + 1 < current.length; i++) {
      const a = current[i] as PointMm;
      const b = current[i + 1] as PointMm;
      next.push({ xMm: divFloor(3 * a.xMm + b.xMm, 4), yMm: divFloor(3 * a.yMm + b.yMm, 4) });
      next.push({ xMm: divFloor(a.xMm + 3 * b.xMm, 4), yMm: divFloor(a.yMm + 3 * b.yMm, 4) });
    }
    next.push(current[current.length - 1] as PointMm);
    current = next;
  }
  return current;
}

/** Polyline length in mm (each segment floored). */
export function pathLengthMm(points: readonly PointMm[]): number {
  let sum = 0;
  for (let i = 0; i + 1 < points.length; i++) sum += distanceMm(points[i] as PointMm, points[i + 1] as PointMm);
  return sum;
}

/** A point along a path, with the path's local direction in per-mille. */
export interface PathStation {
  readonly xMm: number;
  readonly yMm: number;
  readonly dirX: number;
  readonly dirY: number;
}

/**
 * Points every `spacingMm` of arc length along a polyline, starting half a
 * spacing in, each moved `sideMm` to the left of the local direction. The
 * direction is the segment's, normalised to per-mille with `isqrt`.
 */
export function stationsAlong(points: readonly PointMm[], spacingMm: number, sideMm = 0): PathStation[] {
  const out: PathStation[] = [];
  let next = divFloor(spacingMm, 2);
  let walked = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as PointMm;
    const b = points[i + 1] as PointMm;
    const dx = b.xMm - a.xMm;
    const dy = b.yMm - a.yMm;
    const len = isqrt(dx * dx + dy * dy);
    if (len === 0) continue;
    const dirX = divFloor(dx * 1000, len);
    const dirY = divFloor(dy * 1000, len);
    while (next <= walked + len) {
      const along = next - walked;
      out.push({
        xMm: a.xMm + divFloor(dx * along, len) + divFloor(-dirY * sideMm, 1000),
        yMm: a.yMm + divFloor(dy * along, len) + divFloor(dirX * sideMm, 1000),
        dirX,
        dirY,
      });
      next += spacingMm;
    }
    walked += len;
  }
  return out;
}
