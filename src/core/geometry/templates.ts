import {
  type Axial,
  type Heading,
  type Vec2,
  HEADINGS,
  LATTICE_SPACING_M,
  SQRT3,
  axial,
  isPrimary,
  mirrorX,
  nearestNode,
  normalizeHeading,
  rotate60,
  rotateHeading,
  stepLengthMm,
  stepOf,
  toWorld,
  unit,
} from "../lattice";
import { divFloor } from "../util/int";

/**
 * The closed set of node-to-node piece templates (ADR 0010, simulation
 * model §5), built once at module load.
 *
 * A template is a piece shape leaving the origin node on a start heading. Its
 * authoritative data is exact: the integer axial end offset, the end heading,
 * the length in integer mm and the speed limit in mm/s, so the step and the
 * validator never need trigonometry. The render primitives (lines and arcs in
 * float metres) are presentation data only.
 *
 * Curves are generated for start headings 0 (primary) and 1 (secondary) with
 * left turns, mirrored across the x-axis for right turns, then rotated by
 * 60° five times. Every oriented template's primitives are then rebuilt from
 * the unit-vector table, and the generator throws unless they land on the
 * node the rotated and mirrored axial offset names: the discrete symmetry and
 * the continuous geometry must agree.
 *
 * This is the only core module where π generates geometry; `Math.atan`
 * appears only in the test that rechecks the shift angle literal.
 */

export const RADIUS_CLASSES_M = Object.freeze([60, 90, 120, 180, 240, 360] as const);
export type RadiusClassM = (typeof RADIUS_CLASSES_M)[number];

/** Signed turn in 30° steps, left (counter-clockwise) positive. */
export const CURVE_TURNS = Object.freeze([-3, -2, -1, 1, 2, 3] as const);
export type Turn = (typeof CURVE_TURNS)[number];

export type ShiftSide = "left" | "right";
export const SHIFT_SIDES: readonly ShiftSide[] = Object.freeze(["left", "right"]);

/** vmax, 60 km/h as ⌊60 × 1000 / 3.6⌋ mm/s; also the limit on straights. */
export const MAX_SPEED_MMS = 16_666;
const MAX_SPEED_KMH = 60;

/**
 * Shift arc angle α = 2·atan(√3/15) ≈ 13.1736°, as a literal so no runtime
 * code calls `atan`; templates.test.ts recomputes it. Both shift kinds share
 * it because offset/span = √3/15 for both.
 */
export const SHIFT_ANGLE_RAD = 0.22992184100141289;
/** sin α = 2t/(1 + t²) with t = √3/15, which is exactly 5√3/38: R needs no trig. */
const SHIFT_SIN = (5 * SQRT3) / 38;

export interface LinePrim {
  readonly kind: "line";
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Circular arc: centre, radius, angle of the start point seen from the centre, signed sweep (CCW positive). */
export interface ArcPrim {
  readonly kind: "arc";
  readonly cx: number;
  readonly cy: number;
  readonly radiusM: number;
  readonly startRad: number;
  readonly sweepRad: number;
}

/** Render-only geometry in float metres, ordered from the start node to the end node. */
export type RenderPrim = LinePrim | ArcPrim;

export interface BoundsM {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface TemplateCommon {
  /** Heading on leaving the start node. */
  readonly heading: Heading;
  /** Heading on arriving at the end node. */
  readonly endHeading: Heading;
  /** Integer axial offset from the start node to the end node. */
  readonly dq: number;
  readonly dr: number;
  readonly lengthMm: number;
  readonly speedLimitMms: number;
  /** Relative to the start node at the origin. */
  readonly prims: readonly RenderPrim[];
  /** Plan extent of `prims`, relative to the start node. */
  readonly boundsM: BoundsM;
}

export interface StraightTemplate extends TemplateCommon {
  readonly kind: "straight";
}

export interface CurveTemplate extends TemplateCommon {
  readonly kind: "curve";
  readonly turn: Turn;
  readonly radiusM: RadiusClassM;
  /** 0-based; variants of one (heading, turn, radius) are ordered by length. */
  readonly variant: number;
  /** Float lead-in and lead-out straights (render-only; ≥ 0, possibly exactly 0). */
  readonly leadInM: number;
  readonly leadOutM: number;
}

export interface ShiftTemplate extends TemplateCommon {
  readonly kind: "shift";
  readonly side: ShiftSide;
  /** Arc radius rounded to mm: 82,272 (primary) or 95,000 (secondary). */
  readonly radiusMm: number;
}

export type Template = StraightTemplate | CurveTemplate | ShiftTemplate;

export function isRadiusClass(n: unknown): n is RadiusClassM {
  return typeof n === "number" && (RADIUS_CLASSES_M as readonly number[]).includes(n);
}

export function isTurn(n: unknown): n is Turn {
  return typeof n === "number" && (CURVE_TURNS as readonly number[]).includes(n);
}

/**
 * Curve speed limit: √(0.8·R) m/s (about 0.8 m/s² lateral) rounded to the
 * nearest 5 km/h, halves up, capped at vmax, as ⌊km/h × 1000 / 3.6⌋ mm/s.
 *
 * Integer-only. With k steps of 5 km/h, 5k − 2.5 ≤ √(10.368·R_m) < 5k + 2.5
 * squares (×4, R in mm) to (10k − 5)²·10⁶ ≤ 41,472·R_mm < (10k + 5)²·10⁶.
 */
export function speedLimitMmsForRadiusMm(radiusMm: number): number {
  if (!Number.isSafeInteger(radiusMm) || radiusMm <= 0) {
    throw new RangeError(`radius must be a positive integer of mm, got ${radiusMm}`);
  }
  const scaled = 41_472 * radiusMm;
  const maxSteps = divFloor(MAX_SPEED_KMH, 5);
  let k = 0;
  while (k < maxSteps && (10 * k + 5) * (10 * k + 5) * 1_000_000 <= scaled) k += 1;
  return divFloor(5 * k * 10_000, 36);
}

/** Heading angle in radians, counter-clockwise from +x. */
function headingRad(h: Heading): number {
  return (h * Math.PI) / 6;
}

/** Float step length: 5 m primary, 5√3 m secondary (`stepLengthMm` is its rounding). */
function stepLengthM(h: Heading): number {
  return isPrimary(h) ? LATTICE_SPACING_M : LATTICE_SPACING_M * SQRT3;
}

/** R·tan(θ/2) for θ = 30°, 60°, 90°: R(2 − √3), R/√3, R. Only √3, no trig. */
function tangentLengthM(absTurn: number, radiusM: number): number {
  if (absTurn === 1) return radiusM * (2 - SQRT3);
  if (absTurn === 2) return radiusM / SQRT3;
  return radiusM;
}

function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

function mod2pi(a: number): number {
  const twoPi = 2 * Math.PI;
  return a - twoPi * Math.floor(a / twoPi);
}

/**
 * Tolerance for comparing float lead lengths with the tangent length. Real
 * leads are either exactly 0 (A = T in exact arithmetic, e.g. every secondary
 * 60° variant 0) or clearly positive; the generator throws on anything in
 * between, so no case is decided by rounding noise.
 */
const LEAD_EPS_M = 1e-6;
const CLOSE_EPS_M = 1e-9;

interface Closure {
  readonly offset: Axial;
  readonly leadInM: number;
  readonly leadOutM: number;
}

/**
 * The closing variants of a curve from `d0` turning `turn` at `radiusM`.
 *
 * A curve ends at A·u0 + B·u1, where A = lead-in + T and B = T + lead-out are
 * the distances to and from the tangent intersection. Its end is a node
 * exactly when that point is a lattice point, and every node of the cone
 * A, B ≥ T is reachable as n straights + template + m straights. Adding a
 * straight moves A by one d0 step or B by one d1 step, so one template is
 * needed per class of the cone modulo the straight-step lattice: the nodes in
 * the fundamental cell T ≤ A < T + |s0|, T ≤ B < T + |s1|. Their number is the
 * index |det(step(d0), step(d1))|: 1 for 30°, 1 (primary) or 3 (secondary)
 * for 60°, and 2 for 90°.
 */
function curveClosures(d0: Heading, turn: Turn, radiusM: RadiusClassM): Closure[] {
  const d1 = rotateHeading(d0, turn);
  const u0 = unit(d0);
  const u1 = unit(d1);
  const det01 = cross(u0, u1);
  const t = tangentLengthM(Math.abs(turn), radiusM);
  const s0 = stepLengthM(d0);
  const s1 = stepLengthM(d1);

  const rowM = (LATTICE_SPACING_M * SQRT3) / 2;
  let minQ = Infinity;
  let maxQ = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  for (const [a, b] of [
    [t, t],
    [t + s0, t],
    [t, t + s1],
    [t + s0, t + s1],
  ] as const) {
    const x = a * u0.x + b * u1.x;
    const y = a * u0.y + b * u1.y;
    const r = y / rowM;
    const q = x / LATTICE_SPACING_M - r / 2;
    minQ = Math.min(minQ, q);
    maxQ = Math.max(maxQ, q);
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
  }

  const found: Closure[] = [];
  for (let r = Math.floor(minR) - 1; r <= Math.ceil(maxR) + 1; r++) {
    for (let q = Math.floor(minQ) - 1; q <= Math.ceil(maxQ) + 1; q++) {
      const w = toWorld(axial(q, r));
      const a = cross(w, u1) / det01;
      const b = cross(u0, w) / det01;
      if (a < t - LEAD_EPS_M || a >= t + s0 - LEAD_EPS_M) continue;
      if (b < t - LEAD_EPS_M || b >= t + s1 - LEAD_EPS_M) continue;
      found.push({ offset: axial(q, r), leadInM: leadLength(a - t), leadOutM: leadLength(b - t) });
    }
  }

  const s = stepOf(d0);
  const e = stepOf(d1);
  const expected = Math.abs(s.q * e.r - s.r * e.q);
  if (found.length !== expected) {
    throw new Error(`curve d${d0} turn ${turn} R${radiusM}: ${found.length} closures, expected ${expected}`);
  }
  found.sort((x, y) => x.leadInM + x.leadOutM - (y.leadInM + y.leadOutM));
  for (let i = 1; i < found.length; i++) {
    const prev = found[i - 1] as Closure;
    const cur = found[i] as Closure;
    // Reversal keeps the variant index only if lengths order variants strictly.
    if (cur.leadInM + cur.leadOutM - (prev.leadInM + prev.leadOutM) < LEAD_EPS_M) {
      throw new Error(`curve d${d0} turn ${turn} R${radiusM}: variants ${i - 1} and ${i} tie on length`);
    }
  }
  return found;
}

function leadLength(raw: number): number {
  if (Math.abs(raw) <= CLOSE_EPS_M) return 0;
  if (raw < LEAD_EPS_M) throw new Error(`ambiguous lead length ${raw} m`);
  return raw;
}

function point(p: Vec2, dir: Vec2, length: number): Vec2 {
  return { x: p.x + dir.x * length, y: p.y + dir.y * length };
}

/** Points where an arc reaches its axis extremes (0°, 90°, 180°, 270°) inside its sweep. */
function arcExtremes(arc: ArcPrim): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k < 4; k++) {
    const angle = (k * Math.PI) / 2;
    const delta = arc.sweepRad > 0 ? mod2pi(angle - arc.startRad) : mod2pi(arc.startRad - angle);
    if (delta <= Math.abs(arc.sweepRad) + 1e-12) {
      const axis = unit(normalizeHeading(3 * k));
      out.push({ x: arc.cx + arc.radiusM * axis.x, y: arc.cy + arc.radiusM * axis.y });
    }
  }
  return out;
}

function boundsOf(points: readonly Vec2[]): BoundsM {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return Object.freeze({ minX, minY, maxX, maxY });
}

function line(a: Vec2, b: Vec2): LinePrim {
  return Object.freeze({ kind: "line", x0: a.x, y0: a.y, x1: b.x, y1: b.y });
}

function assertCloses(end: Vec2, offset: Axial, what: string): void {
  const w = toWorld(offset);
  if (Math.abs(end.x - w.x) > CLOSE_EPS_M || Math.abs(end.y - w.y) > CLOSE_EPS_M) {
    throw new Error(`${what} ends at (${end.x}, ${end.y}), not on node (${offset.q}, ${offset.r})`);
  }
}

function makeStraight(h: Heading): StraightTemplate {
  const step = stepOf(h);
  const end = toWorld(step);
  const origin = { x: 0, y: 0 };
  return Object.freeze({
    kind: "straight",
    heading: h,
    endHeading: h,
    dq: step.q,
    dr: step.r,
    lengthMm: stepLengthMm(h),
    speedLimitMms: MAX_SPEED_MMS,
    prims: Object.freeze([line(origin, end)]),
    boundsM: boundsOf([origin, end]),
  });
}

function makeCurve(d0: Heading, turn: Turn, radiusM: RadiusClassM, variant: number, closure: Closure): CurveTemplate {
  const side = turn > 0 ? 1 : -1;
  const d1 = rotateHeading(d0, turn);
  const origin = { x: 0, y: 0 };
  const arcStart = point(origin, unit(d0), closure.leadInM);
  // The centre lies R along the inside normal (90° towards the turn); seen from
  // it, the arc starts on heading d0 − 3·side and ends on d1 − 3·side.
  const centre = point(arcStart, unit(rotateHeading(d0, 3 * side)), radiusM);
  const arcEnd = point(centre, unit(rotateHeading(d1, -3 * side)), radiusM);
  const end = point(arcEnd, unit(d1), closure.leadOutM);
  assertCloses(end, closure.offset, `curve d${d0} turn ${turn} R${radiusM} v${variant}`);

  const arc: ArcPrim = Object.freeze({
    kind: "arc",
    cx: centre.x,
    cy: centre.y,
    radiusM,
    startRad: headingRad(rotateHeading(d0, -3 * side)),
    sweepRad: (turn * Math.PI) / 6,
  });
  const prims: RenderPrim[] = [];
  if (closure.leadInM > 0) prims.push(line(origin, arcStart));
  prims.push(arc);
  if (closure.leadOutM > 0) prims.push(line(arcEnd, end));
  const arcLengthM = (radiusM * Math.abs(turn) * Math.PI) / 6;

  return Object.freeze({
    kind: "curve",
    heading: d0,
    endHeading: d1,
    dq: closure.offset.q,
    dr: closure.offset.r,
    lengthMm: Math.round((closure.leadInM + arcLengthM + closure.leadOutM) * 1000),
    speedLimitMms: speedLimitMmsForRadiusMm(radiusM * 1000),
    prims: Object.freeze(prims),
    boundsM: boundsOf([origin, arcStart, arcEnd, end, ...arcExtremes(arc)]),
    turn,
    radiusM,
    variant,
    leadInM: closure.leadInM,
    leadOutM: closure.leadOutM,
  });
}

/** Span along the axis and lateral offset: primary 37.5 m × one row, secondary 25√3 m × 5 m. */
function shiftSize(h: Heading): { spanM: number; offsetM: number } {
  return isPrimary(h)
    ? { spanM: 7.5 * LATTICE_SPACING_M, offsetM: (LATTICE_SPACING_M * SQRT3) / 2 }
    : { spanM: 5 * LATTICE_SPACING_M * SQRT3, offsetM: LATTICE_SPACING_M };
}

function shiftEndWorld(h: Heading, side: ShiftSide): Vec2 {
  const { spanM, offsetM } = shiftSize(h);
  const sign = side === "left" ? 1 : -1;
  return point(point({ x: 0, y: 0 }, unit(h), spanM), unit(rotateHeading(h, 3)), sign * offsetM);
}

/**
 * Two reverse arcs of radius R = span / (2 sin α) with no straight between:
 * the first turns α towards `side`, the second turns back. Built from the
 * unit table and the α literal only.
 */
function makeShift(h: Heading, side: ShiftSide, offset: Axial): ShiftTemplate {
  const sign = side === "left" ? 1 : -1;
  const { spanM, offsetM } = shiftSize(h);
  const radiusM = spanM / (2 * SHIFT_SIN);
  const origin = { x: 0, y: 0 };
  const inside = unit(rotateHeading(h, 3 * sign));
  const mid = point(point(origin, unit(h), spanM / 2), unit(rotateHeading(h, 3)), (sign * offsetM) / 2);
  const end = point(point(origin, unit(h), spanM), unit(rotateHeading(h, 3)), sign * offsetM);
  assertCloses(end, offset, `shift d${h} ${side}`);

  const first: ArcPrim = Object.freeze({
    kind: "arc",
    cx: inside.x * radiusM,
    cy: inside.y * radiusM,
    radiusM,
    startRad: headingRad(rotateHeading(h, -3 * sign)),
    sweepRad: sign * SHIFT_ANGLE_RAD,
  });
  const second: ArcPrim = Object.freeze({
    kind: "arc",
    cx: end.x - inside.x * radiusM,
    cy: end.y - inside.y * radiusM,
    radiusM,
    startRad: mod2pi(headingRad(rotateHeading(h, 3 * sign)) + sign * SHIFT_ANGLE_RAD),
    sweepRad: -sign * SHIFT_ANGLE_RAD,
  });
  const radiusMm = Math.round(radiusM * 1000);
  return Object.freeze({
    kind: "shift",
    heading: h,
    endHeading: h,
    dq: offset.q,
    dr: offset.r,
    lengthMm: Math.round(2 * radiusM * SHIFT_ANGLE_RAD * 1000),
    speedLimitMms: speedLimitMmsForRadiusMm(radiusMm),
    prims: Object.freeze([first, second]),
    // Each arc turns less than 30°, so no axis extreme lies strictly inside it.
    boundsM: boundsOf([origin, mid, end, ...arcExtremes(first), ...arcExtremes(second)]),
    side,
    radiusMm,
  });
}

interface OrientedCurve {
  readonly heading: Heading;
  readonly turn: Turn;
  readonly radiusM: RadiusClassM;
  readonly variant: number;
  readonly closure: Closure;
}

/**
 * Mirrors a base case across the x-axis (heading h → 12 − h, turn → −turn),
 * then rotates it back onto its base heading: 0 stays 0, 1 lands on 11 and
 * one 60° turn brings it to 1. Lengths are unchanged, so variant order holds.
 */
function mirrored(base: OrientedCurve): OrientedCurve {
  const heading = normalizeHeading(12 - base.heading);
  const turns = heading === base.heading ? 0 : 1;
  return {
    heading: rotateHeading(heading, 2 * turns),
    turn: (0 - base.turn) as Turn,
    radiusM: base.radiusM,
    variant: base.variant,
    closure: { ...base.closure, offset: rotate60(mirrorX(base.closure.offset), turns) },
  };
}

function rotated(base: OrientedCurve, k: number): OrientedCurve {
  return {
    ...base,
    heading: rotateHeading(base.heading, 2 * k),
    closure: { ...base.closure, offset: rotate60(base.closure.offset, k) },
  };
}

const BASE_HEADINGS: readonly Heading[] = [0, 1];

function buildCurves(): CurveTemplate[] {
  const bases: OrientedCurve[] = [];
  for (const heading of BASE_HEADINGS) {
    for (const turn of [1, 2, 3] as const) {
      for (const radiusM of RADIUS_CLASSES_M) {
        curveClosures(heading, turn, radiusM).forEach((closure, variant) => {
          const left: OrientedCurve = { heading, turn, radiusM, variant, closure };
          bases.push(left, mirrored(left));
        });
      }
    }
  }
  const out: CurveTemplate[] = [];
  for (let k = 0; k < 6; k++) {
    for (const base of bases) {
      const o = rotated(base, k);
      out.push(makeCurve(o.heading, o.turn, o.radiusM, o.variant, o.closure));
    }
  }
  return out.sort(
    (a, b) => a.heading - b.heading || a.turn - b.turn || a.radiusM - b.radiusM || a.variant - b.variant,
  );
}

function buildShifts(): ShiftTemplate[] {
  const out: ShiftTemplate[] = [];
  for (const base of BASE_HEADINGS) {
    const left = nearestNode(shiftEndWorld(base, "left"));
    const mirroredHeading = normalizeHeading(12 - base);
    const turns = mirroredHeading === base ? 0 : 1;
    const right = rotate60(mirrorX(left), turns);
    for (let k = 0; k < 6; k++) {
      const h = rotateHeading(base, 2 * k);
      out.push(makeShift(h, "left", rotate60(left, k)), makeShift(h, "right", rotate60(right, k)));
    }
  }
  return out.sort((a, b) => a.heading - b.heading || (a.side < b.side ? -1 : a.side > b.side ? 1 : 0));
}

export const STRAIGHT_TEMPLATES: readonly StraightTemplate[] = Object.freeze(HEADINGS.map(makeStraight));
/** All 720 oriented curve templates, sorted by (heading, turn, radius, variant). */
export const CURVE_TEMPLATES: readonly CurveTemplate[] = Object.freeze(buildCurves());
/** The 120 base curve templates: start headings 0 and 1. */
export const BASE_CURVE_TEMPLATES: readonly CurveTemplate[] = Object.freeze(
  CURVE_TEMPLATES.filter((t) => t.heading === 0 || t.heading === 1),
);
/** 12 primary + 12 secondary oriented shift templates. */
export const SHIFT_TEMPLATES: readonly ShiftTemplate[] = Object.freeze(buildShifts());

const curveIndex = new Map<string, CurveTemplate>();
const variantCounts = new Map<string, number>();
for (const t of CURVE_TEMPLATES) {
  curveIndex.set(`${t.heading}:${t.turn}:${t.radiusM}:${t.variant}`, t);
  const family = `${t.heading}:${t.turn}:${t.radiusM}`;
  variantCounts.set(family, (variantCounts.get(family) ?? 0) + 1);
}
const shiftIndex = new Map<string, ShiftTemplate>(SHIFT_TEMPLATES.map((t) => [`${t.heading}:${t.side}`, t]));

export function straightTemplate(h: Heading): StraightTemplate {
  const t = STRAIGHT_TEMPLATES[h];
  if (!t) throw new RangeError(`invalid heading ${h}`);
  return t;
}

/** The curve template, or undefined when that variant does not exist. */
export function curveTemplate(h: Heading, turn: Turn, radiusM: RadiusClassM, variant: number): CurveTemplate | undefined {
  return curveIndex.get(`${h}:${turn}:${radiusM}:${variant}`);
}

/** Number of closing variants for a curve family (0 for an invalid family). */
export function curveVariantCount(h: Heading, turn: Turn, radiusM: RadiusClassM): number {
  return variantCounts.get(`${h}:${turn}:${radiusM}`) ?? 0;
}

export function shiftTemplate(h: Heading, side: ShiftSide): ShiftTemplate {
  const t = shiftIndex.get(`${h}:${side}`);
  if (!t) throw new RangeError(`invalid shift ${h} ${side}`);
  return t;
}
