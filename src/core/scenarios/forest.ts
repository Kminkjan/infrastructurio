import { divFloor } from "../util/int";
import { type Ground, WATER_RINGS_FAR, edgeDistanceMm, heightDmNear, nodeIndexNear, waterRingsNear } from "./ground";
import type { Occupancy } from "./layout";
import { stationsAlong } from "./roads";
import { type PointMm, hashInt, polylineDistanceMm, valueNoise } from "./shapes";

/**
 * Forests as a density field on 20 m cells, then trees scattered in it.
 * Noise shapes the stands; water, towns, lots, fields, roads and the map edge
 * clear them. Each cell holds up to 13 trees (about one per 30 m² at full
 * density), placed in a stratified 4 × 4 jitter so they never clump, and the
 * map is capped at 20,000 trees. Species follow the ground: birch by water
 * and at forest edges, pine on high dry ground, spruce elsewhere.
 */

export const FOREST_CELL_MM = 20_000;
/** A 20 m cell is 400 m²: 13 trees is one per ~30 m². */
export const TREES_PER_FULL_CELL = 13;
export const MAX_TREES = 20_000;

export const TREE_SPRUCE = 0;
export const TREE_PINE = 1;
export const TREE_BIRCH = 2;
export type TreeSpecies = typeof TREE_SPRUCE | typeof TREE_PINE | typeof TREE_BIRCH;

/** Forest density per cell, 0–255; cell (i, j) covers x ∈ [i, i + 1)·cellMm, y likewise. */
export interface ForestField {
  readonly cellMm: number;
  readonly columns: number;
  readonly rows: number;
  readonly density: Uint8Array;
}

/** Trees as parallel typed arrays (compact, and canonical JSON hashes them directly). */
export interface TreeInstances {
  readonly count: number;
  readonly xMm: Int32Array;
  readonly yMm: Int32Array;
  readonly species: Uint8Array;
  readonly seed: Uint32Array;
}

const STAND_SALT = 0x464f5231;
const DETAIL_SALT = 0x464f5232;
const SCATTER_SALT = 0x54524545;
/** Noise above this is forest; the density ramps to full over FOREST_RAMP. */
const FOREST_THRESHOLD = 180;
const FOREST_RAMP = 260;
const FOREST_EDGE_CLEAR_MM = 45_000;
const FOREST_WATER_CLEAR_RINGS = 3;
const FOREST_ROAD_CLEAR_MM = 9_000;
const SUB_CELLS = 4;
const SUB_CELL_MM = 5_000;
const HALF_CELL_MM = 10_000;

export interface ForestInputs {
  readonly towns: readonly { readonly centre: PointMm; readonly radiusMm: number }[];
  readonly roads: readonly (readonly PointMm[])[];
  readonly occupancy: Occupancy;
  /** Places trees must keep clear of, with a radius each (the windmill). */
  readonly clearings: readonly { readonly centre: PointMm; readonly radiusMm: number }[];
}

export function buildForestField(g: Ground, seedHash: number, inputs: ForestInputs): ForestField {
  const columns = divFloor(g.widthMm, FOREST_CELL_MM) + 1;
  const rows = divFloor(g.heightMm, FOREST_CELL_MM) + 1;
  const density = new Uint8Array(columns * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const c = { xMm: i * FOREST_CELL_MM + HALF_CELL_MM, yMm: j * FOREST_CELL_MM + HALF_CELL_MM };
      const n = valueNoise(seedHash, STAND_SALT, 280_000, c.xMm, c.yMm) + divFloor(valueNoise(seedHash, DETAIL_SALT, 90_000, c.xMm, c.yMm), 3);
      if (n <= FOREST_THRESHOLD) continue;
      if (edgeDistanceMm(g, c) < FOREST_EDGE_CLEAR_MM) continue;
      const rings = waterRingsNear(g, c);
      if (rings <= FOREST_WATER_CLEAR_RINGS) continue;
      if (inputs.towns.some((t) => distanceSq(c, t.centre) < sq(t.radiusMm + 30_000))) continue;
      if (inputs.clearings.some((t) => distanceSq(c, t.centre) < sq(t.radiusMm))) continue;
      // Half a cell diagonal (14 m) keeps the whole cell clear of what it touches.
      if (inputs.occupancy.covers(c, 14_200 + 4_000)) continue;
      if (inputs.roads.some((road) => polylineDistanceMm(c, road) < FOREST_ROAD_CLEAR_MM + 14_200)) continue;
      let d = Math.min(255, divFloor((n - FOREST_THRESHOLD) * 255, FOREST_RAMP));
      // Riparian thinning: open woodland on the banks.
      if (rings < 10) d = divFloor(d, 2);
      density[j * columns + i] = d;
    }
  }
  return { cellMm: FOREST_CELL_MM, columns, rows, density };
}

/**
 * Scatters trees in the field. A first pass counts what full density would
 * place, so an over-full map is thinned evenly rather than cut off in the
 * north; each tree then gets a hashed jitter, species and seed.
 */
export function scatterTrees(g: Ground, seedHash: number, field: ForestField, cap: number = MAX_TREES): TreeInstances {
  const { columns, rows, density } = field;
  let wanted = 0;
  for (let k = 0; k < density.length; k++) wanted += divFloor((density[k] ?? 0) * TREES_PER_FULL_CELL + 127, 255);
  const keepNum = Math.min(wanted, cap);
  const keepDen = Math.max(1, wanted);

  let minLand = Number.MAX_SAFE_INTEGER;
  let maxLand = Number.MIN_SAFE_INTEGER;
  const t = g.terrain;
  for (let k = 0; k < t.heightsDm.length; k++) {
    if (t.water[k] === 1) continue;
    const h = t.heightsDm[k] ?? 0;
    if (h < minLand) minLand = h;
    if (h > maxLand) maxLand = h;
  }
  const highLand = maxLand - divFloor((maxLand - minLand) * 35, 100);

  const xs: number[] = [];
  const ys: number[] = [];
  const species: number[] = [];
  const seeds: number[] = [];
  const order = new Int32Array(SUB_CELLS * SUB_CELLS);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const d = density[j * columns + i] ?? 0;
      if (d === 0) continue;
      const full = divFloor(d * TREES_PER_FULL_CELL + 127, 255);
      // Thin to the cap, rounding each cell up or down by a hash so the total stays close.
      const scaled = full * keepNum;
      let count = divFloor(scaled, keepDen);
      if (hashInt(keepDen, i, j, SCATTER_SALT, seedHash) < scaled - count * keepDen) count += 1;
      // A stratified jitter: take `count` of the 16 sub-cells in a hashed order.
      for (let s = 0; s < order.length; s++) order[s] = s;
      for (let s = order.length - 1; s > 0; s--) {
        const r = hashInt(s + 1, i, j, s, seedHash);
        const tmp = order[s] ?? 0;
        order[s] = order[r] ?? 0;
        order[r] = tmp;
      }
      for (let k = 0; k < count && k < order.length; k++) {
        const sub = order[k] ?? 0;
        const sx = sub % SUB_CELLS;
        const sy = divFloor(sub, SUB_CELLS);
        const p = {
          xMm: i * FOREST_CELL_MM + sx * SUB_CELL_MM + hashInt(SUB_CELL_MM, i, j, sub, 1, seedHash),
          yMm: j * FOREST_CELL_MM + sy * SUB_CELL_MM + hashInt(SUB_CELL_MM, i, j, sub, 2, seedHash),
        };
        if (p.xMm > g.widthMm || p.yMm > g.heightMm) continue;
        const node = nodeIndexNear(g, p);
        if (t.water[node] === 1 || (g.waterRings[node] ?? WATER_RINGS_FAR) < 2) continue;
        const roll = hashInt(100, i, j, sub, 3, seedHash);
        xs.push(p.xMm);
        ys.push(p.yMm);
        species.push(pickSpecies(roll, g.waterRings[node] ?? WATER_RINGS_FAR, heightDmNear(g, p) >= highLand, d < 128));
        seeds.push(hashInt(0x100000000, i, j, sub, 4, seedHash));
      }
    }
  }
  const count = Math.min(xs.length, cap);
  return {
    count,
    xMm: Int32Array.from(xs.slice(0, count)),
    yMm: Int32Array.from(ys.slice(0, count)),
    species: Uint8Array.from(species.slice(0, count)),
    seed: Uint32Array.from(seeds.slice(0, count)),
  };
}

/** A tree placed outside the forest field: garden and avenue trees. */
export interface LoneTree {
  readonly xMm: number;
  readonly yMm: number;
  readonly species: number;
  readonly seed: number;
}

const GARDEN_STEP_MM = 7_000;
const AVENUE_SPACING_MM = 13_000;
const AVENUE_SIDE_MM = 6_500;

/**
 * Garden trees in the towns (mostly deciduous, a few spruce) on open ground
 * between the house rows, and birch avenues along the roads: the tree-lined
 * lanes of the Baltic countryside. Hash-scattered, never on water, lots,
 * streets, fields or yards.
 */
export function loneTrees(
  g: Ground,
  seedHash: number,
  towns: readonly { readonly centre: PointMm; readonly radiusMm: number }[],
  roads: readonly (readonly PointMm[])[],
  occupancy: Occupancy,
  avoid: readonly PointMm[],
): LoneTree[] {
  const out: LoneTree[] = [];
  const free = (p: PointMm): boolean =>
    isInsideMapPoint(g, p) &&
    waterRingsNear(g, p) >= 2 &&
    !occupancy.covers(p, 2_500) &&
    !avoid.some((q) => Math.abs(q.xMm - p.xMm) < 4_000 && Math.abs(q.yMm - p.yMm) < 4_000);
  towns.forEach((town, t) => {
    const r = town.radiusMm;
    for (let j = 0; j * GARDEN_STEP_MM <= 2 * r; j++) {
      for (let i = 0; i * GARDEN_STEP_MM <= 2 * r; i++) {
        const p = {
          xMm: town.centre.xMm - r + i * GARDEN_STEP_MM + hashInt(3_000, i, j, t, 1, seedHash),
          yMm: town.centre.yMm - r + j * GARDEN_STEP_MM + hashInt(3_000, i, j, t, 2, seedHash),
        };
        const dx = p.xMm - town.centre.xMm;
        const dy = p.yMm - town.centre.yMm;
        if (dx * dx + dy * dy > r * r || hashInt(100, i, j, t, 3, seedHash) >= 30) continue;
        if (!free(p) || roads.some((road) => polylineDistanceMm(p, road) < 5_000)) continue;
        out.push({ ...p, species: hashInt(100, i, j, t, 4, seedHash) < 85 ? TREE_BIRCH : TREE_SPRUCE, seed: hashInt(0x100000000, i, j, t, 5, seedHash) });
      }
    }
  });
  roads.forEach((road, k) => {
    for (const side of [1, -1]) {
      const stations = stationsAlong(road, AVENUE_SPACING_MM, side * AVENUE_SIDE_MM);
      stations.forEach((p, i) => {
        // Leave the last stretches into town open, and thin the rows a little.
        if (i < 2 || i >= stations.length - 2 || hashInt(100, i, k, side, 6, seedHash) >= 72) return;
        if (!free(p)) return;
        out.push({ xMm: p.xMm, yMm: p.yMm, species: TREE_BIRCH, seed: hashInt(0x100000000, i, k, side, 7, seedHash) });
      });
    }
  });
  return out;
}

/** Appends lone trees to scattered forest trees (lone trees last, so forest indices are stable). */
export function withLoneTrees(forest: TreeInstances, lone: readonly LoneTree[]): TreeInstances {
  const count = forest.count + lone.length;
  const xMm = new Int32Array(count);
  const yMm = new Int32Array(count);
  const species = new Uint8Array(count);
  const seed = new Uint32Array(count);
  xMm.set(forest.xMm);
  yMm.set(forest.yMm);
  species.set(forest.species);
  seed.set(forest.seed);
  lone.forEach((t, i) => {
    const k = forest.count + i;
    xMm[k] = t.xMm;
    yMm[k] = t.yMm;
    species[k] = t.species;
    seed[k] = t.seed;
  });
  return { count, xMm, yMm, species, seed };
}

function isInsideMapPoint(g: Ground, p: PointMm): boolean {
  return p.xMm >= 20_000 && p.yMm >= 20_000 && p.xMm <= g.widthMm - 20_000 && p.yMm <= g.heightMm - 20_000;
}

/** Species by site: birch by water and at stand edges, pine up high, spruce otherwise. */
function pickSpecies(roll: number, rings: number, high: boolean, edge: boolean): number {
  let birch = 18;
  let pine = 20;
  if (rings <= 12) {
    birch = 55;
    pine = 10;
  } else if (high) {
    birch = 10;
    pine = 55;
  }
  if (edge) birch = Math.min(90, birch + 20);
  if (roll < birch) return TREE_BIRCH;
  if (roll < birch + pine) return TREE_PINE;
  return TREE_SPRUCE;
}

function distanceSq(a: PointMm, b: PointMm): number {
  const dx = a.xMm - b.xMm;
  const dy = a.yMm - b.yMm;
  return dx * dx + dy * dy;
}

function sq(n: number): number {
  return n * n;
}
