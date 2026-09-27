import { type NodeRef, type PieceSpec, canonicalKey } from "../geometry/piece";
import { MAX_SPEED_MMS, type RadiusClassM } from "../geometry/templates";
import { HEADINGS, type Heading, stepLengthMm, stepOf, unit } from "../lattice";
import { divFloor } from "../util/int";
import type { AuthoredState } from "./authored";
import type { Counts } from "./validate";

/**
 * The planner (simulation model §8, ADR 0010 decision 7): turns a drag the
 * tool has already interpreted into resolved pieces. It reads the authored
 * state and never changes it; `build-track` then carries `plan.pieces`, so
 * later planner tuning never breaks a replay.
 *
 * D3 contract commit: `Drag` and `TrackPlan` are the interface the track
 * tool builds against. The body below is a straight-only stub (d0, then n
 * straights). The full planner replaces it in the same slice: one-bend and
 * shift fits, two-bend fits into ports, magnetism, precision mode and the
 * selection order.
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
  /** End height minus `from.zMm`, in integer mm (the tool accumulates elevation steps). */
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

export interface PlannerContext {
  readonly authored: AuthoredState;
}

/** Km/h for display, from mm/s. */
function kmh(mms: number): number {
  return Math.round((mms * 36) / 10_000);
}

function formatLabel(minRadiusM: RadiusClassM | null, speedLimitMms: number, gradePermille: number): string {
  const shape = minRadiusM === null ? "Straight" : `R ${minRadiusM} m`;
  return `${shape} · ${kmh(speedLimitMms)} km/h · ${(gradePermille / 10).toFixed(1)}%`;
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
    label: formatLabel(null, MAX_SPEED_MMS, 0),
    note,
  });
}

/** Plan position of a node in mm; y is irrational, so this is for choosing, never for keys. */
function planOfNode(n: NodeRef): { x: number; y: number } {
  return { x: 5000 * (n.q + n.r / 2), y: 2500 * 1.7320508075688772 * n.r };
}

/** STUB (D3 contract commit): n straights along one heading. The full planner replaces this body. */
export function planTrack(ctx: PlannerContext, drag: Drag): TrackPlan {
  const start = planOfNode(drag.from);
  const dx = drag.to.xMm - start.x;
  const dy = drag.to.yMm - start.y;
  let d0: Heading = drag.fromHeading ?? 0;
  if (drag.fromHeading === undefined) {
    let best = -Infinity;
    for (const h of HEADINGS) {
      const u = unit(h);
      const along = dx * u.x + dy * u.y;
      if (along > best) {
        best = along;
        d0 = h;
      }
    }
  }
  const u = unit(d0);
  const n = Math.max(0, Math.round((dx * u.x + dy * u.y) / stepLengthMm(d0)));
  if (n === 0) return emptyPlan("Drag farther to lay track");

  const step = stepOf(d0);
  const pieces: PieceSpec[] = [];
  let counts = { new: 0, reused: 0 };
  let z = drag.from.zMm;
  for (let i = 0; i < n; i++) {
    const z1 = drag.from.zMm + divFloor(drag.dzMm * (i + 1), n);
    const spec: PieceSpec = Object.freeze({
      kind: "straight",
      from: Object.freeze({ q: drag.from.q + step.q * i, r: drag.from.r + step.r * i, zMm: z }),
      heading: d0,
      z1Mm: z1,
    });
    const key = canonicalKey(spec);
    counts = key !== undefined && ctx.authored.pieces.has(key) ? { ...counts, reused: counts.reused + 1 } : { ...counts, new: counts.new + 1 };
    pieces.push(spec);
    z = z1;
  }
  const lengthMm = n * stepLengthMm(d0);
  const grade = Math.round((Math.abs(drag.dzMm) * 10_000) / lengthMm) / 10;
  return Object.freeze({
    pieces: Object.freeze(pieces),
    fit: "straight",
    end: Object.freeze({
      node: Object.freeze({ q: drag.from.q + step.q * n, r: drag.from.r + step.r * n, zMm: drag.from.zMm + drag.dzMm }),
      heading: d0,
    }),
    snapped: null,
    counts: Object.freeze(counts),
    lengthMm,
    minRadiusM: null,
    maxGradePermille: grade,
    speedLimitMms: MAX_SPEED_MMS,
    label: formatLabel(null, MAX_SPEED_MMS, grade),
    note: null,
  });
}
