import type { Heading } from "../lattice";
import { type Terrain, nodePositionMm, terrainHash } from "../terrain";
import { fnv1a32, hashCanonical } from "../util/hash";
import { divFloor } from "../util/int";
import { type Prng, createPrng } from "../util/prng";
import { type Field, type Haystack, layoutFarmstead, layoutFieldGroup, siteFarmsteads } from "./farms";
import { type ForestField, MAX_TREES, type TreeInstances, buildForestField, loneTrees, scatterTrees, withLoneTrees } from "./forest";
import { type Ground, createGround, edgeDistanceMm, lakeCentre, reliefAround, waterRingsNear } from "./ground";
import {
  type BuildingLot,
  type FenceRun,
  LAYOUT_EDGE_MARGIN_MM,
  Occupancy,
  type SplatPath,
  groundFits,
  lotBox,
} from "./layout";
import { BALTIC_PLACE_NAMES } from "./placeNames";
import { type PathStation, pathLengthMm, routeRoad, simplifyPath, smoothPath, stationsAlong } from "./roads";
import { type PointMm, distanceMm, normalizeHeading12, obbRadiusMm, offsetAlong } from "./shapes";
import { type StreetEnd, type Town, layoutTown, siteTowns } from "./towns";

/**
 * The static Baltic diorama for the D11a lookdev spike: a deterministic
 * scenery layout (towns, landmarks, farmsteads, fields, forests, dirt roads
 * and props) computed from the terrain and a seed. There is no simulation
 * behaviour here; the renderer draws it and Look Gate A judges it.
 *
 * Integer mm on the sim plan throughout, `util/prng` and `util/hash` for
 * every choice, so the same terrain and seed give identical output on every
 * engine (a golden hash test holds it). Nothing is placed on water, and
 * buildings keep off steep ground (`LOT_MAX_RELIEF_DM`).
 */

export const DIORAMA_SEED = "baltic-diorama";
/** Bump when a change moves any placement, alongside the golden hash. */
export const DIORAMA_GENERATOR_VERSION = 2;

export type { BuildingLot, FenceRun, LotKind, SplatPath, Surface } from "./layout";
export type { Crop, Field, Haystack } from "./farms";
export type { ForestField, TreeInstances, TreeSpecies } from "./forest";
export { TREE_BIRCH, TREE_PINE, TREE_SPRUCE } from "./forest";
export type { PointMm } from "./shapes";
export type { Town, TownSize } from "./towns";

/** A named landmark: an index into `lots`. */
export interface Landmark {
  readonly kind: "church" | "windmill";
  readonly lot: number;
  readonly town: number;
}

/** A telegraph pole; `dirX/dirY` (per-mille) is the line's direction, for the cross-arm. */
export type TelegraphPole = PathStation;

export interface DioramaScenery {
  readonly seed: string;
  readonly generatorVersion: number;
  /** The terrain this layout was made for. */
  readonly terrainHash: string;
  readonly towns: readonly Town[];
  /** Every building: town lots, farmsteads and the windmill (stations and depots are player-built, D6). */
  readonly lots: readonly BuildingLot[];
  readonly landmarks: readonly Landmark[];
  /** Town squares and streets. */
  readonly streets: readonly SplatPath[];
  /** Dirt roads between towns and off the map. */
  readonly roads: readonly SplatPath[];
  readonly fields: readonly Field[];
  readonly forest: ForestField;
  readonly trees: TreeInstances;
  readonly telegraphPoles: readonly TelegraphPole[];
  readonly lamps: readonly PointMm[];
  readonly fences: readonly FenceRun[];
  readonly haystacks: readonly Haystack[];
}

export const ROAD_WIDTH_MM = 4_000;
export const TELEGRAPH_SPACING_MM = 50_000;
const TELEGRAPH_SIDE_MM = 5_000;
/** The post mill's sails and tail pole reach about 6.6 m from the post. */
const WINDMILL_SIZE_MM = 12_000;

export function generateDiorama(terrain: Terrain, seed: string = DIORAMA_SEED): DioramaScenery {
  const g = createGround(terrain);
  const prng = createPrng(`diorama:${seed}`);
  const seedHash = fnv1a32(`diorama:${seed}`);
  const occupancy = new Occupancy();

  // Towns, largest first; the church goes in the first.
  const centres = siteTowns(g, prng);
  const names = pickNames(prng, centres.length);
  const towns: Town[] = [];
  const lots: BuildingLot[] = [];
  const streets: SplatPath[] = [];
  const lamps: PointMm[] = [];
  const fences: FenceRun[] = [];
  const ends: StreetEnd[] = [];
  const landmarks: Landmark[] = [];
  centres.forEach((centre, i) => {
    const layout = layoutTown(g, prng, centre, i, names[i] ?? `Town ${i + 1}`, i === 0 ? "large" : "small", occupancy);
    if (layout.church >= 0) landmarks.push({ kind: "church", lot: lots.length + layout.church, town: i });
    towns.push(layout.town);
    lots.push(...layout.lots);
    streets.push(...layout.streets);
    lamps.push(...layout.lamps);
    fences.push(...layout.fences);
    ends.push(...layout.ends);
  });
  const firstTown = towns[0];

  // Dirt roads: a minimum spanning tree over the town pairs a dry route joins,
  // then one road from each town off the nearest map edge.
  const blocked = blockedNodes(g, lots);
  const roads = layoutRoads(g, towns, ends, blocked);
  for (const road of roads) occupancy.claimCorridor(road.points, road.widthMm);

  // The windmill on a rise, near the lake when there is one (so one Region view holds both).
  const windmill = firstTown ? siteWindmill(g, prng, towns, lakeCentre(g), occupancy) : undefined;
  if (windmill) {
    occupancy.claim(lotBox(windmill));
    landmarks.push({ kind: "windmill", lot: lots.length, town: -1 });
    lots.push(windmill);
  }

  // Farmsteads with their strip fields, then strip fields on the towns' outskirts.
  const fields: Field[] = [];
  const haystacks: Haystack[] = [];
  const farmSites = siteFarmsteads(g, prng, towns, windmill ? [windmill] : []);
  for (const site of farmSites) {
    const farm = layoutFarmstead(g, prng, site, occupancy);
    if (!farm) continue;
    // Strips on up to two of the yard's four sides; a farm that gets none is left out
    // (its yard stays claimed, so nothing else lands there).
    const farmFields: Field[] = [];
    const farmStacks: Haystack[] = [...farm.haystacks];
    let groups = 0;
    for (const turn of [0, 6, 3, 9]) {
      if (groups === 2) break;
      const heading = normalizeHeading12(farm.lot.heading + turn);
      const origin = offsetAlong(site, heading, 18_000, 6_000);
      const group = layoutFieldGroup(g, prng, origin, heading, 3 + prng.nextInt(3), occupancy);
      if (group.fields.length === 0) continue;
      groups += 1;
      farmFields.push(...group.fields);
      farmStacks.push(...group.haystacks);
    }
    if (farmFields.length === 0) continue;
    lots.push(farm.lot);
    fences.push(...farm.fences);
    fields.push(...farmFields);
    haystacks.push(...farmStacks);
  }
  for (const town of towns) {
    for (const side of [1, -1]) {
      const heading = normalizeHeading12(town.axis + 3 + (side === 1 ? 0 : 6));
      const origin = offsetAlong(town.centre, heading, town.radiusMm + 25_000, -30_000);
      const group = layoutFieldGroup(g, prng, origin, heading, 4 + prng.nextInt(3), occupancy);
      fields.push(...group.fields);
      haystacks.push(...group.haystacks);
    }
  }

  const forest = buildForestField(g, seedHash, {
    towns,
    roads: roads.map((r) => r.points),
    occupancy,
    clearings: windmill ? [{ centre: windmill, radiusMm: 60_000 }] : [],
  });
  const telegraphPoles = layoutTelegraphPoles(g, roads, occupancy);
  // Garden and avenue trees first, so the forest is thinned to leave room under the cap.
  const lone = loneTrees(g, seedHash, towns, roads.map((r) => r.points), occupancy, [...telegraphPoles, ...lamps]);
  const trees = withLoneTrees(scatterTrees(g, seedHash, forest, MAX_TREES - lone.length), lone);

  return {
    seed,
    generatorVersion: DIORAMA_GENERATOR_VERSION,
    terrainHash: terrainHash(terrain),
    towns,
    lots,
    landmarks,
    streets,
    roads,
    fields,
    forest,
    trees,
    telegraphPoles,
    lamps,
    fences,
    haystacks,
  };
}

/** 8-hex-digit identity of a layout (canonical JSON, FNV-1a). */
export function sceneryHash(s: DioramaScenery): string {
  return hashCanonical(s);
}

/** Distinct names from the front of the list, in a seeded order. */
function pickNames(prng: Prng, count: number): string[] {
  const pool = BALTIC_PLACE_NAMES.slice(0, Math.max(count, 6));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = prng.nextInt(i + 1);
    const tmp = pool[i] as string;
    pool[i] = pool[j] as string;
    pool[j] = tmp;
  }
  return pool.slice(0, count);
}

/** Nodes under a building (plus 3 m), which roads route around. */
function blockedNodes(g: Ground, lots: readonly BuildingLot[]): Uint8Array {
  const t = g.terrain;
  const blocked = new Uint8Array(t.columns * t.rows);
  for (const lot of lots) {
    const box = lotBox(lot);
    const r = obbRadiusMm(box) + 3_000;
    const rowFrom = Math.max(0, divFloor(lot.yMm - r, 4330));
    const rowTo = Math.min(t.rows - 1, divFloor(lot.yMm + r, 4330) + 1);
    for (let row = rowFrom; row <= rowTo; row++) {
      const colFrom = Math.max(0, divFloor(lot.xMm - r, 5000) - 1);
      const colTo = Math.min(t.columns - 1, divFloor(lot.xMm + r, 5000) + 1);
      for (let col = colFrom; col <= colTo; col++) {
        const p = nodePositionMm(col, row);
        const dx = p.xMm - lot.xMm;
        const dy = p.yMm - lot.yMm;
        if (dx * dx + dy * dy <= r * r) blocked[row * t.columns + col] = 1;
      }
    }
  }
  return blocked;
}

function layoutRoads(g: Ground, towns: readonly Town[], ends: readonly StreetEnd[], blocked: Uint8Array): SplatPath[] {
  const roads: SplatPath[] = [];
  const used = new Set<StreetEnd>();
  const nearestEnd = (town: number, target: PointMm): StreetEnd | undefined => {
    let best: StreetEnd | undefined;
    for (const end of ends) {
      if (end.town !== town) continue;
      if (!best || distanceMm(end.point, target) < distanceMm(best.point, target)) best = end;
    }
    return best;
  };
  const toPath = (points: PointMm[]): SplatPath => ({
    surface: "dirt",
    widthMm: ROAD_WIDTH_MM,
    points: smoothPath(simplifyPath(points)),
  });

  const candidates: { a: number; b: number; path: PointMm[]; from: StreetEnd; to: StreetEnd }[] = [];
  for (let a = 0; a < towns.length; a++) {
    for (let b = a + 1; b < towns.length; b++) {
      const from = nearestEnd(a, (towns[b] as Town).centre);
      const to = nearestEnd(b, (towns[a] as Town).centre);
      if (!from || !to) continue;
      const path = routeRoad(g, { from: from.point, to: to.point, blocked });
      if (path) candidates.push({ a, b, path: [from.point, ...path, to.point], from, to });
    }
  }
  candidates.sort((x, y) => pathLengthMm(x.path) - pathLengthMm(y.path) || x.a - y.a || x.b - y.b);
  const group = towns.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : root(group[i] ?? i));
  for (const c of candidates) {
    const ra = root(c.a);
    const rb = root(c.b);
    if (ra === rb) continue;
    group[rb] = ra;
    roads.push(toPath(c.path));
    used.add(c.from);
    used.add(c.to);
  }

  towns.forEach((_, i) => {
    let best: StreetEnd | undefined;
    for (const end of ends) {
      if (end.town !== i || used.has(end)) continue;
      if (!best || edgeDistanceMm(g, end.point) < edgeDistanceMm(g, best.point)) best = end;
    }
    if (!best) return;
    const path = routeRoad(g, { from: best.point, to: undefined, blocked });
    if (path) roads.push(toPath([best.point, ...path]));
  });
  return roads;
}

/**
 * The windmill: the most prominent dry, gentle rise (height above the mean of
 * the surrounding 90 m) that keeps 160 m from every town centre and clear of
 * the towns themselves, and lies 220–450 m from the lake's centre. Without a
 * lake it looks within 600 m of the largest town instead.
 */
function siteWindmill(
  g: Ground,
  prng: Prng,
  towns: readonly Town[],
  lake: PointMm | undefined,
  occupancy: Occupancy,
): BuildingLot | undefined {
  const t = g.terrain;
  const largest = towns[0];
  let best: { p: PointMm; score: number } | undefined;
  for (let row = 3; row < t.rows - 3; row += 3) {
    for (let col = 3; col < t.columns - 3; col += 3) {
      const p = nodePositionMm(col, row);
      if (lake) {
        const d = distanceMm(p, lake);
        if (d < 220_000 || d > 450_000) continue;
      } else if (!largest || distanceMm(p, largest.centre) > 600_000) {
        continue;
      }
      if (towns.some((town) => distanceMm(p, town.centre) < Math.max(160_000, town.radiusMm + 40_000))) continue;
      if (edgeDistanceMm(g, p) < LAYOUT_EDGE_MARGIN_MM + 20_000 || waterRingsNear(g, p) < 8) continue;
      const wide = reliefAround(g, p, 90_000);
      if (wide.wet) continue;
      const here = reliefAround(g, p, 8_000);
      const score = here.meanDm - wide.meanDm;
      if (!best || score > best.score) best = { p, score };
    }
  }
  if (!best || best.score <= 0) return undefined;
  const heading: Heading = normalizeHeading12(8 + prng.nextInt(3));
  const lot: BuildingLot = {
    kind: "windmill",
    ...best.p,
    heading,
    lengthMm: WINDMILL_SIZE_MM,
    widthMm: WINDMILL_SIZE_MM,
    seed: prng.nextUint32(),
    town: -1,
  };
  const box = lotBox(lot);
  return groundFits(g, box) && occupancy.isFree(box, 0, 4_000) ? lot : undefined;
}

/** Poles every 50 m along the longest road, 5 m to its side, skipping any that would stand in water or a lot. */
function layoutTelegraphPoles(g: Ground, roads: readonly SplatPath[], occupancy: Occupancy): TelegraphPole[] {
  let longest: SplatPath | undefined;
  for (const road of roads) if (!longest || pathLengthMm(road.points) > pathLengthMm(longest.points)) longest = road;
  if (!longest) return [];
  return stationsAlong(longest.points, TELEGRAPH_SPACING_MM, TELEGRAPH_SIDE_MM).filter(
    (pole) => waterRingsNear(g, pole) >= 1 && !occupancy.covers(pole, 1_000) && edgeDistanceMm(g, pole) > 5_000,
  );
}
