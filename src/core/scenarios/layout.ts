import type { Heading } from "../lattice";
import { divFloor } from "../util/int";
import { type Ground, isInsideMap, reliefAround } from "./ground";
import { type Obb, type PointMm, obbContains, obbOverlap, obbRadiusMm, polylineDistanceMm } from "./shapes";

/**
 * Shared scenery types and the occupancy book-keeping that keeps placements
 * apart: every building, street, field and yard claims an oriented box, and
 * roads claim a corridor. Later placements test against everything earlier,
 * so generation order is part of the layout (and of the golden hash).
 */

/** Building kinds the scenario places (the render grammar builds each one). */
export type LotKind =
  | "townhouse"
  | "wooden-house"
  | "warehouse"
  | "church"
  | "station"
  | "engine-shed"
  | "water-tower"
  | "windmill"
  | "farmstead";

/**
 * A building lot. Model space is +X forward: the front (door, facade, sails)
 * faces sim `heading`. `lengthMm` runs along the heading (model X) and
 * `widthMm` across it (model Z); both are whole metres.
 */
export interface BuildingLot {
  readonly kind: LotKind;
  readonly xMm: number;
  readonly yMm: number;
  readonly heading: Heading;
  readonly lengthMm: number;
  readonly widthMm: number;
  /** uint32 variation seed for the grammar. */
  readonly seed: number;
  /** Index of the town the lot belongs to, or −1. */
  readonly town: number;
}

export type Surface = "dirt" | "cobble";

/** A splat path: a polyline painted onto the terrain at `widthMm`. */
export interface SplatPath {
  readonly surface: Surface;
  readonly widthMm: number;
  readonly points: readonly PointMm[];
}

/** A fence from one post to another; the render repeats a panel along it. */
export interface FenceRun {
  readonly from: PointMm;
  readonly to: PointMm;
}

/** Lots never straddle more relief than this (dm) under their footprint: 2.5 m. */
export const LOT_MAX_RELIEF_DM = 25;
/** Lots keep at least this far from any water node. */
export const LOT_WATER_MARGIN_MM = 8_000;
/** Everything stays this far inside the map edge. */
export const LAYOUT_EDGE_MARGIN_MM = 40_000;

export function lotBox(lot: Pick<BuildingLot, "xMm" | "yMm" | "heading" | "lengthMm" | "widthMm">): Obb {
  return {
    xMm: lot.xMm,
    yMm: lot.yMm,
    heading: lot.heading,
    halfLengthMm: divFloor(lot.lengthMm, 2),
    halfWidthMm: divFloor(lot.widthMm, 2),
  };
}

/** Whether the ground under a box is dry and gentle enough for a building. */
export function groundFits(g: Ground, box: Obb, maxReliefDm = LOT_MAX_RELIEF_DM): boolean {
  const centre = { xMm: box.xMm, yMm: box.yMm };
  if (!isInsideMap(g, centre, LAYOUT_EDGE_MARGIN_MM + obbRadiusMm(box))) return false;
  const radius = obbRadiusMm(box);
  if (reliefAround(g, centre, radius + LOT_WATER_MARGIN_MM).wet) return false;
  const relief = reliefAround(g, centre, radius);
  return relief.maxDm - relief.minDm <= maxReliefDm;
}

/** Everything placed so far. */
export class Occupancy {
  readonly boxes: Obb[] = [];
  readonly corridors: { readonly points: readonly PointMm[]; readonly halfWidthMm: number }[] = [];

  /** Whether `box` is clear of every claimed box (by `slackMm`) and road corridor (by `marginMm`). */
  isFree(box: Obb, slackMm = 300, marginMm = 2_000): boolean {
    for (const other of this.boxes) if (obbOverlap(box, other, slackMm)) return false;
    if (this.corridors.length > 0) {
      const centre = { xMm: box.xMm, yMm: box.yMm };
      const reach = obbRadiusMm(box) + marginMm;
      for (const road of this.corridors) {
        if (polylineDistanceMm(centre, road.points) < reach + road.halfWidthMm) return false;
      }
    }
    return true;
  }

  /** Whether a point is inside any claimed box grown by `marginMm`. */
  covers(p: PointMm, marginMm = 0): boolean {
    for (const box of this.boxes) if (obbContains(box, p, marginMm)) return true;
    return false;
  }

  claim(box: Obb): void {
    this.boxes.push(box);
  }

  claimCorridor(points: readonly PointMm[], widthMm: number): void {
    this.corridors.push({ points, halfWidthMm: divFloor(widthMm, 2) });
  }
}
