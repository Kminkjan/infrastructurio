import type { Heading } from "../lattice";
import { hash32 } from "../util/hash";
import { divFloor, isqrt } from "../util/int";

/**
 * Integer plan geometry for scenery layout: lattice directions in per-mille,
 * oriented boxes on lattice headings, point–segment distance and value
 * noise. Everything is in integer mm (x east, y north), so the layout is
 * identical on every engine; there is no trigonometry.
 */

/** A point in sim plan mm. */
export interface PointMm {
  readonly xMm: number;
  readonly yMm: number;
}

/**
 * Unit vectors of the 12 lattice headings in per-mille (1000 = 1),
 * counter-clockwise from east. 866 stands for √3/2 ≈ 0.866025: over a 150 m
 * street that is 4 mm off the true lattice direction, far below anything
 * that shows, and it keeps every placement an exact integer.
 */
export const DIR_PERMILLE: readonly (readonly [number, number])[] = Object.freeze([
  [1000, 0],
  [866, 500],
  [500, 866],
  [0, 1000],
  [-500, 866],
  [-866, 500],
  [-1000, 0],
  [-866, -500],
  [-500, -866],
  [0, -1000],
  [500, -866],
  [866, -500],
]);

export function normalizeHeading12(h: number): Heading {
  return (((h % 12) + 12) % 12) as Heading;
}

export function dirOf(h: number): readonly [number, number] {
  return DIR_PERMILLE[normalizeHeading12(h)] ?? [1000, 0];
}

/** `p` moved `distMm` along heading `h` and `sideMm` to its left (heading h + 3). */
export function offsetAlong(p: PointMm, h: number, distMm: number, sideMm = 0): PointMm {
  const [ux, uy] = dirOf(h);
  const [vx, vy] = dirOf(h + 3);
  return {
    xMm: p.xMm + divFloor(ux * distMm + vx * sideMm, 1000),
    yMm: p.yMm + divFloor(uy * distMm + vy * sideMm, 1000),
  };
}

/** An oriented rectangle on a lattice heading: length along `heading`, width across it. */
export interface Obb {
  readonly xMm: number;
  readonly yMm: number;
  readonly heading: number;
  readonly halfLengthMm: number;
  readonly halfWidthMm: number;
}

/**
 * Separating-axis overlap test for two oriented rectangles. Touching or
 * overlapping by less than `slackMm` does not count, so rows of houses can
 * stand wall to wall. Projections are in mm·1000 (per-mille axes), at most
 * about 2e9, far inside the safe-integer range.
 */
export function obbOverlap(a: Obb, b: Obb, slackMm = 0): boolean {
  const dx = b.xMm - a.xMm;
  const dy = b.yMm - a.yMm;
  for (const h of [a.heading, a.heading + 3, b.heading, b.heading + 3]) {
    const [ax, ay] = dirOf(h);
    const distance = Math.abs(dx * ax + dy * ay);
    if (distance >= projectedRadius(a, ax, ay) + projectedRadius(b, ax, ay) - slackMm * 1000) return false;
  }
  return true;
}

/** Half the extent of `box` along a per-mille axis, in mm·1000. */
function projectedRadius(box: Obb, ax: number, ay: number): number {
  const [ux, uy] = dirOf(box.heading);
  const [vx, vy] = dirOf(box.heading + 3);
  return divFloor(box.halfLengthMm * Math.abs(ux * ax + uy * ay) + box.halfWidthMm * Math.abs(vx * ax + vy * ay), 1000);
}

/** Whether `p` lies inside `box` grown by `marginMm` on every side. */
export function obbContains(box: Obb, p: PointMm, marginMm = 0): boolean {
  const dx = p.xMm - box.xMm;
  const dy = p.yMm - box.yMm;
  const [ux, uy] = dirOf(box.heading);
  const [vx, vy] = dirOf(box.heading + 3);
  return (
    Math.abs(dx * ux + dy * uy) <= (box.halfLengthMm + marginMm) * 1000 &&
    Math.abs(dx * vx + dy * vy) <= (box.halfWidthMm + marginMm) * 1000
  );
}

/** The four corners of `box`, counter-clockwise. */
export function obbCorners(box: Obb): PointMm[] {
  const c = { xMm: box.xMm, yMm: box.yMm };
  return [
    offsetAlong(c, box.heading, box.halfLengthMm, -box.halfWidthMm),
    offsetAlong(c, box.heading, box.halfLengthMm, box.halfWidthMm),
    offsetAlong(c, box.heading, -box.halfLengthMm, box.halfWidthMm),
    offsetAlong(c, box.heading, -box.halfLengthMm, -box.halfWidthMm),
  ];
}

/** The circumradius of a box, rounded up to whole mm. */
export function obbRadiusMm(box: Pick<Obb, "halfLengthMm" | "halfWidthMm">): number {
  return isqrt(box.halfLengthMm * box.halfLengthMm + box.halfWidthMm * box.halfWidthMm) + 1;
}

/** 2^40: keeps num·4096 below 2^52 in `segmentDistanceMm`. */
const FRACTION_LIMIT = 1_099_511_627_776;

export function distanceMm(a: PointMm, b: PointMm): number {
  const dx = b.xMm - a.xMm;
  const dy = b.yMm - a.yMm;
  return isqrt(dx * dx + dy * dy);
}

/**
 * Distance (mm, floored) from `p` to segment ab. The projection parameter is
 * kept as an exact fraction t = num/den and the foot point is floored once.
 */
export function segmentDistanceMm(p: PointMm, a: PointMm, b: PointMm): number {
  const abx = b.xMm - a.xMm;
  const aby = b.yMm - a.yMm;
  const den = abx * abx + aby * aby;
  if (den === 0) return distanceMm(p, a);
  let num = (p.xMm - a.xMm) * abx + (p.yMm - a.yMm) * aby;
  let scaledDen = den;
  if (num < 0) num = 0;
  if (num > den) num = den;
  // num·4096 must stay a safe integer: halve the fraction for segments over ~1 km.
  while (scaledDen > FRACTION_LIMIT) {
    num = divFloor(num, 2);
    scaledDen = divFloor(scaledDen, 2);
  }
  const t = divFloor(num * 4096, scaledDen);
  const foot = { xMm: a.xMm + divFloor(abx * t, 4096), yMm: a.yMm + divFloor(aby * t, 4096) };
  return distanceMm(p, foot);
}

/** Distance from `p` to a polyline. */
export function polylineDistanceMm(p: PointMm, points: readonly PointMm[]): number {
  let best = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a && b) best = Math.min(best, segmentDistanceMm(p, a, b));
  }
  if (points.length === 1 && points[0]) best = distanceMm(p, points[0]);
  return best;
}

/** Fixed-point one for noise weights. */
const ONE = 1024;

function smooth(t: number): number {
  return divFloor(t * t * (3 * ONE - 2 * t), ONE * ONE);
}

/**
 * Bilinear hash value noise in −1000..1000 with smoothstep weights, on an
 * axis grid of `cellMm` cells. Scenery only (forest shapes); the terrain has
 * its own rotated, table-driven octaves.
 */
export function valueNoise(seedHash: number, salt: number, cellMm: number, xMm: number, yMm: number): number {
  const cx = divFloor(xMm, cellMm);
  const cy = divFloor(yMm, cellMm);
  const sx = smooth(divFloor((xMm - cx * cellMm) * ONE, cellMm));
  const sy = smooth(divFloor((yMm - cy * cellMm) * ONE, cellMm));
  const corner = (x: number, y: number): number => (hash32(x, y, salt, seedHash) % 2001) - 1000;
  const sum =
    corner(cx, cy) * (ONE - sx) * (ONE - sy) +
    corner(cx + 1, cy) * sx * (ONE - sy) +
    corner(cx, cy + 1) * (ONE - sx) * sy +
    corner(cx + 1, cy + 1) * sx * sy;
  return divFloor(sum, ONE * ONE);
}

/** A uniform integer in [0, n) from a hash of the arguments: stateless scatter. */
export function hashInt(n: number, ...ints: number[]): number {
  return hash32(...ints) % n;
}
