import { MIN_HEIGHT_SEPARATION_MM } from "../geometry/clearance";
import { type NodeRef, type PieceSpec, canonicalKey, compareNodes, isNodeRef, nodeKey, nodeRef } from "../geometry/piece";
import {
  CURVE_TEMPLATES,
  CURVE_TURNS,
  type CurveTemplate,
  MAX_SPEED_MMS,
  type RadiusClassM,
  SHIFT_SIDES,
  type ShiftTemplate,
  type Turn,
  isRadiusClass,
  shiftTemplate,
} from "../geometry/templates";
import { type Axial, HEADINGS, type Heading, SQRT3, isHeading, isPrimary, nearestNode, opposite, rotateHeading, stepLengthMm, stepOf, unit } from "../lattice";
import { groundMmAt } from "../terrain";
import { divFloor } from "../util/int";
import { type Counts, type TrackContext, heightsAt, resolveStructure, validate } from "./validate";

/**
 * The planner (simulation model §8, ADR 0010 decision 7): turns a drag the
 * tool has already interpreted into resolved pieces. It reads the authored
 * state and never changes it; `build-track` then carries `plan.pieces`, so
 * later planner tuning never breaks a replay. Pure and deterministic: the
 * same track and drag always give the same plan.
 *
 * **Shapes.** A free end is one bend when one reaches it: n straights + one
 * curve or shift template + m straights on the start heading d0 (51
 * candidates on a primary d0, 75 on a secondary one: 1 straight run, 48 or 72
 * curves, 2 shifts). For a template with axial end offset T the planner
 * solves Δ = n·step(d0) + T + m·step(d1) as a 2×2 integer system; a candidate
 * without an exact solution with n, m ≥ 0 drops out, and a collinear target
 * needs straights only. A shift has d1 = d0, so only n + m is fixed: it is
 * offered with the shift first (n = 0) and last (m = 0). Two-bend fits are
 * straights + curve + straights + curve + straights, or two shifts to the
 * same side (two rows), solved in closed form per template pair
 * (`solveThree`). A fixed end (an existing port, position and heading both
 * fixed) takes them alongside one-bend fits. A free end takes them only as a
 * fallback, when no one-bend fit reaches its target (owner decision
 * 2026-09-27): then the end heading is free, d2 = d0 + t1 + t2 with each turn
 * ±30° to ±90°, so one drag turns up to 180° (hairpins, U-turns, S-curves).
 *
 * **Start heading d0.** `drag.fromHeading` when set. Otherwise, when
 * `drag.from` is an existing buffer end, whichever of the two headings plain
 * track accepts there is nearer the drag direction: continuing the track, or
 * running back over it (reused pieces), ties to continuing. Otherwise the
 * heading nearest the direction from the start to the pointer (or to the
 * snapped port), ties to the lower heading index. Only candidates on d0
 * compete.
 *
 * **Target node (pointer snapping).** The pointer's nearest lattice node N
 * when a one-bend fit reaches it (exactly the selection from before the
 * two-bend fallback), else when a two-bend fit does, so the plan ends under
 * the tool's snap ring and follows the pointer within one node cell
 * (≤ 2.89 m). No fit of one or two bends (each at most 90°) reaches inside
 * the 60 m turning circles beside the start, or behind it nearer its line
 * than twice the smallest radius (120 m), so otherwise:
 * - a pointer behind the start (behind the line through it square to d0)
 *   gets the U-turn end nearest it (`nearestUTurnEnd`, exact, no range limit):
 *   the track turns back toward it on its side, whatever the distance;
 * - any other pointer gets the reachable node nearest it among those reaching
 *   at least halfway to it along the drag (`reachesHalfway`, so a pointer
 *   abeam inside a turning circle gets a bend toward it, not a stub of
 *   straights ahead), by an exact ring search around N (distance ties go to
 *   the smaller q, then r) up to 12 rings (about 52 m); nothing there gives
 *   the nearest U-turn end.
 *
 * A U-turn needs a free end heading or one fixed opposite d0; with another
 * precision end heading, nothing in range gives an empty plan with a note.
 * At a fallback target, one-bend fits compete when any reach it, else
 * two-bend fits. Validity never moves the target, so an unbuildable drag
 * still shows where it would go and `preview` explains why.
 *
 * **Magnetism** (`drag.magnetism`, never in precision mode): the end snaps
 * to the existing buffer end nearest the pointer among those within 3 nodes
 * (hex distance) of N, excluding `from`; the end height becomes the port's
 * height and the plan must arrive with the port's heading. A port that no
 * one- or two-bend fit reaches is skipped (the next one is tried, then the
 * free plan). Without magnetism, a drag whose end node (N at the end
 * height) is itself a buffer end joins it the same way, unless precision
 * mode fixes the end heading.
 *
 * **Selection** among candidates reaching the target: valid first (the
 * shared validator, structure `auto`), then fewer bends, largest radius
 * (straights count as infinite; curves are capped by `radiusCapM`, shifts
 * keep their fixed 82.3 m or 95 m radius and are exempt from the cap), then
 * shortest, smallest |turn| (a shift turns 0; two bends add), left before
 * right, the bend placed earlier, and finally a canonical signature, so the
 * choice is total and deterministic. For single-bend pools "fewer bends"
 * changes nothing (a straight is the only 0-bend shape and has infinite
 * radius), so the §8 order holds exactly; two-bend fits rank after every
 * single-bend fit. Validation runs lazily in that order on at most
 * `MAX_VALIDATIONS` candidates; when none of them is valid the top-ranked
 * candidate is returned, invalid, for the tool's preview to explain.
 *
 * **Two bends (free end)** rank differently (`twoBendOrder`), since their end
 * heading is free too: valid first, then the largest smaller radius (as for
 * one bend, so a wide loop beats a tight hairpin with long straights), then
 * the total turn nearest the arc turn τ, then shortest, smallest summed
 * |turn|, left before right (first bend most significant), the first bend
 * placed earlier, and the signature. τ (`arcTurn`) is the turn of the single
 * circular arc that leaves the start on d0 and passes through the pointer:
 * twice the pointer's bearing, or ±180° (toward the pointer's side) for a
 * pointer abeam or behind. So a pointer beside or behind the start gets a
 * U-turn whenever one is as wide as any other fit, as an arc drawn through
 * the pointer would. A probe of exact two-bend plans (ADR 0010, D3 two-bend
 * finding) found shortest-first choosing R 60 every time (a
 * curvature-bounded shortest path uses the minimum radius: hairpins at
 * 25 km/h with long straights), and radius-first without τ ending 21% of the
 * pointers behind the start on 120° or 150° fits a little shorter than the
 * U-turn. Only the best `MAX_VALIDATIONS` fits are kept, so a pool of
 * thousands never sorts.
 *
 * **Precision** (`drag.precision`): magnetism off, curves only of the given
 * radius class (both bends of a two-bend fit), and with `endHeading` only
 * candidates ending on that heading: one bend when one reaches the target,
 * else two (an S-curve back onto d0, say). Everything stays on the lattice.
 *
 * **Elevation: track follows the ground** (owner decision, 2026-09-27, for
 * D3; D4 revisits it with the 35‰ rule and earthworks). The start z is
 * `from.zMm`; the end z is `from.zMm + dzMm`, or the port's z when the end
 * joins a port. Every other node sits on the ground (`groundMmAt`: the
 * terrain, or the water surface over a lower bed) plus an offset, and it is
 * the offset, not the absolute height, that is interpolated between pins.
 * With both ends on the ground the whole plan lies on it; a raised end ramps
 * the offset from the start's to the end's. An intermediate node where the
 * authored track already has a node within 6.5 m of the plan's height there
 * is pinned to that node's height, so a drag that retraces or extends sloped
 * track reuses the pieces it overlaps (node identity includes z, so a height
 * off by a millimetre would miss their keys); `profileOf` has the exact
 * rule and the choice among several heights. Between consecutive pins
 * (start, pinned nodes, end) the offset's change is apportioned over the
 * pieces in proportion to their lengths by largest remainder (Hamilton):
 * each piece gets ⌊|Δoffset|·len/L⌋ mm, and the leftover millimetres go to
 * the largest remainders, ties to the earlier piece. Negative changes mirror
 * positive ones. Following the ground can exceed 35‰ (about half the pieces
 * of a straight drag on the diorama map); nothing rejects that until D4's
 * grade rule.
 */

/** A point on the sim plan, integer mm (x east, y north). */
export interface PlanPointMm {
  readonly xMm: number;
  readonly yMm: number;
}

/** A drag as the planner sees it: snapped and interpreted by the tool, no pixels. */
export interface Drag {
  /** The snapped start node; its `zMm` is the start height (an existing end's z, or the tool's choice). */
  readonly from: NodeRef;
  /**
   * The heading the new track must leave `from` with: set for a chained drag
   * (the previous plan's `end.heading`) and for a drag that starts on an
   * existing buffer end. Undefined lets the planner choose.
   */
  readonly fromHeading?: Heading;
  /** The pointer's ground position on the sim plan. */
  readonly to: PlanPointMm;
  /**
   * End height minus `from.zMm`, in integer mm: the end's absolute height is
   * `from.zMm + dzMm` (a snapped port's height instead). The tool sets it
   * from the ground at the end plus the elevation steps. Inner nodes follow
   * the ground (see "Elevation" above), so this fixes only the end.
   */
  readonly dzMm: number;
  /** Snap the end to existing endpoints and ports within 3 nodes. Precision mode passes false. */
  readonly magnetism: boolean;
  /** The largest radius class the planner may choose (the user cap); 360 when omitted. */
  readonly radiusCapM?: RadiusClassM;
  /** Precision mode (Ctrl, or ⌥ on macOS): an explicit radius class and, optionally, end heading. */
  readonly precision?: { readonly radiusM: RadiusClassM; readonly endHeading?: Heading };
}

export type PlanFit = "none" | "straight" | "one-bend" | "shift" | "two-bend";

export interface TrackPlan {
  /** Resolved pieces in travel order from `drag.from`. Empty when `fit` is "none". */
  readonly pieces: readonly PieceSpec[];
  readonly fit: PlanFit;
  /** Where the plan ends and the heading it leaves with: the next chained drag's start. Null when empty. */
  readonly end: { readonly node: NodeRef; readonly heading: Heading } | null;
  /** The existing node magnetism snapped the end to; null when it did not snap. */
  readonly snapped: NodeRef | null;
  /** A key lookup: pieces whose canonical key already exists are reused, the rest new. */
  readonly counts: Counts;
  readonly lengthMm: number;
  /** The smallest radius class among the plan's curves; null when it has none. */
  readonly minRadiusM: RadiusClassM | null;
  /** The steepest grade in ‰, rounded to 0.1 ‰ for display (validation uses exact rationals). */
  readonly maxGradePermille: number;
  /** The lowest speed limit along the plan, mm/s. */
  readonly speedLimitMms: number;
  /** The live label, for example "R 120 m · 35 km/h · 1.2%". */
  readonly label: string;
  /** Why nothing fits when `fit` is "none" (a hint the tooltip can show); otherwise null. */
  readonly note: string | null;
}

/** What the planner reads: the committed track, its indexes and the terrain (for the validity check). */
export type PlannerContext = TrackContext;

/** Magnetism reach: hex distance from the pointer's nearest node to an existing buffer end. */
export const MAGNET_RANGE_NODES = 3;
/** The radius cap when `drag.radiusCapM` is omitted. */
export const DEFAULT_RADIUS_CAP_M: RadiusClassM = 360;
/** How far (in hex rings around the pointer's node) the planner looks for a reachable end. */
export const MAX_SNAP_RINGS = 12;
/** Candidates validated per plan, in rank order, before the top-ranked one is returned unvalidated. */
export const MAX_VALIDATIONS = 8;

/** Ring k of the lattice lies at least k·4330.127 mm from its centre (k rows); 4330 keeps the bound safe. */
const RING_STEP_MM = 4330;
/** Radius used to rank a straight-only plan: larger than any template's. */
const STRAIGHT_RADIUS_MM = Number.MAX_SAFE_INTEGER;

// ---------------------------------------------------------------------------
// Candidates

/** One run of a candidate: `count` straights, or one curve or shift template. */
export type Seg =
  | { readonly kind: "straight"; readonly heading: Heading; readonly count: number }
  | { readonly kind: "curve"; readonly t: CurveTemplate }
  | { readonly kind: "shift"; readonly t: ShiftTemplate };

/** A shape that reaches the target, before heights are assigned; exported for the ranking tests. */
export interface Candidate {
  readonly fit: Exclude<PlanFit, "none">;
  readonly segs: readonly Seg[];
  /** 0 for straights, 1 for one curve or shift, 2 for a two-bend fit. */
  readonly bends: number;
  /** The smallest radius along the plan, mm (`STRAIGHT_RADIUS_MM` for straights). */
  readonly radiusMm: number;
  readonly lengthMm: number;
  /** Sum of |turn| over the curves, in 30° steps (a shift turns 0). */
  readonly turnSum: number;
  /** The signed heading change from start to end, in 30° steps, left positive (−6…6; a U-turn is ±6). */
  readonly turn: number;
  /** Left before right: 0 = left or none, 1 = right per bend, the first bend most significant. */
  readonly sides: number;
  /** Straights before the first bend: the earlier bend wins a tie. */
  readonly lead: number;
  readonly endHeading: Heading;
}

/** What a drag allows, from its radius cap or precision; exported for the oracle tests. */
export interface Rules {
  /** Whether a curve of this radius class may be used. */
  readonly allowRadius: (radiusM: RadiusClassM) => boolean;
}

const CURVES_BY_HEADING: readonly (readonly CurveTemplate[])[] = HEADINGS.map((h) => CURVE_TEMPLATES.filter((t) => t.heading === h));
const CURVES_BY_TURN = new Map<string, readonly CurveTemplate[]>();
for (const h of HEADINGS) {
  for (const turn of CURVE_TURNS) CURVES_BY_TURN.set(`${h}:${turn}`, CURVE_TEMPLATES.filter((t) => t.heading === h && t.turn === turn));
}

function curvesOn(h: Heading): readonly CurveTemplate[] {
  return CURVES_BY_HEADING[h] ?? [];
}

function curvesTurning(h: Heading, turn: Turn): readonly CurveTemplate[] {
  return CURVES_BY_TURN.get(`${h}:${turn}`) ?? [];
}

function det(a: Axial, b: Axial): number {
  return a.q * b.r - a.r * b.q;
}

function sub(a: Axial, b: Axial): Axial {
  return { q: a.q - b.q, r: a.r - b.r };
}

function ceilDiv(a: number, b: number): number {
  return 0 - divFloor(0 - a, b);
}

/** Integer (x, y) with x·a + y·b = v, or undefined when a and b are parallel or no integer solution exists. */
function solve2(a: Axial, b: Axial, v: Axial): readonly [number, number] | undefined {
  const g = det(a, b);
  if (g === 0) return undefined;
  const xn = det(v, b);
  const yn = det(a, v);
  if (xn % g !== 0 || yn % g !== 0) return undefined;
  return [xn / g + 0, yn / g + 0];
}

/** k with v = k·s, or undefined. */
function multipleOf(v: Axial, s: Axial): number | undefined {
  if (s.q !== 0) {
    if (v.q % s.q !== 0) return undefined;
    const k = v.q / s.q + 0;
    return v.r === k * s.r ? k : undefined;
  }
  if (v.q !== 0 || v.r % s.r !== 0) return undefined;
  return v.r / s.r + 0;
}

/** Signed turn from heading `a` to heading `b`, in 30° steps within −6…5. */
function signedTurn(a: Heading, b: Heading): number {
  return ((((b - a + 6) % 12) + 12) % 12) - 6;
}

function straightSegs(heading: Heading, count: number): Seg[] {
  return count > 0 ? [{ kind: "straight", heading, count }] : [];
}

function sideOf(turn: number): number {
  return turn > 0 ? 0 : 1;
}

function straightCandidate(d0: Heading, k: number): Candidate {
  return {
    fit: "straight",
    segs: straightSegs(d0, k),
    bends: 0,
    radiusMm: STRAIGHT_RADIUS_MM,
    lengthMm: k * stepLengthMm(d0),
    turnSum: 0,
    turn: 0,
    sides: 0,
    lead: 0,
    endHeading: d0,
  };
}

function curveCandidate(d0: Heading, t: CurveTemplate, n: number, m: number): Candidate {
  return {
    fit: "one-bend",
    segs: [...straightSegs(d0, n), { kind: "curve", t }, ...straightSegs(t.endHeading, m)],
    bends: 1,
    radiusMm: t.radiusM * 1000,
    lengthMm: n * stepLengthMm(d0) + t.lengthMm + m * stepLengthMm(t.endHeading),
    turnSum: Math.abs(t.turn),
    turn: t.turn,
    sides: sideOf(t.turn),
    lead: n,
    endHeading: t.endHeading,
  };
}

function shiftCandidate(d0: Heading, t: ShiftTemplate, n: number, m: number): Candidate {
  return {
    fit: "shift",
    segs: [...straightSegs(d0, n), { kind: "shift", t }, ...straightSegs(d0, m)],
    bends: 1,
    radiusMm: t.radiusMm,
    lengthMm: (n + m) * stepLengthMm(d0) + t.lengthMm,
    turnSum: 0,
    turn: 0,
    sides: t.side === "left" ? 0 : 1,
    lead: n,
    endHeading: d0,
  };
}

/**
 * Every single-bend candidate from d0 whose end lands exactly on
 * start + `delta`, optionally restricted to one end heading.
 */
function singleBend(d0: Heading, delta: Axial, endHeading: Heading | undefined, rules: Rules): Candidate[] {
  const out: Candidate[] = [];
  const s0 = stepOf(d0);
  if (endHeading === undefined || endHeading === d0) {
    const k = multipleOf(delta, s0);
    if (k !== undefined && k >= 1) out.push(straightCandidate(d0, k));
    for (const side of SHIFT_SIDES) {
      const t = shiftTemplate(d0, side);
      const rest = multipleOf(sub(delta, { q: t.dq, r: t.dr }), s0);
      if (rest === undefined || rest < 0) continue;
      out.push(shiftCandidate(d0, t, 0, rest));
      if (rest > 0) out.push(shiftCandidate(d0, t, rest, 0));
    }
  }
  for (const t of curvesOn(d0)) {
    if (!rules.allowRadius(t.radiusM) || (endHeading !== undefined && t.endHeading !== endHeading)) continue;
    const nm = solve2(s0, stepOf(t.endHeading), sub(delta, { q: t.dq, r: t.dr }));
    if (nm && nm[0] >= 0 && nm[1] >= 0) out.push(curveCandidate(d0, t, nm[0], nm[1]));
  }
  return out;
}

type Triple = readonly [number, number, number];

/**
 * Non-negative integer (x, y, z) with x·a + y·b + z·c = D, where b is not
 * parallel to a or c. When a and c are independent the solutions form one
 * line y ↦ (x(y), y, z(y)); its integer points recur with a period that
 * divides |det(a, c)| ≤ 3 (the period is 1, not 3, when a, b and c are all
 * secondary), so each end of the feasible interval is found by scanning at
 * most |det| values of y inward from it. The length x·la + y·lb + z·lc is
 * affine in y, so the shortest lies at one of those two ends (ties: fewer
 * straights before the first bend). When c = a (an S-bend back onto the
 * start heading) only x + z is fixed: both placements, bends first and bends
 * last, are returned. When c = −a (a U-turn) the shortest is unique.
 * Exported for the brute-force oracle test.
 */
export function solveThree(a: Axial, la: number, b: Axial, lb: number, c: Axial, lc: number, D: Axial): Triple[] {
  const g = det(a, c);
  if (g === 0) {
    const ky = solve2(a, b, D);
    if (!ky || ky[1] < 0) return [];
    const [k, y] = ky;
    if (c.q === a.q && c.r === a.r) {
      if (k < 0) return [];
      return k === 0 ? [[0, y, 0]] : [[0, y, k], [k, y, 0]];
    }
    return [[Math.max(k, 0), y, Math.max(0 - k, 0)]];
  }
  const P = det(D, c);
  const Q = det(b, c);
  const U = det(a, D);
  const V = det(a, b);
  const sg = g > 0 ? 1 : -1;
  const period = Math.abs(g);
  let lo = 0;
  let hi = Infinity;
  // x ≥ 0 ⟺ sg·(P − y·Q) ≥ 0 and z ≥ 0 ⟺ sg·(U − y·V) ≥ 0.
  for (const [A, B] of [
    [sg * P, sg * Q],
    [sg * U, sg * V],
  ] as const) {
    if (B > 0) hi = Math.min(hi, divFloor(A, B));
    else if (B < 0) lo = Math.max(lo, ceilDiv(A, B));
    else if (A < 0) return [];
  }
  if (lo > hi) return [];
  const integral = (y: number): boolean => (P - y * Q) % g === 0 && (U - y * V) % g === 0;
  let first = -1;
  for (let y = lo; y < lo + period && y <= hi; y++) {
    if (integral(y)) {
      first = y;
      break;
    }
  }
  if (first < 0) return [];
  const at = (y: number): Triple => [(P - y * Q) / g + 0, y, (U - y * V) / g + 0];
  const low = at(first);
  // Unbounded above only when x and z both grow with y, so length grows too.
  if (hi === Infinity) return [low];
  // The last integral y, scanning down from hi: fewer than |det| steps, since `first` is integral.
  let last = hi;
  while (last > first && !integral(last)) last -= 1;
  const high = at(last);
  const length = (s: Triple) => s[0] * la + s[1] * lb + s[2] * lc;
  const dl = length(low) - length(high);
  if (dl < 0 || (dl === 0 && low[0] <= high[0])) return [low];
  return [high];
}

/**
 * One turn pair of a two-bend fit from d0: the headings and steps of its
 * three straight runs (d0, dm = d0 + turn1, de = dm + turn2) and the cone they
 * span. The runs' non-negative combinations fill the cone between its
 * extreme rays `lo` and `hi` (counter-clockwise, at most 180° apart, exactly
 * 180° only for a U-turn), so D can be a combination only when
 * det(lo, D) ≥ 0 and det(D, hi) ≥ 0: a necessary test that skips most
 * `solveThree` calls and never rejects a fit.
 */
interface TurnPair {
  readonly turn1: Turn;
  readonly turn2: Turn;
  readonly dm: Heading;
  readonly de: Heading;
  readonly a: Axial;
  readonly la: number;
  readonly b: Axial;
  readonly lb: number;
  readonly c: Axial;
  readonly lc: number;
  readonly lo: Axial;
  readonly hi: Axial;
}

/** Every turn pair from each start heading, built once: 36 per heading (6 × 6 turns). */
const TURN_PAIRS: readonly (readonly TurnPair[])[] = HEADINGS.map((d0) => {
  const out: TurnPair[] = [];
  for (const turn1 of CURVE_TURNS) {
    const dm = rotateHeading(d0, turn1);
    for (const turn2 of CURVE_TURNS) {
      const de = rotateHeading(dm, turn2);
      const lo = Math.min(0, turn1, turn1 + turn2);
      const hi = Math.max(0, turn1, turn1 + turn2);
      out.push({
        turn1,
        turn2,
        dm,
        de,
        a: stepOf(d0),
        la: stepLengthMm(d0),
        b: stepOf(dm),
        lb: stepLengthMm(dm),
        c: stepOf(de),
        lc: stepLengthMm(de),
        lo: stepOf(rotateHeading(d0, lo)),
        hi: stepOf(rotateHeading(d0, hi)),
      });
    }
  }
  return out;
});

function turnPairsFrom(d0: Heading, endHeading: Heading | undefined): readonly TurnPair[] {
  const all = TURN_PAIRS[d0] ?? [];
  return endHeading === undefined ? all : all.filter((tp) => tp.de === endHeading);
}

function curvePairCandidate(d0: Heading, tp: TurnPair, t1: CurveTemplate, t2: CurveTemplate, [x, y, z]: Triple): Candidate {
  return {
    fit: "two-bend",
    segs: [...straightSegs(d0, x), { kind: "curve", t: t1 }, ...straightSegs(tp.dm, y), { kind: "curve", t: t2 }, ...straightSegs(tp.de, z)],
    bends: 2,
    radiusMm: Math.min(t1.radiusM, t2.radiusM) * 1000,
    lengthMm: x * tp.la + t1.lengthMm + y * tp.lb + t2.lengthMm + z * tp.lc,
    turnSum: Math.abs(tp.turn1) + Math.abs(tp.turn2),
    turn: tp.turn1 + tp.turn2,
    sides: 2 * sideOf(tp.turn1) + sideOf(tp.turn2),
    lead: x,
    endHeading: tp.de,
  };
}

/** The placements of two shifts to one side landing on start + `delta`: none, or (x, z) straights before and after. */
function doubleShiftPlacements(d0: Heading, t: ShiftTemplate, delta: Axial): readonly (readonly [number, number])[] {
  const k = multipleOf({ q: delta.q - 2 * t.dq, r: delta.r - 2 * t.dr }, stepOf(d0));
  if (k === undefined || k < 0) return [];
  return k === 0 ? [[0, 0]] : [[0, k], [k, 0]];
}

function doubleShiftCandidate(d0: Heading, t: ShiftTemplate, x: number, z: number): Candidate {
  return {
    fit: "two-bend",
    segs: [...straightSegs(d0, x), { kind: "shift", t }, { kind: "shift", t }, ...straightSegs(d0, z)],
    bends: 2,
    radiusMm: t.radiusMm,
    lengthMm: (x + z) * stepLengthMm(d0) + 2 * t.lengthMm,
    turnSum: 0,
    turn: 0,
    sides: 3 * (t.side === "left" ? 0 : 1),
    lead: x,
    endHeading: d0,
  };
}

/**
 * Every two-bend fit from d0 landing exactly on start + `delta`, each passed
 * to `emit`: curve + curve (turns t1, t2 of ±30° to ±90° each) with straights
 * before, between and after, and, when the end heading may be d0, two shifts
 * to the same side. `endHeading` restricts the fits to one arrival heading (a
 * port, or precision); undefined leaves it free, d0 + t1 + t2, up to ±180°.
 * `skip(radiusMm)` may drop a curve pair, by its smaller radius, before it is
 * solved (the free fallback's bound).
 */
function forEachTwoBend(
  d0: Heading,
  delta: Axial,
  endHeading: Heading | undefined,
  rules: Rules,
  emit: (c: Candidate) => void,
  skip?: (radiusMm: number) => boolean,
): void {
  for (const tp of turnPairsFrom(d0, endHeading)) {
    const v1 = det(tp.lo, delta);
    const v2 = det(delta, tp.hi);
    for (const t1 of curvesTurning(d0, tp.turn1)) {
      if (!rules.allowRadius(t1.radiusM)) continue;
      for (const t2 of curvesTurning(tp.dm, tp.turn2)) {
        if (!rules.allowRadius(t2.radiusM)) continue;
        const T = { q: t1.dq + t2.dq, r: t1.dr + t2.dr };
        // D = delta − T lies in the cone only if det(lo, D) ≥ 0 and det(D, hi) ≥ 0.
        if (det(tp.lo, T) > v1 || det(T, tp.hi) > v2) continue;
        if (skip?.(Math.min(t1.radiusM, t2.radiusM) * 1000)) continue;
        for (const xyz of solveThree(tp.a, tp.la, tp.b, tp.lb, tp.c, tp.lc, sub(delta, T))) emit(curvePairCandidate(d0, tp, t1, t2, xyz));
      }
    }
  }
  if (endHeading === undefined || endHeading === d0) {
    for (const side of SHIFT_SIDES) {
      const t = shiftTemplate(d0, side);
      for (const [x, z] of doubleShiftPlacements(d0, t, delta)) emit(doubleShiftCandidate(d0, t, x, z));
    }
  }
}

/**
 * Every two-bend fit from d0 landing exactly on start + `delta` (see
 * `forEachTwoBend`), unranked: a port join takes them all, with `endHeading`
 * the port's. Exported for the oracle tests.
 */
export function twoBendFits(d0: Heading, delta: Axial, endHeading: Heading | undefined, rules: Rules): Candidate[] {
  const out: Candidate[] = [];
  forEachTwoBend(d0, delta, endHeading, rules, (c) => out.push(c));
  return out;
}

/**
 * The best `MAX_VALIDATIONS` two-bend fits of a free end at start + `delta`,
 * best first by `twoBendOrder(arcTurnSteps)` (see "Two bends" in the module
 * comment). Only that many can be validated, so no more are kept, and a
 * curve pair whose smaller radius is below the worst kept fit's (radius is
 * the first key) is skipped unsolved. Exported for the oracle tests.
 */
export function bestTwoBend(d0: Heading, delta: Axial, endHeading: Heading | undefined, rules: Rules, arcTurnSteps: number): Candidate[] {
  const kept: Candidate[] = [];
  const order = twoBendOrder(arcTurnSteps);
  const skip = (radiusMm: number): boolean => {
    const worst = kept.length === MAX_VALIDATIONS ? kept[MAX_VALIDATIONS - 1] : undefined;
    return worst !== undefined && radiusMm < worst.radiusMm;
  };
  forEachTwoBend(d0, delta, endHeading, rules, (c) => keepBest(kept, c, order, MAX_VALIDATIONS), skip);
  return kept;
}

/** Inserts `c` into `kept` (sorted best first by `cmp`), keeping at most `limit`. */
function keepBest(kept: Candidate[], c: Candidate, cmp: (a: Candidate, b: Candidate) => number, limit: number): void {
  const worst = kept[kept.length - 1];
  if (kept.length === limit && worst && cmp(c, worst) >= 0) return;
  let i = kept.length;
  kept.push(c);
  while (i > 0) {
    const prev = kept[i - 1];
    if (!prev || cmp(c, prev) >= 0) break;
    kept[i] = prev;
    i -= 1;
  }
  kept[i] = c;
  if (kept.length > limit) kept.pop();
}

interface PairRow {
  readonly dq: number;
  readonly dr: number;
  /** det(lo, T) and det(T, hi): the pair can reach delta only when det(lo, delta) ≥ s1 and det(delta, hi) ≥ s2. */
  readonly s1: number;
  readonly s2: number;
}

interface ReachRows {
  readonly tp: TurnPair;
  /** Sorted by s1, so a scan stops at the first row past det(lo, delta). */
  readonly rows: readonly PairRow[];
  readonly min2: number;
}

/**
 * Whether any two-bend fit from d0 reaches start + delta, for the snapping
 * search, which asks this of many nodes: the curve pairs are tabled once per
 * call, per turn pair and sorted by their cone offsets, so a node outside
 * every pair's cone costs about two determinants per turn pair. Agrees
 * exactly with `twoBendFits` finding a fit (an oracle test checks it).
 * Exported for that test.
 */
export function twoBendReach(d0: Heading, endHeading: Heading | undefined, rules: Rules): (delta: Axial) => boolean {
  const table: ReachRows[] = [];
  for (const tp of turnPairsFrom(d0, endHeading)) {
    const rows: PairRow[] = [];
    for (const t1 of curvesTurning(d0, tp.turn1)) {
      if (!rules.allowRadius(t1.radiusM)) continue;
      for (const t2 of curvesTurning(tp.dm, tp.turn2)) {
        if (!rules.allowRadius(t2.radiusM)) continue;
        const T = { q: t1.dq + t2.dq, r: t1.dr + t2.dr };
        rows.push({ dq: T.q, dr: T.r, s1: det(tp.lo, T), s2: det(T, tp.hi) });
      }
    }
    if (rows.length === 0) continue;
    rows.sort((x, y) => x.s1 - y.s1);
    table.push({ tp, rows, min2: Math.min(...rows.map((row) => row.s2)) });
  }
  const shifts = endHeading === undefined || endHeading === d0 ? SHIFT_SIDES.map((side) => shiftTemplate(d0, side)) : [];
  return (delta) => {
    for (const { tp, rows, min2 } of table) {
      const v1 = det(tp.lo, delta);
      const v2 = det(delta, tp.hi);
      if (v2 < min2) continue;
      for (const row of rows) {
        if (row.s1 > v1) break;
        if (row.s2 > v2) continue;
        if (solveThree(tp.a, tp.la, tp.b, tp.lb, tp.c, tp.lc, { q: delta.q - row.dq, r: delta.r - row.dr }).length > 0) return true;
      }
    }
    return shifts.some((t) => doubleShiftPlacements(d0, t, delta).length > 0);
  };
}

function signature(c: Candidate): string {
  return c.segs
    .map((s) => (s.kind === "straight" ? `S${s.heading}x${s.count}` : s.kind === "curve" ? `C${s.t.heading}:${s.t.turn}:${s.t.radiusM}:${s.t.variant}` : `H${s.t.heading}:${s.t.side}`))
    .join("|");
}

/**
 * The geometric rank, best first (validity is checked lazily in this order):
 * fewer bends, larger radius, shorter, smaller |turn|, left before right,
 * earlier bend, then the signature. Exported for the ranking tests.
 */
export function compareCandidates(a: Candidate, b: Candidate): number {
  const d = a.bends - b.bends || b.radiusMm - a.radiusMm || a.lengthMm - b.lengthMm || a.turnSum - b.turnSum || a.sides - b.sides || a.lead - b.lead;
  if (d !== 0) return d;
  return compareSignatures(a, b);
}

function compareSignatures(a: Candidate, b: Candidate): number {
  const sa = signature(a);
  const sb = signature(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * The rank of a free end's two-bend fits (the fallback when no single bend
 * reaches the target), best first; see "Two bends" in the module comment.
 * Exported for the oracle test.
 */
export function twoBendOrder(arcTurnSteps: number): (a: Candidate, b: Candidate) => number {
  return (a, b) => {
    const d =
      b.radiusMm - a.radiusMm ||
      Math.abs(a.turn - arcTurnSteps) - Math.abs(b.turn - arcTurnSteps) ||
      a.lengthMm - b.lengthMm ||
      a.turnSum - b.turnSum ||
      a.sides - b.sides ||
      a.lead - b.lead;
    return d !== 0 ? d : compareSignatures(a, b);
  };
}

// ---------------------------------------------------------------------------
// Pieces, elevation and the plan

interface Shape {
  readonly seg: Seg;
  readonly dq: number;
  readonly dr: number;
  readonly lengthMm: number;
  readonly speedLimitMms: number;
}

function shapesOf(segs: readonly Seg[]): Shape[] {
  const out: Shape[] = [];
  for (const seg of segs) {
    if (seg.kind === "straight") {
      const s = stepOf(seg.heading);
      for (let i = 0; i < seg.count; i++) out.push({ seg, dq: s.q, dr: s.r, lengthMm: stepLengthMm(seg.heading), speedLimitMms: MAX_SPEED_MMS });
    } else {
      out.push({ seg, dq: seg.t.dq, dr: seg.t.dr, lengthMm: seg.t.lengthMm, speedLimitMms: seg.t.speedLimitMms });
    }
  }
  return out;
}

/**
 * Splits `total` integer mm over `weights` in proportion, by largest
 * remainder: floors first, then one more mm to each of the largest
 * remainders, ties to the earlier index. The sign of `total` is applied last,
 * so a descent mirrors the climb.
 */
export function apportionMm(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (weights.length === 0 || sum <= 0) throw new RangeError("apportionMm needs positive weights");
  const abs = Math.abs(total);
  const shares = weights.map((w) => divFloor(abs * w, sum));
  const remainders = weights.map((w, i) => abs * w - (shares[i] ?? 0) * sum);
  let left = abs - shares.reduce((acc, s) => acc + s, 0);
  const order = weights.map((_, i) => i).sort((i, j) => (remainders[j] ?? 0) - (remainders[i] ?? 0) || i - j);
  for (const i of order) {
    if (left === 0) break;
    shares[i] = (shares[i] ?? 0) + 1;
    left -= 1;
  }
  return shares.map((s) => (total < 0 ? 0 - s : s) + 0);
}

/** The piece of `shape` from node (q, r, z0Mm) to height z1Mm, frozen. */
function specAt(shape: Shape, q: number, r: number, z0Mm: number, z1Mm: number): PieceSpec {
  const at = nodeRef(q, r, z0Mm);
  const seg = shape.seg;
  return Object.freeze(
    seg.kind === "straight"
      ? { kind: "straight", from: at, heading: seg.heading, z1Mm }
      : seg.kind === "curve"
        ? { kind: "curve", from: at, heading: seg.t.heading, turn: seg.t.turn, radiusM: seg.t.radiusM, variant: seg.t.variant, z1Mm }
        : { kind: "shift", from: at, heading: seg.t.heading, side: seg.t.side, z1Mm },
  );
}

function isExisting(ctx: PlannerContext, spec: PieceSpec): boolean {
  const key = canonicalKey(spec);
  return key !== undefined && ctx.authored.pieces.has(key);
}

/**
 * The ground under each node of a path, integer mm (`groundMmAt`: the
 * terrain, or the water surface over a lower bed). A node off the map takes
 * the ground of the last on-map node before it, or of the first one after it
 * when none comes before; a path entirely off the map takes the start's own
 * height. So a plan that leaves the map still gets deterministic heights,
 * with no jump where it crosses the edge, for `preview` to reject with
 * `out-of-bounds`.
 */
function groundAlong(ctx: PlannerContext, from: NodeRef, qs: readonly number[], rs: readonly number[]): number[] {
  const known = qs.map((q, i) => groundMmAt(ctx.terrain, { q, r: rs[i] ?? 0 }));
  let last = known.find((g) => g !== undefined) ?? from.zMm;
  return known.map((g) => {
    last = g ?? last;
    return last;
  });
}

/**
 * Node heights along a path, z[0] = `from.zMm` … z[n] = `endZMm` (see
 * "Elevation" in the module comment). Each node's height is the ground
 * there, g[i], plus an offset: the start's offset is `from.zMm − g[0]`, the
 * end's `endZMm − g[n]`, and every pin's is its height minus its ground.
 *
 * Walking from the start, an intermediate node where the authored track
 * already has nodes is pinned to one of their heights, h, when it lies within
 * `MIN_HEIGHT_SEPARATION_MM` (6.5 m) of the reference: the ground there plus
 * the offset on the straight line, by cumulative length, from the last pin's
 * offset to the end's. Nearer than that the path would clash with that track
 * anyway (`tracks-too-close`), so pinning can only let it share the node or
 * reuse the piece; farther, the path passes over or under the track (a grade
 * separation) and keeps its own height. The comparison is exact:
 * |h − ref| · span, with span the length from the last pin to the end, is an
 * integer of at most about 1e14 (safe).
 *
 * Several heights within reach (a bridge over a track, D4) are ranked, first
 * wins: the height whose incoming piece (from the previous node, when that is
 * the start or a pin) is an existing piece; then one whose outgoing piece to
 * an existing height at the next node (or to the end height) is; then the
 * nearest to the reference; then the lower. Only the authored heights, the
 * terrain and the path decide, never insertion order, so the profile is
 * deterministic.
 *
 * The offset's change between consecutive pins is then apportioned over
 * their pieces by length (`apportionMm`, largest remainder), and each node
 * gets its ground plus its offset. With both ends on the ground and no pin,
 * every node lies on the ground; on flat terrain this is exactly the old
 * split of the height change.
 */
function profileOf(ctx: PlannerContext, from: NodeRef, endZMm: number, shapes: readonly Shape[]): number[] {
  const n = shapes.length;
  const qs: number[] = [from.q];
  const rs: number[] = [from.r];
  const cum: number[] = [0];
  shapes.forEach((s, i) => {
    qs.push((qs[i] ?? 0) + s.dq);
    rs.push((rs[i] ?? 0) + s.dr);
    cum.push((cum[i] ?? 0) + s.lengthMm);
  });
  const total = cum[n] ?? 0;
  const g = groundAlong(ctx, from, qs, rs);
  const z: number[] = Array.from({ length: n + 1 }, () => 0);
  z[0] = from.zMm;
  z[n] = endZMm;
  const endOffset = endZMm - (g[n] ?? 0);
  const pins: number[] = [0];
  let p = 0;
  for (let i = 1; i < n; i++) {
    const q = qs[i] ?? 0;
    const r = rs[i] ?? 0;
    const heights = heightsAt(ctx.index, q, r);
    if (heights.length === 0) continue;
    const zp = z[p] ?? 0;
    const op = zp - (g[p] ?? 0);
    const span = total - (cum[p] ?? 0);
    const refScaled = ((g[i] ?? 0) + op) * span + (endOffset - op) * ((cum[i] ?? 0) - (cum[p] ?? 0));
    const distOf = (h: number): number => Math.abs(h * span - refScaled);
    const near = heights.filter((h) => distOf(h) < MIN_HEIGHT_SEPARATION_MM * span);
    const first = near[0];
    if (first === undefined) continue;
    let best = first;
    if (near.length > 1) {
      // Only now are piece keys looked up: one height within reach needs no ranking.
      const incoming = shapes[i - 1];
      const outgoing = shapes[i];
      const nextHeights = i + 1 === n ? [endZMm] : heightsAt(ctx.index, qs[i + 1] ?? 0, rs[i + 1] ?? 0);
      const rankOf = (h: number): number =>
        p === i - 1 && incoming && isExisting(ctx, specAt(incoming, qs[p] ?? 0, rs[p] ?? 0, zp, h))
          ? 0
          : outgoing && nextHeights.some((h1) => isExisting(ctx, specAt(outgoing, q, r, h, h1)))
            ? 1
            : 2;
      let bestRank = rankOf(first);
      let bestDist = distOf(first);
      for (const h of near.slice(1)) {
        const rank = rankOf(h);
        const dist = distOf(h);
        // Heights come ascending, so keeping the first of equals gives ties to the lower.
        if (rank < bestRank || (rank === bestRank && dist < bestDist)) {
          best = h;
          bestRank = rank;
          bestDist = dist;
        }
      }
    }
    z[i] = best;
    pins.push(i);
    p = i;
  }
  pins.push(n);
  for (let k = 1; k < pins.length; k++) {
    const a = pins[k - 1] ?? 0;
    const b = pins[k] ?? 0;
    const offsetA = (z[a] ?? 0) - (g[a] ?? 0);
    const offsetB = (z[b] ?? 0) - (g[b] ?? 0);
    const steps = apportionMm(offsetB - offsetA, shapes.slice(a, b).map((s) => s.lengthMm));
    let offset = offsetA;
    for (let i = a; i < b - 1; i++) {
      offset += steps[i - a] ?? 0;
      z[i + 1] = (g[i + 1] ?? 0) + offset;
    }
  }
  return z;
}

function specsOf(ctx: PlannerContext, from: NodeRef, endZMm: number, shapes: readonly Shape[]): PieceSpec[] {
  const z = profileOf(ctx, from, endZMm, shapes);
  const out: PieceSpec[] = [];
  let q = from.q;
  let r = from.r;
  shapes.forEach((shape, i) => {
    out.push(specAt(shape, q, r, z[i] ?? 0, z[i + 1] ?? 0));
    q += shape.dq;
    r += shape.dr;
  });
  return out;
}

/** Km/h for display from mm/s, rounded half up (16,666 mm/s reads 60). */
function kmh(mms: number): number {
  return divFloor(mms * 36 + 5000, 10_000);
}

/** round-half-up(num / den) for num ≥ 0, den > 0. */
function roundDiv(num: number, den: number): number {
  return divFloor(2 * num + den, 2 * den);
}

function formatLabel(shape: string, speedLimitMms: number, gradePercentTenths: number): string {
  return `${shape} · ${kmh(speedLimitMms)} km/h · ${divFloor(gradePercentTenths, 10)}.${gradePercentTenths % 10}%`;
}

function emptyPlan(note: string): TrackPlan {
  return Object.freeze({
    pieces: Object.freeze([]),
    fit: "none",
    end: null,
    snapped: null,
    counts: Object.freeze({ new: 0, reused: 0 }),
    lengthMm: 0,
    minRadiusM: null,
    maxGradePermille: 0,
    speedLimitMms: MAX_SPEED_MMS,
    label: formatLabel("Straight", MAX_SPEED_MMS, 0),
    note,
  });
}

interface Chosen {
  readonly cand: Candidate;
  readonly shapes: readonly Shape[];
  readonly specs: readonly PieceSpec[];
}

function finish(ctx: PlannerContext, chosen: Chosen, snapped: NodeRef | null): TrackPlan {
  const { cand, specs, shapes } = chosen;
  const seen = new Set<string>();
  let fresh = 0;
  let reused = 0;
  for (const spec of specs) {
    const key = canonicalKey(spec);
    if (key !== undefined && seen.has(key)) continue;
    if (key !== undefined) seen.add(key);
    if (key !== undefined && ctx.authored.pieces.has(key)) reused += 1;
    else fresh += 1;
  }
  let lengthMm = 0;
  let speedLimitMms = MAX_SPEED_MMS;
  let minRadiusM: RadiusClassM | null = null;
  let hasShift = false;
  // The steepest piece, compared as exact rationals |rise| / length.
  let steepRise = 0;
  let steepLength = 1;
  specs.forEach((spec, i) => {
    const shape = shapes[i];
    if (!shape) return;
    lengthMm += shape.lengthMm;
    speedLimitMms = Math.min(speedLimitMms, shape.speedLimitMms);
    if (spec.kind === "curve" && (minRadiusM === null || spec.radiusM < minRadiusM)) minRadiusM = spec.radiusM;
    if (spec.kind === "shift") hasShift = true;
    const rise = Math.abs(spec.z1Mm - spec.from.zMm);
    if (rise * steepLength > steepRise * shape.lengthMm) {
      steepRise = rise;
      steepLength = shape.lengthMm;
    }
  });
  const last = specs[specs.length - 1];
  const lastShape = shapes[shapes.length - 1];
  if (!last || !lastShape) throw new Error("planner chose an empty candidate");
  const endNode = nodeRef(last.from.q + lastShape.dq, last.from.r + lastShape.dr, last.z1Mm);
  const shapeLabel = minRadiusM !== null ? `R ${minRadiusM} m` : hasShift ? "Shift" : "Straight";
  return Object.freeze({
    pieces: Object.freeze([...specs]),
    fit: cand.fit,
    end: Object.freeze({ node: endNode, heading: cand.endHeading }),
    snapped,
    counts: Object.freeze({ new: fresh, reused }),
    lengthMm,
    minRadiusM,
    maxGradePermille: roundDiv(steepRise * 10_000, steepLength) / 10,
    speedLimitMms,
    label: formatLabel(shapeLabel, speedLimitMms, roundDiv(steepRise * 1000, steepLength)),
    note: null,
  });
}

/** Ranks the candidates by `compareCandidates` and chooses among them. */
function choose(ctx: PlannerContext, from: NodeRef, endZMm: number, candidates: readonly Candidate[]): Chosen {
  return chooseRanked(ctx, from, endZMm, [...candidates].sort(compareCandidates));
}

/** Returns the first valid candidate among the first `MAX_VALIDATIONS` of `ranked` (best first), else the top one. */
function chooseRanked(ctx: PlannerContext, from: NodeRef, endZMm: number, ranked: readonly Candidate[]): Chosen {
  const structure = resolveStructure("auto");
  let top: Chosen | undefined;
  for (let i = 0; i < ranked.length && i < MAX_VALIDATIONS; i++) {
    const cand = ranked[i];
    if (!cand) break;
    const shapes = shapesOf(cand.segs);
    const chosen: Chosen = { cand, shapes, specs: specsOf(ctx, from, endZMm, shapes) };
    top ??= chosen;
    if (validate(ctx, { kind: "build", specs: chosen.specs, structure }).ok) return chosen;
  }
  if (!top) throw new Error("planner chose from no candidates");
  return top;
}

// ---------------------------------------------------------------------------
// Snapping

/** A plan position in mm as floats: for choosing (snapping, ranking), never for keys. */
export interface PlanXY {
  readonly x: number;
  readonly y: number;
}

/** Plan position of a node in mm; y is irrational, so this is for choosing, never for keys. */
function planOf(q: number, r: number): PlanXY {
  return { x: 2500 * (2 * q + r), y: 2500 * SQRT3 * r };
}

function dist2(p: PlanXY, q: number, r: number): number {
  const n = planOf(q, r);
  const dx = n.x - p.x;
  const dy = n.y - p.y;
  return dx * dx + dy * dy;
}

function hexDistance(dq: number, dr: number): number {
  return divFloor(Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr), 2);
}

/** The pointer relative to the start in d0's frame, mm: `ahead` along d0, `left` square to it. */
function frameOf(p: PlanXY, from: Axial, d0: Heading): { readonly ahead: number; readonly left: number } {
  const s = planOf(from.q, from.r);
  const u = unit(d0);
  const dx = p.x - s.x;
  const dy = p.y - s.y;
  return { ahead: dx * u.x + dy * u.y, left: u.x * dy - u.y * dx };
}

/**
 * The turn, in 30° steps, that a single circular arc leaving the start on
 * d0 and passing through the pointer would make: twice the pointer's bearing
 * from d0 (the tangent–chord angle), as the nearest heading step (ties to the
 * lower heading index). The arc's end direction is the pointer offset
 * (ahead, left) squared as a complex number, (ahead² − left², 2·ahead·left),
 * so no trigonometry is needed. A pointer abeam or behind the start gives a
 * U-turn toward its side, ±6 (left when exactly on the line): an arc through
 * it would turn 180° or more. Exported for the oracle tests.
 */
export function arcTurn(p: PlanXY, from: Axial, d0: Heading): number {
  const { ahead, left } = frameOf(p, from, d0);
  const side = left < 0 ? -6 : 6;
  if (ahead <= 0) return side;
  const u = unit(d0);
  const vx = ahead * ahead - left * left;
  const vy = 2 * ahead * left;
  const t = signedTurn(d0, nearestHeading(vx * u.x - vy * u.y, vx * u.y + vy * u.x));
  return t === -6 ? side : t;
}

/**
 * The U-turn end nearest the pointer: the node, among those a two-bend fit
 * turning 180° reaches, nearest `p` (ties: left before right, then the
 * smaller q, then r). A U-turn is two 90° bends to one side, so its
 * straights run on d0, on d0 ± 90° and back on d0 + 180°: each template pair
 * reaches T + k·step(d0) + y·step(d0 ± 90°) for any integer k and y ≥ 0. The
 * two steps are square to each other, so the nearest such node rounds each
 * coordinate on its own (both neighbours are checked); the minimum over the
 * pairs is then exact. Undefined when the rules allow no U-turn pair.
 * Exported for the oracle tests.
 */
export function nearestUTurnEnd(p: PlanXY, from: Axial, d0: Heading, rules: Rules): Axial | undefined {
  let best: Axial | undefined;
  let bestKey: readonly [number, number, number, number] | undefined;
  const a = stepOf(d0);
  const ua = unit(d0);
  const lenA = isPrimary(d0) ? 5000 : 5000 * SQRT3;
  ([3, -3] as const).forEach((turn, side) => {
    const dm = rotateHeading(d0, turn);
    const b = stepOf(dm);
    const ub = unit(dm);
    const lenB = isPrimary(dm) ? 5000 : 5000 * SQRT3;
    for (const t1 of curvesTurning(d0, turn)) {
      if (!rules.allowRadius(t1.radiusM)) continue;
      for (const t2 of curvesTurning(dm, turn)) {
        if (!rules.allowRadius(t2.radiusM)) continue;
        const q0 = from.q + t1.dq + t2.dq;
        const r0 = from.r + t1.dr + t2.dr;
        const o = planOf(q0, r0);
        const f = ((p.x - o.x) * ua.x + (p.y - o.y) * ua.y) / lenA;
        const l = ((p.x - o.x) * ub.x + (p.y - o.y) * ub.y) / lenB;
        const k0 = Math.floor(f);
        const y0 = Math.max(0, Math.floor(l));
        for (const k of [k0, k0 + 1]) {
          for (const y of y0 === 0 && l < 0 ? [0] : [y0, y0 + 1]) {
            const q = q0 + k * a.q + y * b.q;
            const r = r0 + k * a.r + y * b.r;
            const key = [dist2(p, q, r), side, q, r] as const;
            if (bestKey && compareTuples(key, bestKey) >= 0) continue;
            best = { q, r };
            bestKey = key;
          }
        }
      }
    }
  });
  return best;
}

/**
 * Whether a node reaches at least halfway from the start to the pointer,
 * measured along the drag (the start → pointer direction). The fallback
 * search skips nodes that stop short of that, so a pointer abeam inside the
 * turning circle gets a bend towards it instead of a stub of straights ahead,
 * which lie nearer it. Beyond a few nodes from the start, nodes within a few
 * metres of the pointer always pass.
 */
function reachesHalfway(p: PlanXY, from: Axial): (node: Axial) => boolean {
  const s = planOf(from.q, from.r);
  const wx = p.x - s.x;
  const wy = p.y - s.y;
  const w2 = wx * wx + wy * wy;
  return (node) => {
    const e = planOf(node.q, node.r);
    return 2 * ((e.x - s.x) * wx + (e.y - s.y) * wy) >= w2;
  };
}

function compareTuples(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The heading whose direction is nearest (dx, dy); ties to the lower index. */
function nearestHeading(dx: number, dy: number): Heading {
  let best: Heading = 0;
  let bestDot = -Infinity;
  for (const h of HEADINGS) {
    const u = unit(h);
    const dot = dx * u.x + dy * u.y;
    if (dot > bestDot) {
      best = h;
      bestDot = dot;
    }
  }
  return best;
}

/**
 * The node nearest the pointer that `reaches` accepts: N itself when it
 * does, else an exact search ring by ring around N (ring k lies at least
 * k·4330 mm from N, so the search stops once that bound, less N's own
 * offset from the pointer, passes the best distance found). Distance ties go
 * to the smaller q, then r.
 */
function nearestReachable(p: PlanXY, n: Axial, reaches: (node: Axial) => boolean): Axial | undefined {
  if (reaches(n)) return n;
  const offset = Math.sqrt(dist2(p, n.q, n.r));
  let best: Axial | undefined;
  let bestD2 = Infinity;
  for (let k = 1; k <= MAX_SNAP_RINGS; k++) {
    if (best && k * RING_STEP_MM - offset > Math.sqrt(bestD2)) break;
    for (let dq = 0 - k; dq <= k; dq++) {
      const lo = Math.max(0 - k, 0 - dq - k);
      const hi = Math.min(k, k - dq);
      for (let dr = lo; dr <= hi; dr++) {
        if (hexDistance(dq, dr) !== k) continue;
        const node = { q: n.q + dq, r: n.r + dr };
        const d2 = dist2(p, node.q, node.r);
        if (d2 > bestD2) continue;
        if (d2 === bestD2 && best && (node.q > best.q || (node.q === best.q && node.r > best.r))) continue;
        if (!reaches(node)) continue;
        best = node;
        bestD2 = d2;
      }
    }
  }
  return best;
}

interface Port {
  readonly node: NodeRef;
  /** The heading a plan must arrive with to continue into the existing piece. */
  readonly heading: Heading;
}

function parseNodeKey(key: string): NodeRef | undefined {
  const parts = key.split(",").map(Number);
  const [q, r, z] = parts;
  if (parts.length !== 3 || q === undefined || r === undefined || z === undefined) return undefined;
  return isNodeRef({ q, r, zMm: z }) ? nodeRef(q, r, z) : undefined;
}

/** The existing buffer end at `node`, if it is one. */
function portAt(ctx: PlannerContext, node: NodeRef): Port | undefined {
  const entries = ctx.index.nodes.get(nodeKey(node));
  const only = entries?.length === 1 ? entries[0] : undefined;
  return only ? { node, heading: only.outward } : undefined;
}

/** Buffer ends within `MAGNET_RANGE_NODES` of `n`, except `from`: nearest the pointer first, ties by node order. */
function portsNear(ctx: PlannerContext, n: Axial, from: NodeRef, p: PlanXY): Port[] {
  const found: { port: Port; d2: number }[] = [];
  for (const [key, entries] of ctx.index.nodes) {
    const only = entries.length === 1 ? entries[0] : undefined;
    if (!only) continue;
    const node = parseNodeKey(key);
    if (!node || hexDistance(node.q - n.q, node.r - n.r) > MAGNET_RANGE_NODES) continue;
    if (node.q === from.q && node.r === from.r && node.zMm === from.zMm) continue;
    found.push({ port: { node, heading: only.outward }, d2: dist2(p, node.q, node.r) });
  }
  return found.sort((a, b) => a.d2 - b.d2 || compareNodes(a.port.node, b.port.node)).map((f) => f.port);
}

/**
 * The start heading d0 (see the module comment): the drag's own, else at an
 * existing buffer end the nearer of continuing and retracing, else the
 * heading nearest the direction towards `toward`.
 */
function startHeading(ctx: PlannerContext, from: NodeRef, fromHeading: Heading | undefined, toward: PlanXY): Heading {
  if (fromHeading !== undefined) return fromHeading;
  const start = planOf(from.q, from.r);
  const dx = toward.x - start.x;
  const dy = toward.y - start.y;
  const port = portAt(ctx, from);
  if (!port) return nearestHeading(dx, dy);
  const onward = opposite(port.heading);
  const back = unit(port.heading);
  const ahead = unit(onward);
  return dx * back.x + dy * back.y > dx * ahead.x + dy * ahead.y ? port.heading : onward;
}

/** A plan that joins `port` exactly (position and heading), or undefined when no fit reaches it. */
function planToPort(ctx: PlannerContext, drag: Drag, from: NodeRef, port: Port, rules: Rules, snapped: NodeRef | null): TrackPlan | undefined {
  const delta = sub(port.node, from);
  if (delta.q === 0 && delta.r === 0) return undefined;
  const d0 = startHeading(ctx, from, drag.fromHeading, planOf(port.node.q, port.node.r));
  const candidates = [...singleBend(d0, delta, port.heading, rules), ...twoBendFits(d0, delta, port.heading, rules)];
  if (candidates.length === 0) return undefined;
  return finish(ctx, choose(ctx, from, port.node.zMm, candidates), snapped);
}

function assertDrag(drag: Drag): void {
  if (typeof drag !== "object" || drag === null) throw new TypeError(`a drag must be an object, not ${String(drag)}`);
  if (!isNodeRef(drag.from)) throw new TypeError("drag.from must be a lattice node with integer q, r and zMm");
  if (drag.fromHeading !== undefined && !isHeading(drag.fromHeading)) throw new TypeError(`drag.fromHeading ${String(drag.fromHeading)} is not a heading 0–11`);
  if (typeof drag.to !== "object" || drag.to === null || !Number.isFinite(drag.to.xMm) || !Number.isFinite(drag.to.yMm)) {
    throw new TypeError("drag.to must be a finite plan point in mm");
  }
  if (!Number.isSafeInteger(drag.dzMm)) throw new TypeError(`drag.dzMm must be a safe integer, not ${String(drag.dzMm)}`);
  if (drag.radiusCapM !== undefined && !isRadiusClass(drag.radiusCapM)) throw new TypeError(`drag.radiusCapM ${String(drag.radiusCapM)} is not a radius class`);
  const precision = drag.precision;
  if (precision !== undefined) {
    if (typeof precision !== "object" || precision === null || !isRadiusClass(precision.radiusM)) {
      throw new TypeError("drag.precision needs a radius class");
    }
    if (precision.endHeading !== undefined && !isHeading(precision.endHeading)) {
      throw new TypeError(`drag.precision.endHeading ${String(precision.endHeading)} is not a heading 0–11`);
    }
  }
}

/**
 * Plans a drag. A malformed drag (non-integer start, non-finite pointer,
 * invalid heading or radius) is a programmer error and throws a TypeError,
 * like a malformed command; everything a player can reach returns a plan,
 * possibly empty with a `note`, or one that `preview` rejects with a reason.
 */
export function planTrack(ctx: PlannerContext, drag: Drag): TrackPlan {
  assertDrag(drag);
  const from = nodeRef(drag.from.q, drag.from.r, drag.from.zMm);
  const precision = drag.precision;
  const cap = drag.radiusCapM ?? DEFAULT_RADIUS_CAP_M;
  const rules: Rules = { allowRadius: precision ? (r) => r === precision.radiusM : (r) => r <= cap };
  const magnetism = drag.magnetism && precision === undefined;
  const pointer: PlanXY = { x: drag.to.xMm, y: drag.to.yMm };
  const n = nearestNode({ x: drag.to.xMm / 1000, y: drag.to.yMm / 1000 });
  const endZMm = from.zMm + drag.dzMm;

  if (magnetism) {
    for (const port of portsNear(ctx, n, from, pointer)) {
      const plan = planToPort(ctx, drag, from, port, rules, port.node);
      if (plan) return plan;
    }
  } else if (precision?.endHeading === undefined) {
    const end = nodeRef(n.q, n.r, endZMm);
    const port = end.q === from.q && end.r === from.r && end.zMm === from.zMm ? undefined : portAt(ctx, end);
    const plan = port ? planToPort(ctx, drag, from, port, rules, null) : undefined;
    if (plan) return plan;
  }

  if (n.q === from.q && n.r === from.r) return emptyPlan("Drag farther to lay track");
  const d0 = startHeading(ctx, from, drag.fromHeading, pointer);
  const endHeading = precision?.endHeading;
  const oneBend = (node: Axial): Candidate[] => singleBend(d0, sub(node, from), endHeading, rules);
  // One bend reaching the pointer's node: the selection as before the two-bend fallback, exactly.
  const atPointer = oneBend(n);
  if (atPointer.length > 0) return finish(ctx, choose(ctx, from, endZMm, atPointer), null);
  // Otherwise two bends in one drag (owner decision 2026-09-27).
  const tau = arcTurn(pointer, from, d0);
  const twoAtPointer = bestTwoBend(d0, sub(n, from), endHeading, rules, tau);
  if (twoAtPointer.length > 0) return finish(ctx, chooseRanked(ctx, from, endZMm, twoAtPointer), null);
  const uTurns = endHeading === undefined || endHeading === opposite(d0);
  let target: Axial | undefined;
  if (uTurns && frameOf(pointer, from, d0).ahead < 0) {
    target = nearestUTurnEnd(pointer, from, d0, rules);
  } else {
    const halfway = reachesHalfway(pointer, from);
    const twoReach = twoBendReach(d0, endHeading, rules);
    target = nearestReachable(pointer, n, (node) => halfway(node) && (oneBend(node).length > 0 || twoReach(sub(node, from))));
    if (!target && uTurns) target = nearestUTurnEnd(pointer, from, d0, rules);
  }
  if (!target) {
    return emptyPlan(
      precision && endHeading !== undefined
        ? `No R ${precision.radiusM} m fit ending at ${endHeading * 30}° lies near the pointer; drag farther from the start or change the end heading.`
        : "No track from this heading reaches near the pointer; drag farther from the start.",
    );
  }
  const atTarget = oneBend(target);
  if (atTarget.length > 0) return finish(ctx, choose(ctx, from, endZMm, atTarget), null);
  return finish(ctx, chooseRanked(ctx, from, endZMm, bestTwoBend(d0, sub(target, from), endHeading, rules, tau)), null);
}
