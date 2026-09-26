import type { Heading } from "../lattice";
import { nodePositionMm } from "../terrain";
import { divFloor } from "../util/int";
import type { Prng } from "../util/prng";
import { type Ground, edgeDistanceMm, reliefAround, waterRingsNear } from "./ground";
import {
  type BuildingLot,
  type FenceRun,
  type LotKind,
  type Occupancy,
  type SplatPath,
  groundFits,
  lotBox,
} from "./layout";
import { type Obb, type PointMm, distanceMm, normalizeHeading12, obbContains, offsetAlong } from "./shapes";

/**
 * Towns: siting on dry, gentle ground away from the edges, then a cross-shaped
 * cobbled square with streets along two perpendicular lattice headings and
 * building lots facing them. Townhouses crowd the centre, wooden houses with
 * front fences take the outskirts, and warehouses sit at the far ends.
 */

export type TownSize = "large" | "small";

export interface Town {
  readonly name: string;
  readonly centre: PointMm;
  /** Main street heading (primary: 0, 2 or 4); the cross street runs at axis + 3 (90°). */
  readonly axis: Heading;
  readonly size: TownSize;
  /** The town's reach from its centre, for keeping farms and forest out. */
  readonly radiusMm: number;
}

export interface StreetEnd {
  readonly point: PointMm;
  /** Outward heading of the street at this end. */
  readonly heading: number;
  readonly town: number;
}

export interface TownLayout {
  readonly town: Town;
  readonly lots: BuildingLot[];
  readonly streets: SplatPath[];
  readonly lamps: PointMm[];
  readonly fences: FenceRun[];
  readonly ends: StreetEnd[];
  /** Index into `lots` of the church, or −1. */
  readonly church: number;
}

/** Candidate spacing for town centres: every 4th row and column (about 17 × 20 m). */
const SITE_STEP = 4;
const SITE_EDGE_MM = 260_000;
const SITE_MIN_WATER_RINGS = 12;
const SITE_IDEAL_WATER_RINGS = 24;
const SITE_RELIEF_RADIUS_MM = 70_000;
const SITE_MAX_RELIEF_DM = 40;
const TOWN_SEPARATION_MM = 520_000;
export const MAX_TOWNS = 3;

interface TownShape {
  readonly mainHalfMm: number;
  readonly crossHalfMm: number;
  /** Townhouses closer than this along a street, wooden houses beyond `outskirtsMm`. */
  readonly coreMm: number;
  readonly outskirtsMm: number;
}

const SHAPES: Readonly<Record<TownSize, TownShape>> = {
  large: { mainHalfMm: 125_000, crossHalfMm: 85_000, coreMm: 58_000, outskirtsMm: 88_000 },
  small: { mainHalfMm: 92_000, crossHalfMm: 62_000, coreMm: 40_000, outskirtsMm: 62_000 },
};

/** Square arms: along the main axis 60 × 18 m, across it 42 × 14 m. */
const SQUARE_MAIN = { halfLengthMm: 30_000, halfWidthMm: 9_000 };
const SQUARE_CROSS = { halfLengthMm: 21_000, halfWidthMm: 7_000 };
const MAIN_STREET_HALF_MM = 3_000;
const CROSS_STREET_HALF_MM = 2_500;
const LAMP_SPACING_MM = 24_000;

/**
 * Picks up to MAX_TOWNS centres, best first: dry, within reach of water (a
 * river town), gentle over 70 m, and at least 260 m from the map edge. The
 * first is the largest town. If fewer than two qualify, the relief limit is
 * relaxed once, so a rough seed still gets two towns.
 */
export function siteTowns(g: Ground, prng: Prng): PointMm[] {
  for (const maxRelief of [SITE_MAX_RELIEF_DM, SITE_MAX_RELIEF_DM * 2]) {
    const candidates: { p: PointMm; score: number; index: number }[] = [];
    const t = g.terrain;
    for (let row = SITE_STEP; row < t.rows - SITE_STEP; row += SITE_STEP) {
      for (let col = SITE_STEP; col < t.columns - SITE_STEP; col += SITE_STEP) {
        const p = nodePositionMm(col, row);
        if (edgeDistanceMm(g, p) < SITE_EDGE_MM) continue;
        const rings = waterRingsNear(g, p);
        if (rings < SITE_MIN_WATER_RINGS) continue;
        const relief = reliefAround(g, p, SITE_RELIEF_RADIUS_MM);
        if (relief.wet || relief.maxDm - relief.minDm > maxRelief) continue;
        const score =
          10 * (relief.maxDm - relief.minDm) + 3 * Math.abs(Math.min(rings, 120) - SITE_IDEAL_WATER_RINGS) + prng.nextInt(60);
        candidates.push({ p, score, index: row * t.columns + col });
      }
    }
    candidates.sort((a, b) => a.score - b.score || a.index - b.index);
    const chosen: PointMm[] = [];
    for (const c of candidates) {
      if (chosen.every((other) => distanceMm(other, c.p) >= TOWN_SEPARATION_MM)) chosen.push(c.p);
      if (chosen.length === MAX_TOWNS) break;
    }
    if (chosen.length >= 2) return chosen;
  }
  return [];
}

/** Lays out one town and claims its footprint in `occupancy`. */
export function layoutTown(
  g: Ground,
  prng: Prng,
  centre: PointMm,
  townIndex: number,
  name: string,
  size: TownSize,
  occupancy: Occupancy,
): TownLayout {
  const shape = SHAPES[size];
  const axis = (2 * prng.nextInt(3)) as Heading;
  const cross = axis + 3;
  const town: Town = { name, centre, axis, size, radiusMm: shape.mainHalfMm + 20_000 };
  const lots: BuildingLot[] = [];
  const streets: SplatPath[] = [];
  const lamps: PointMm[] = [];
  const fences: FenceRun[] = [];

  // The cross-shaped square and the two streets through it.
  const squareMain: Obb = { ...centre, heading: axis, ...SQUARE_MAIN };
  const squareCross: Obb = { ...centre, heading: cross, ...SQUARE_CROSS };
  streets.push(pathOf(squareMain, "cobble"), pathOf(squareCross, "cobble"));
  const mainStreet: Obb = { ...centre, heading: axis, halfLengthMm: shape.mainHalfMm, halfWidthMm: MAIN_STREET_HALF_MM };
  const crossStreet: Obb = { ...centre, heading: cross, halfLengthMm: shape.crossHalfMm, halfWidthMm: CROSS_STREET_HALF_MM };
  streets.push(pathOf(mainStreet, "cobble"), pathOf(crossStreet, size === "large" ? "cobble" : "dirt"));
  for (const box of [squareMain, squareCross, mainStreet, crossStreet]) occupancy.claim(box);

  const place = (lot: BuildingLot, slackMm = 300): boolean => {
    const box = lotBox(lot);
    if (!groundFits(g, box) || !occupancy.isFree(box, slackMm)) return false;
    occupancy.claim(box);
    lots.push(lot);
    return true;
  };

  // The church (largest town only) faces the main street from beside the square.
  let church = -1;
  if (size === "large") {
    for (const side of [1, -1]) {
      const along = SQUARE_CROSS.halfWidthMm + 2_000 + 7_500;
      const out = SQUARE_MAIN.halfWidthMm + 3_000 + 15_000;
      const p = offsetAlong(centre, axis, along, side * out);
      const lot: BuildingLot = {
        kind: "church",
        ...p,
        heading: normalizeHeading12(side === 1 ? cross + 6 : cross),
        lengthMm: 30_000,
        widthMm: 15_000,
        seed: prng.nextUint32(),
        town: townIndex,
      };
      if (place(lot, 0)) {
        church = lots.length - 1;
        break;
      }
    }
  }

  // Lots along the four street arms, both sides, walking outward from the square.
  const arms = [
    { heading: axis, halfLengthMm: shape.mainHalfMm, startMm: SQUARE_MAIN.halfLengthMm, streetHalfMm: MAIN_STREET_HALF_MM },
    { heading: axis + 6, halfLengthMm: shape.mainHalfMm, startMm: SQUARE_MAIN.halfLengthMm, streetHalfMm: MAIN_STREET_HALF_MM },
    { heading: cross, halfLengthMm: shape.crossHalfMm, startMm: SQUARE_CROSS.halfLengthMm, streetHalfMm: CROSS_STREET_HALF_MM },
    { heading: cross + 6, halfLengthMm: shape.crossHalfMm, startMm: SQUARE_CROSS.halfLengthMm, streetHalfMm: CROSS_STREET_HALF_MM },
  ];
  let warehouses = 0;
  for (const arm of arms) {
    for (const side of [1, -1]) {
      let s = arm.startMm + 2_000;
      while (s < arm.halfLengthMm - 4_000) {
        const kind = lotKindAt(prng, s, shape, arm.halfLengthMm, warehouses);
        const dims = lotDims(prng, kind);
        const along = s + divFloor(dims.widthMm, 2);
        const sideMm = side * (arm.streetHalfMm + dims.setbackMm + divFloor(dims.lengthMm, 2));
        const p = offsetAlong(centre, arm.heading, along, sideMm);
        const lot: BuildingLot = {
          kind,
          ...p,
          // The front faces back across to the street.
          heading: normalizeHeading12(arm.heading - 3 * side),
          lengthMm: dims.lengthMm,
          widthMm: dims.widthMm,
          seed: prng.nextUint32(),
          town: townIndex,
        };
        if (place(lot)) {
          if (kind === "warehouse") warehouses += 1;
          if (kind === "wooden-house") fences.push(...frontFence(lot, arm.streetHalfMm, side, centre, arm.heading, along));
          s += dims.widthMm + dims.gapMm;
        } else {
          s += 3_000;
        }
      }
    }
  }

  // Lamps along the main street through the core, alternating sides, and at the square's corners.
  for (const dir of [axis, axis + 6]) {
    let k = 0;
    for (let s = SQUARE_MAIN.halfLengthMm + 8_000; s < shape.coreMm + 16_000; s += LAMP_SPACING_MM) {
      const side = k++ % 2 === 0 ? 1 : -1;
      const p = offsetAlong(centre, dir, s, side * (MAIN_STREET_HALF_MM + 700));
      if (!lots.some((lot) => obbContains(lotBox(lot), p, 300))) lamps.push(p);
    }
  }
  for (const [a, c] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const p = offsetAlong(centre, axis, a * (SQUARE_CROSS.halfWidthMm + 1_500), c * (SQUARE_MAIN.halfWidthMm + 1_500));
    if (!lots.some((lot) => obbContains(lotBox(lot), p, 300))) lamps.push(p);
  }

  const ends: StreetEnd[] = [
    { point: offsetAlong(centre, axis, shape.mainHalfMm), heading: axis, town: townIndex },
    { point: offsetAlong(centre, axis + 6, shape.mainHalfMm), heading: axis + 6, town: townIndex },
    { point: offsetAlong(centre, cross, shape.crossHalfMm), heading: cross, town: townIndex },
    { point: offsetAlong(centre, cross + 6, shape.crossHalfMm), heading: cross + 6, town: townIndex },
  ];
  return { town, lots, streets, lamps, fences, ends, church };
}

function lotKindAt(prng: Prng, s: number, shape: TownShape, armMm: number, warehouses: number): LotKind {
  if (s < shape.coreMm) return "townhouse";
  if (s < shape.outskirtsMm) return prng.nextInt(10) < 6 ? "townhouse" : "wooden-house";
  if (warehouses < 2 && s > armMm - 30_000 && prng.nextInt(3) === 0) return "warehouse";
  return "wooden-house";
}

interface LotDims {
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly setbackMm: number;
  readonly gapMm: number;
}

/** Footprints in whole metres: length is depth from the street, width runs along it. */
function lotDims(prng: Prng, kind: LotKind): LotDims {
  const metres = (lo: number, hi: number): number => 1000 * (lo + prng.nextInt(hi - lo + 1));
  switch (kind) {
    case "townhouse":
      return { lengthMm: metres(10, 12), widthMm: metres(8, 12), setbackMm: 1_000, gapMm: metres(0, 1) };
    case "warehouse":
      return { lengthMm: metres(12, 14), widthMm: metres(16, 20), setbackMm: 3_000, gapMm: metres(4, 6) };
    default:
      return { lengthMm: metres(7, 9), widthMm: metres(8, 10), setbackMm: 5_000, gapMm: metres(4, 8) };
  }
}

/** Two fence runs along the street edge in front of a wooden house, leaving a 2 m gate. */
function frontFence(lot: BuildingLot, streetHalfMm: number, side: number, centre: PointMm, heading: number, along: number): FenceRun[] {
  const line = side * (streetHalfMm + 1_500);
  const half = divFloor(lot.widthMm, 2);
  return [
    { from: offsetAlong(centre, heading, along - half, line), to: offsetAlong(centre, heading, along - 1_000, line) },
    { from: offsetAlong(centre, heading, along + 1_000, line), to: offsetAlong(centre, heading, along + half, line) },
  ];
}

/** A box as a splat path along its heading. */
function pathOf(box: Obb, surface: SplatPath["surface"]): SplatPath {
  const c = { xMm: box.xMm, yMm: box.yMm };
  return {
    surface,
    widthMm: 2 * box.halfWidthMm,
    points: [offsetAlong(c, box.heading, -box.halfLengthMm), offsetAlong(c, box.heading, box.halfLengthMm)],
  };
}
