import { type Heading, isHeading, opposite, toWorld } from "../lattice";
import {
  type BoundsM,
  type RadiusClassM,
  type RenderPrim,
  type ShiftSide,
  type Template,
  type Turn,
  RADIUS_CLASSES_M,
  curveTemplate,
  curveVariantCount,
  isRadiusClass,
  isTurn,
  shiftTemplate,
  straightTemplate,
} from "./templates";

/**
 * Pieces: templates placed at a lattice node with heights, identified by a
 * canonical key (ADR 0010 §5, simulation model §6).
 *
 * Node identity is (q, r, zMm), with z in integer millimetres (issue #66
 * amendment, 2026-09-26): 35‰ over a 5 m straight is exactly 175 mm, which dm
 * could not express. Terrain stays Int16 dm and converts at its boundary.
 *
 * A key is written from the end with the smaller (q, r, z), compared q, then
 * r, then z. Describing a piece from its other end maps d → d + 6 (of the end
 * heading), turn → −turn, z0 ↔ z1, keeps a shift's side, and keeps a curve's
 * variant index: variants are ordered by length, and the reversed variant has
 * the same length (templates.ts throws if two variants ever tied).
 */

/**
 * Node heights must lie within ±10 km (±10,000,000 mm), or the spec is
 * `out-of-bounds`. That is far outside terrain's Int16 dm range (±3,276.7 m),
 * and it keeps the grade numerator Δz·1000 at most 2e10, so `gradePermille`
 * stays an exact integer rational (safe integers stop at about 9e15).
 */
export const Z_LIMIT_MM = 10_000_000;

export type PieceKey = string;
export type PieceKind = "straight" | "curve" | "shift";
export type Structure = "ground" | "bridge" | "tunnel";

export interface NodeRef {
  readonly q: number;
  readonly r: number;
  readonly zMm: number;
}

export type PieceSpec =
  | { readonly kind: "straight"; readonly from: NodeRef; readonly heading: Heading; readonly z1Mm: number }
  | {
      readonly kind: "curve";
      readonly from: NodeRef;
      readonly heading: Heading;
      readonly turn: Turn;
      readonly radiusM: RadiusClassM;
      readonly variant: number;
      readonly z1Mm: number;
    }
  | {
      readonly kind: "shift";
      readonly from: NodeRef;
      readonly heading: Heading;
      readonly side: ShiftSide;
      readonly z1Mm: number;
    };

/** One end of a piece: its node, and the heading pointing from the node into the piece. */
export interface PieceEnd {
  readonly node: NodeRef;
  readonly outward: Heading;
}

/** An exact rational num/den with den > 0, reduced. */
export interface Rational {
  readonly num: number;
  readonly den: number;
}

export interface Piece {
  readonly key: PieceKey;
  readonly kind: PieceKind;
  /** The canonical spec: written from the smaller end. */
  readonly spec: PieceSpec;
  /** [from, to] in canonical order. */
  readonly ends: readonly [PieceEnd, PieceEnd];
  readonly lengthMm: number;
  /**
   * Grade from → to in ‰ as the exact rational (z1 − z0)·1000 / lengthMm,
   * signed. Kept exact so D4's 35‰ rule compares integers
   * (|num| ≤ 35·den) instead of a rounded value; `Z_LIMIT_MM` keeps both
   * parts safe integers.
   */
  readonly gradePermille: Rational;
  /** The radius class of a curve; null for straights and shifts. */
  readonly radiusClassM: RadiusClassM | null;
  /** Arc radius rounded to mm for curves and shifts; null for straights. */
  readonly radiusMm: number | null;
  readonly speedLimitMms: number;
  readonly structure: Structure;
  /** Render primitives in world metres, from → to. */
  readonly prims: readonly RenderPrim[];
  /** World plan extent of `prims`, in metres. */
  readonly boundsM: BoundsM;
}

/** Codes a spec can fail on before any state is consulted (rule 1 malformed nodes, rule 2 geometry). */
export type SpecFailureCode = "out-of-bounds" | "radius-too-tight" | "turn-too-sharp" | "no-fit";

export interface SpecFailure {
  readonly code: SpecFailureCode;
  readonly message: string;
}

export type Resolution =
  | { readonly ok: true; readonly piece: Piece }
  | { readonly ok: false; readonly failure: SpecFailure };

/** Converts a -0 result to +0 so keys and canonical JSON stay stable. */
function noNegativeZero(n: number): number {
  return n + 0;
}

export function nodeRef(q: number, r: number, zMm: number): NodeRef {
  return Object.freeze({ q: noNegativeZero(q), r: noNegativeZero(r), zMm: noNegativeZero(zMm) });
}

export function isNodeRef(v: unknown): v is NodeRef {
  if (typeof v !== "object" || v === null) return false;
  const n = v as Record<string, unknown>;
  return Number.isSafeInteger(n.q) && Number.isSafeInteger(n.r) && Number.isSafeInteger(n.zMm);
}

/** Orders nodes by q, then r, then z (the key normalisation order). */
export function compareNodes(a: NodeRef, b: NodeRef): number {
  if (a.q !== b.q) return a.q < b.q ? -1 : 1;
  if (a.r !== b.r) return a.r < b.r ? -1 : 1;
  if (a.zMm !== b.zMm) return a.zMm < b.zMm ? -1 : 1;
  return 0;
}

export function sameNode(a: NodeRef, b: NodeRef): boolean {
  return a.q === b.q && a.r === b.r && a.zMm === b.zMm;
}

/** "q,r,zMm": the node identity as a string. */
export function nodeKey(n: NodeRef): string {
  return `${n.q},${n.r},${n.zMm}`;
}

/** Writes a spec as a key exactly as described (no normalisation). */
export function formatKey(spec: PieceSpec): PieceKey {
  const head = `${spec.from.q},${spec.from.r},${spec.from.zMm}:${spec.heading}`;
  switch (spec.kind) {
    case "straight":
      return `S:${head}:${spec.z1Mm}`;
    case "curve":
      return `C:${head}:${spec.turn}:${spec.radiusM}:${spec.variant}:${spec.z1Mm}`;
    case "shift":
      return `H:${head}:${spec.side}:${spec.z1Mm}`;
  }
}

const INT = "(0|-?[1-9]\\d*)";
const HEAD = `${INT},${INT},${INT}:(\\d|1[01])`;
const STRAIGHT_KEY = new RegExp(`^S:${HEAD}:${INT}$`);
const CURVE_KEY = new RegExp(`^C:${HEAD}:(-?[1-3]):(${RADIUS_CLASSES_M.join("|")}):(0|[1-9]\\d*):${INT}$`);
const SHIFT_KEY = new RegExp(`^H:${HEAD}:(left|right):${INT}$`);

/**
 * Parses a key into the spec it describes (not normalised), or undefined if
 * it is not a well-formed key. Numbers must be canonical integers (no
 * leading zeros, no -0), so parse ∘ format and format ∘ parse are identities.
 */
export function parseKey(key: unknown): PieceSpec | undefined {
  if (typeof key !== "string") return undefined;
  let m = STRAIGHT_KEY.exec(key);
  if (m) {
    const [q, r, z0, h, z1] = ints(m, 5);
    if (q === undefined || r === undefined || z0 === undefined || z1 === undefined || !isHeadingNumber(h)) return undefined;
    return { kind: "straight", from: nodeRef(q, r, z0), heading: h, z1Mm: z1 };
  }
  m = CURVE_KEY.exec(key);
  if (m) {
    const [q, r, z0, h, turn, radius, variant, z1] = ints(m, 8);
    if (q === undefined || r === undefined || z0 === undefined || z1 === undefined || variant === undefined) return undefined;
    if (!isHeadingNumber(h) || !isTurnNumber(turn) || !isRadiusClass(radius)) return undefined;
    return { kind: "curve", from: nodeRef(q, r, z0), heading: h, turn, radiusM: radius, variant, z1Mm: z1 };
  }
  m = SHIFT_KEY.exec(key);
  if (m) {
    const side = m[5] === "left" ? "left" : "right";
    const [q, r, z0, h] = ints(m, 4);
    const z1 = toSafe(m[6]);
    if (q === undefined || r === undefined || z0 === undefined || z1 === undefined || !isHeadingNumber(h)) return undefined;
    return { kind: "shift", from: nodeRef(q, r, z0), heading: h, side, z1Mm: z1 };
  }
  return undefined;
}

function toSafe(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : undefined;
}

function ints(m: RegExpExecArray, count: number): (number | undefined)[] {
  return Array.from({ length: count }, (_, i) => toSafe(m[i + 1]));
}

function isHeadingNumber(n: number | undefined): n is Heading {
  return n !== undefined && isHeading(n);
}

function isTurnNumber(n: number | undefined): n is Turn {
  return n !== undefined && n !== 0 && Math.abs(n) <= 3;
}

function fail(code: SpecFailureCode, message: string): Resolution {
  return { ok: false, failure: { code, message } };
}

function describeNode(n: { q: unknown; r: unknown }): string {
  return `(${String(n.q)}, ${String(n.r)})`;
}

type TemplateOrFailure = { readonly template: Template } | { readonly failure: Resolution };

/** Looks up the oriented template a spec names, or the first geometry failure in catalogue order. */
function templateOf(spec: PieceSpec): TemplateOrFailure {
  const h = spec.heading;
  switch (spec.kind) {
    case "straight":
      return { template: straightTemplate(h) };
    case "curve": {
      // Widened on purpose: commands are runtime data, so the union types may lie.
      const radiusM: unknown = spec.radiusM;
      const turn: unknown = spec.turn;
      const variant: unknown = spec.variant;
      if (!isRadiusClass(radiusM)) {
        return {
          failure: fail(
            "radius-too-tight",
            `Radius ${String(radiusM)} m is ${typeof radiusM === "number" && radiusM < 60 ? "below the 60 m minimum" : "not a radius class"}; use R ≥ 60 m (60, 90, 120, 180, 240 or 360 m).`,
          ),
        };
      }
      if (typeof turn !== "number" || !Number.isInteger(turn) || turn === 0) {
        return {
          failure: fail("no-fit", `A curve must turn ±1, ±2 or ±3 steps of 30°, not ${String(turn)}; use a straight or pick a 30°, 60° or 90° turn.`),
        };
      }
      if (!isTurn(turn)) {
        return {
          failure: fail("turn-too-sharp", `A ${Math.abs(turn) * 30}° turn is more than 90° in one bend; split it into two bends.`),
        };
      }
      const template = typeof variant === "number" && Number.isSafeInteger(variant) ? curveTemplate(h, turn, radiusM, variant) : undefined;
      if (!template) {
        const count = curveVariantCount(h, turn, radiusM);
        return {
          failure: fail(
            "no-fit",
            `No curve variant ${String(variant)} closes on the lattice for a ${Math.abs(turn) * 30}° turn at R ${radiusM} m (${count === 1 ? "only variant 0 exists" : `variants 0–${count - 1}`}); move the end or change the end heading.`,
          ),
        };
      }
      return { template };
    }
    case "shift":
      if (spec.side !== "left" && spec.side !== "right") {
        return { failure: fail("no-fit", `A shift moves one row "left" or "right", not ${String(spec.side)}; pick a side.`) };
      }
      return { template: shiftTemplate(h, spec.side) };
    default:
      return {
        failure: fail("no-fit", `Unknown piece kind ${String((spec as { kind?: unknown }).kind)}; build straights, curves or shifts.`),
      };
  }
}

/** The same physical piece described from its end node. */
function reversedSpec(spec: PieceSpec, template: Template, end: NodeRef): PieceSpec {
  const from = end;
  const heading = opposite(template.endHeading);
  const z1Mm = spec.from.zMm;
  switch (spec.kind) {
    case "straight":
      return { kind: "straight", from, heading, z1Mm };
    case "curve":
      return { kind: "curve", from, heading, turn: (0 - spec.turn) as Turn, radiusM: spec.radiusM, variant: spec.variant, z1Mm };
    case "shift":
      return { kind: "shift", from, heading, side: spec.side, z1Mm };
  }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function grade(riseMm: number, lengthMm: number): Rational {
  const num = riseMm * 1000;
  if (num === 0) return Object.freeze({ num: 0, den: 1 });
  const g = gcd(num, lengthMm);
  return Object.freeze({ num: noNegativeZero(num / g), den: lengthMm / g });
}

function translate(p: RenderPrim, ox: number, oy: number): RenderPrim {
  return p.kind === "line"
    ? Object.freeze({ kind: "line", x0: p.x0 + ox, y0: p.y0 + oy, x1: p.x1 + ox, y1: p.y1 + oy })
    : Object.freeze({ kind: "arc", cx: p.cx + ox, cy: p.cy + oy, radiusM: p.radiusM, startRad: p.startRad, sweepRad: p.sweepRad });
}

/** A fresh frozen spec with only the fields of its kind (callers may pass extra properties). */
function cleanSpec(spec: PieceSpec, from: NodeRef): PieceSpec {
  const { heading, z1Mm } = spec;
  switch (spec.kind) {
    case "straight":
      return Object.freeze({ kind: "straight", from, heading, z1Mm });
    case "curve":
      return Object.freeze({ kind: "curve", from, heading, turn: spec.turn, radiusM: spec.radiusM, variant: spec.variant, z1Mm });
    case "shift":
      return Object.freeze({ kind: "shift", from, heading, side: spec.side, z1Mm });
  }
}

function buildPiece(spec: PieceSpec, template: Template, structure: Structure): Piece {
  const from = nodeRef(spec.from.q, spec.from.r, spec.from.zMm);
  const to = nodeRef(from.q + template.dq, from.r + template.dr, spec.z1Mm);
  const origin = toWorld(from);
  const b = template.boundsM;
  const canonical = cleanSpec(spec, from);
  return Object.freeze({
    key: formatKey(canonical),
    kind: spec.kind,
    spec: canonical,
    ends: Object.freeze([
      Object.freeze({ node: from, outward: template.heading }),
      Object.freeze({ node: to, outward: opposite(template.endHeading) }),
    ] as const),
    lengthMm: template.lengthMm,
    gradePermille: grade(spec.z1Mm - from.zMm, template.lengthMm),
    radiusClassM: template.kind === "curve" ? template.radiusM : null,
    radiusMm: template.kind === "curve" ? template.radiusM * 1000 : template.kind === "shift" ? template.radiusMm : null,
    speedLimitMms: template.speedLimitMms,
    structure,
    prims: Object.freeze(template.prims.map((p) => translate(p, origin.x, origin.y))),
    boundsM: Object.freeze({ minX: b.minX + origin.x, minY: b.minY + origin.y, maxX: b.maxX + origin.x, maxY: b.maxY + origin.y }),
  });
}

/**
 * Resolves a spec into its canonical piece, or the first failure in the
 * catalogue order (malformed node or height past `Z_LIMIT_MM` →
 * out-of-bounds; then radius, turn, fit).
 * Never throws on malformed input: commands are player-reachable.
 */
export function resolvePiece(spec: PieceSpec, structure: Structure = "ground"): Resolution {
  if (typeof spec !== "object" || spec === null) {
    return fail("no-fit", "A piece must be a straight, curve or shift spec; rebuild the track from the planner.");
  }
  const from: unknown = spec.from;
  if (!isNodeRef(from) || !Number.isSafeInteger(spec.z1Mm)) {
    const at = typeof from === "object" && from !== null ? describeNode(from as { q: unknown; r: unknown }) : String(from);
    return fail("out-of-bounds", `Piece start ${at} is not a lattice node with whole-millimetre heights; snap the track to the lattice.`);
  }
  if (Math.abs(from.zMm) > Z_LIMIT_MM || Math.abs(spec.z1Mm) > Z_LIMIT_MM) {
    return fail(
      "out-of-bounds",
      `Piece heights ${from.zMm} mm → ${spec.z1Mm} mm pass the ±10 km (±${Z_LIMIT_MM} mm) limit for node heights; keep the track within 10 km of height 0.`,
    );
  }
  if (!isHeading(spec.heading)) {
    return fail("no-fit", `Heading ${String(spec.heading)} is not one of the 12 lattice headings (0–11); change the end heading.`);
  }
  const found = templateOf(spec);
  if ("failure" in found) return found.failure;
  const t = found.template;
  const end = nodeRef(from.q + t.dq, from.r + t.dr, spec.z1Mm);
  if (compareNodes(end, from) >= 0) return { ok: true, piece: buildPiece(spec, t, structure) };

  const back = reversedSpec(spec, t, end);
  const reverse = templateOf(back);
  if ("failure" in reverse || reverse.template.dq !== 0 - t.dq || reverse.template.dr !== 0 - t.dr) {
    throw new Error(`template table is not closed under reversal at ${formatKey(spec)}`);
  }
  return { ok: true, piece: buildPiece(back, reverse.template, structure) };
}

/** Parses and resolves a key (canonical or not); undefined when it names no valid piece. */
export function pieceFromKey(key: unknown, structure: Structure = "ground"): Piece | undefined {
  const spec = parseKey(key);
  if (!spec) return undefined;
  const res = resolvePiece(spec, structure);
  return res.ok ? res.piece : undefined;
}

/** The canonical key of a spec, or undefined if the spec does not resolve. */
export function canonicalKey(spec: PieceSpec): PieceKey | undefined {
  const res = resolvePiece(spec);
  return res.ok ? res.piece.key : undefined;
}
