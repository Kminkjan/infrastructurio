import { type Terrain, nodePositionMm, terrainExtentMm } from "../terrain";
import { clampInt, divFloor } from "../util/int";
import type { PointMm } from "./shapes";

/**
 * Terrain queries for scenery layout, in integer mm on the sim plan. Heights
 * are the sim's own node heights (dm); nothing here interpolates with floats,
 * so layout decisions are the same on every engine.
 */

/** Row pitch 4330.127… mm in µm, for integer nearest-row rounding. */
const ROW_PITCH_UM = 4_330_127;
/** Water rings the breadth-first search expands (5 m each): 300 m. */
export const WATER_RING_CAP = 60;
export const WATER_RINGS_FAR = 255;

export interface Ground {
  readonly terrain: Terrain;
  readonly widthMm: number;
  readonly heightMm: number;
  /** Lattice rings to the nearest water node, WATER_RINGS_FAR beyond WATER_RING_CAP. */
  readonly waterRings: Uint8Array;
}

/** Relief of a patch: node height range, and whether any node in it is water. */
export interface Relief {
  readonly minDm: number;
  readonly maxDm: number;
  readonly meanDm: number;
  readonly wet: boolean;
  readonly nodes: number;
}

export function createGround(terrain: Terrain): Ground {
  const { widthMm, heightMm } = terrainExtentMm(terrain);
  return { terrain, widthMm, heightMm, waterRings: waterRings(terrain) };
}

/** The six neighbours as (dCol, dRow) for even and odd rows (odd rows sit half a step east). */
const EVEN_NEIGHBOURS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]] as const;
const ODD_NEIGHBOURS = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]] as const;

/** Multi-source breadth-first search over the six-neighbour lattice from every water node. */
function waterRings(t: Terrain): Uint8Array {
  const { columns, rows } = t;
  const rings = new Uint8Array(columns * rows).fill(WATER_RINGS_FAR);
  const queue = new Int32Array(columns * rows);
  let tail = 0;
  for (let i = 0; i < t.water.length; i++) {
    if (t.water[i] === 1) {
      rings[i] = 0;
      queue[tail++] = i;
    }
  }
  for (let head = 0; head < tail; head++) {
    const index = queue[head] ?? 0;
    const d = rings[index] ?? 0;
    if (d >= WATER_RING_CAP) continue;
    const row = divFloor(index, columns);
    const col = index - row * columns;
    for (const [dc, dr] of (row & 1) === 0 ? EVEN_NEIGHBOURS : ODD_NEIGHBOURS) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || c >= columns || r < 0 || r >= rows) continue;
      const next = r * columns + c;
      if (rings[next] === WATER_RINGS_FAR) {
        rings[next] = d + 1;
        queue[tail++] = next;
      }
    }
  }
  return rings;
}

/** Nearest row to a plan y, clamped to the map. */
export function rowNear(g: Ground, yMm: number): number {
  return clampInt(divFloor(yMm * 1000 + divFloor(ROW_PITCH_UM, 2), ROW_PITCH_UM), 0, g.terrain.rows - 1);
}

/** Nearest column in `row` to a plan x, clamped to the map. */
export function colNear(g: Ground, row: number, xMm: number): number {
  const parity = row & 1;
  return clampInt(divFloor(xMm - 2500 * parity + 2500, 5000), 0, g.terrain.columns - 1);
}

/** Index of the node nearest (within a row's rounding) to `p`, clamped to the map. */
export function nodeIndexNear(g: Ground, p: PointMm): number {
  const row = rowNear(g, p.yMm);
  return row * g.terrain.columns + colNear(g, row, p.xMm);
}

export function heightDmNear(g: Ground, p: PointMm): number {
  return g.terrain.heightsDm[nodeIndexNear(g, p)] ?? 0;
}

export function waterRingsNear(g: Ground, p: PointMm): number {
  return g.waterRings[nodeIndexNear(g, p)] ?? WATER_RINGS_FAR;
}

export function isInsideMap(g: Ground, p: PointMm, marginMm = 0): boolean {
  return p.xMm >= marginMm && p.yMm >= marginMm && p.xMm <= g.widthMm - marginMm && p.yMm <= g.heightMm - marginMm;
}

export function edgeDistanceMm(g: Ground, p: PointMm): number {
  return Math.min(p.xMm, p.yMm, g.widthMm - p.xMm, g.heightMm - p.yMm);
}

/**
 * Heights of every node within `radiusMm` of `p` (plus the nearest node, so
 * a tiny radius still sees one). Off-map parts of the disc are ignored.
 */
export function reliefAround(g: Ground, p: PointMm, radiusMm: number): Relief {
  const t = g.terrain;
  const r0 = rowNear(g, p.yMm - radiusMm);
  const r1 = rowNear(g, p.yMm + radiusMm);
  const radiusSq = radiusMm * radiusMm;
  const nearest = nodeIndexNear(g, p);
  let minDm = t.heightsDm[nearest] ?? 0;
  let maxDm = minDm;
  let sum = 0;
  let nodes = 0;
  let wet = t.water[nearest] === 1;
  for (let row = r0; row <= r1; row++) {
    const c0 = colNear(g, row, p.xMm - radiusMm);
    const c1 = colNear(g, row, p.xMm + radiusMm);
    for (let col = c0; col <= c1; col++) {
      const pos = nodePositionMm(col, row);
      const dx = pos.xMm - p.xMm;
      const dy = pos.yMm - p.yMm;
      if (dx * dx + dy * dy > radiusSq) continue;
      const index = row * t.columns + col;
      const h = t.heightsDm[index] ?? 0;
      if (h < minDm) minDm = h;
      if (h > maxDm) maxDm = h;
      sum += h;
      nodes += 1;
      if (t.water[index] === 1) wet = true;
    }
  }
  return { minDm, maxDm, meanDm: nodes > 0 ? divFloor(sum, nodes) : minDm, wet, nodes };
}

/**
 * The mean node position of the water not connected to the west edge (the
 * lake, by the terrain's one-river-one-lake invariant), in integer mm; or
 * undefined when every water node belongs to the river.
 */
export function lakeCentre(g: Ground): { xMm: number; yMm: number } | undefined {
  const t = g.terrain;
  const river = new Uint8Array(t.water.length);
  const stack: number[] = [];
  for (let row = 0; row < t.rows; row++) {
    const i = row * t.columns;
    if (t.water[i] === 1) {
      river[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length > 0) {
    const index = stack.pop() as number;
    const row = divFloor(index, t.columns);
    const col = index - row * t.columns;
    for (const [dc, dr] of (row & 1) === 0 ? EVEN_NEIGHBOURS : ODD_NEIGHBOURS) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || c >= t.columns || r < 0 || r >= t.rows) continue;
      const next = r * t.columns + c;
      if (t.water[next] === 1 && river[next] === 0) {
        river[next] = 1;
        stack.push(next);
      }
    }
  }
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < t.water.length; i++) {
    if (t.water[i] !== 1 || river[i] === 1) continue;
    const row = divFloor(i, t.columns);
    const p = nodePositionMm(i - row * t.columns, row);
    sx += p.xMm;
    sy += p.yMm;
    n += 1;
  }
  return n === 0 ? undefined : { xMm: divFloor(sx, n), yMm: divFloor(sy, n) };
}
