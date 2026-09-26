import type { Heading } from "../lattice";
import { nodePositionMm } from "../terrain";
import { divFloor } from "../util/int";
import type { Prng } from "../util/prng";
import { type Ground, edgeDistanceMm, isInsideMap, reliefAround, waterRingsNear } from "./ground";
import { type BuildingLot, type FenceRun, LAYOUT_EDGE_MARGIN_MM, type Occupancy, groundFits, lotBox } from "./layout";
import { type Obb, type PointMm, distanceMm, normalizeHeading12, obbCorners, offsetAlong } from "./shapes";

/**
 * Farmsteads and field strips. A farmstead is a fenced yard (house and barn,
 * one lot) with haystacks behind it and a group of narrow field strips beside
 * it, the period village pattern (art direction "Terrain and water"). Towns
 * get strip groups on their outskirts too.
 */

/** Crop index: the splat shader picks the palette colour from it. */
export type Crop = 0 | 1 | 2 | 3;
export const CROP_NAMES = ["rye", "hay", "crop", "fallow"] as const;

/** A crop strip: `lengthMm` along the furrows (`heading`), `widthMm` across. */
export interface Field {
  readonly xMm: number;
  readonly yMm: number;
  readonly heading: Heading;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly crop: Crop;
}

export interface Haystack {
  readonly xMm: number;
  readonly yMm: number;
  readonly seed: number;
}

const FARM_STEP = 7;
const FARM_MIN_EDGE_MM = 130_000;
const FARM_FROM_TOWN_MM = 150_000;
const FARM_SEPARATION_MM = 230_000;
const FARM_MIN_WATER_RINGS = 6;
const FARM_LENGTH_MM = 22_000;
const FARM_WIDTH_MM = 16_000;
const YARD_MARGIN_MM = 3_000;
const BALK_MM = 2_500;
export const MAX_FARMSTEADS = 6;

/**
 * Picks farmstead sites: gentle, dry, well inside the map, clear of towns and
 * each other, and ranked with a seeded jitter so they scatter.
 */
export function siteFarmsteads(
  g: Ground,
  prng: Prng,
  towns: readonly { readonly centre: PointMm; readonly radiusMm: number }[],
  avoid: readonly PointMm[],
): PointMm[] {
  const t = g.terrain;
  const candidates: { p: PointMm; score: number; index: number }[] = [];
  for (let row = FARM_STEP; row < t.rows - FARM_STEP; row += FARM_STEP) {
    for (let col = FARM_STEP; col < t.columns - FARM_STEP; col += FARM_STEP) {
      const p = nodePositionMm(col, row);
      if (edgeDistanceMm(g, p) < FARM_MIN_EDGE_MM) continue;
      if (waterRingsNear(g, p) < FARM_MIN_WATER_RINGS) continue;
      if (towns.some((town) => distanceMm(p, town.centre) < town.radiusMm + FARM_FROM_TOWN_MM)) continue;
      if (avoid.some((q) => distanceMm(p, q) < 90_000)) continue;
      const relief = reliefAround(g, p, 30_000);
      if (relief.wet || relief.maxDm - relief.minDm > 30) continue;
      candidates.push({ p, score: 4 * (relief.maxDm - relief.minDm) + prng.nextInt(200), index: row * t.columns + col });
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.index - b.index);
  const chosen: PointMm[] = [];
  for (const c of candidates) {
    if (chosen.every((q) => distanceMm(q, c.p) >= FARM_SEPARATION_MM)) chosen.push(c.p);
    if (chosen.length === MAX_FARMSTEADS) break;
  }
  return chosen;
}

/** Places a farmstead lot with its yard fence and haystacks; undefined if the site does not fit. */
export function layoutFarmstead(
  g: Ground,
  prng: Prng,
  p: PointMm,
  occupancy: Occupancy,
): { lot: BuildingLot; fences: FenceRun[]; haystacks: Haystack[] } | undefined {
  const heading = normalizeHeading12(prng.nextInt(12));
  const lot: BuildingLot = {
    kind: "farmstead",
    ...p,
    heading,
    lengthMm: FARM_LENGTH_MM,
    widthMm: FARM_WIDTH_MM,
    seed: prng.nextUint32(),
    town: -1,
  };
  const yard: Obb = { ...lotBox(lot), halfLengthMm: divFloor(FARM_LENGTH_MM, 2) + YARD_MARGIN_MM, halfWidthMm: divFloor(FARM_WIDTH_MM, 2) + YARD_MARGIN_MM };
  if (!groundFits(g, yard, 30) || !occupancy.isFree(yard, 0, 6_000)) return undefined;
  occupancy.claim(yard);

  // The yard fence: three full sides and the front split by a 4 m gate.
  const [frontRight, frontLeft, backLeft, backRight] = obbCorners(yard) as [PointMm, PointMm, PointMm, PointMm];
  const gateA = offsetAlong(p, heading, yard.halfLengthMm, -2_000);
  const gateB = offsetAlong(p, heading, yard.halfLengthMm, 2_000);
  const fences: FenceRun[] = [
    { from: frontLeft, to: backLeft },
    { from: backLeft, to: backRight },
    { from: backRight, to: frontRight },
    { from: frontRight, to: gateA },
    { from: gateB, to: frontLeft },
  ];

  const haystacks: Haystack[] = [];
  for (const side of [-1, 1]) {
    const q = offsetAlong(p, heading, -yard.halfLengthMm - 4_000, side * (4_000 + prng.nextInt(3_000)));
    if (isInsideMap(g, q, LAYOUT_EDGE_MARGIN_MM) && waterRingsNear(g, q) > 1 && occupancy.isFree({ ...q, heading: 0, halfLengthMm: 2_000, halfWidthMm: 2_000 }, 0, 1_000)) {
      haystacks.push({ ...q, seed: prng.nextUint32() });
    }
  }
  return { lot, fences, haystacks };
}

/**
 * A group of up to `count` parallel strips starting at `origin`: each runs
 * `heading`-wards, and the group steps sideways (heading + 3) with a balk
 * between strips. Strips that would touch water, leave the map, sit on steep
 * ground or collide with anything placed stop the group from growing that way.
 */
export function layoutFieldGroup(
  g: Ground,
  prng: Prng,
  origin: PointMm,
  heading: number,
  count: number,
  occupancy: Occupancy,
): { fields: Field[]; haystacks: Haystack[] } {
  const fields: Field[] = [];
  const haystacks: Haystack[] = [];
  const lengthMm = 1000 * (60 + prng.nextInt(51));
  let side = 0;
  for (let k = 0; k < count; k++) {
    const widthMm = 1000 * (11 + prng.nextInt(8));
    const centre = offsetAlong(origin, heading, divFloor(lengthMm, 2), side + divFloor(widthMm, 2));
    side += widthMm + BALK_MM;
    const box: Obb = { ...centre, heading, halfLengthMm: divFloor(lengthMm, 2), halfWidthMm: divFloor(widthMm, 2) };
    if (!fieldFits(g, box) || !occupancy.isFree(box, 0, 3_000)) break;
    occupancy.claim(box);
    const crop = pickCrop(prng);
    fields.push({ ...centre, heading: normalizeHeading12(heading), lengthMm, widthMm, crop });
    if (crop === 1) {
      const stacks = 2 + prng.nextInt(3);
      for (let i = 0; i < stacks; i++) {
        const along = divFloor(lengthMm * (2 * i + 1), 2 * stacks) - divFloor(lengthMm, 2);
        haystacks.push({ ...offsetAlong(centre, heading, along, prng.nextInt(widthMm - 4_000) - divFloor(widthMm - 4_000, 2)), seed: prng.nextUint32() });
      }
    }
  }
  return { fields, haystacks };
}

/** Fields may follow slopes, but not steep banks, and never touch water. */
function fieldFits(g: Ground, box: Obb): boolean {
  const centre = { xMm: box.xMm, yMm: box.yMm };
  for (const p of [centre, ...obbCorners(box)]) {
    if (!isInsideMap(g, p, LAYOUT_EDGE_MARGIN_MM) || waterRingsNear(g, p) < 3) return false;
  }
  const relief = reliefAround(g, centre, Math.max(box.halfLengthMm, box.halfWidthMm));
  return !relief.wet && relief.maxDm - relief.minDm <= 60;
}

/** Rye 35%, hay 25%, crop 25%, fallow 15%. */
function pickCrop(prng: Prng): Crop {
  const roll = prng.nextInt(20);
  return roll < 7 ? 0 : roll < 12 ? 1 : roll < 17 ? 2 : 3;
}
