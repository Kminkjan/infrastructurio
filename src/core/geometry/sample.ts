import type { ArcPrim, RenderPrim } from "./templates";

/**
 * Render-side sampling of piece geometry (simulation model §3), and the
 * single source of curve maths for render (end points, plan boxes and
 * nearest centreline points too). Pure and float-based; the tick step never
 * calls it. The one core consumer is `clearance.ts`, whose float decision is
 * taken at commit time only.
 */

/** A point along a piece in world metres, with its float arc length from the start. */
export interface SamplePoint {
  readonly x: number;
  readonly y: number;
  readonly sM: number;
}

interface HasPrims {
  readonly prims: readonly RenderPrim[];
}

/** The piece's render primitives (lines and arcs), from → to. */
export function primitives(piece: HasPrims): readonly RenderPrim[] {
  return piece.prims;
}

export function primLengthM(p: RenderPrim): number {
  return p.kind === "line" ? Math.hypot(p.x1 - p.x0, p.y1 - p.y0) : p.radiusM * Math.abs(p.sweepRad);
}

/**
 * Chords needed so none bulges more than `maxSagittaM` from the arc: a chord
 * over angle φ has sagitta R(1 − cos(φ/2)).
 */
export function arcSegmentCount(radiusM: number, sweepRad: number, maxSagittaM: number): number {
  if (!(maxSagittaM > 0) || !Number.isFinite(maxSagittaM)) throw new RangeError(`maxSagittaM must be > 0, got ${maxSagittaM}`);
  if (maxSagittaM >= radiusM) return 1;
  const halfAngle = Math.acos(1 - maxSagittaM / radiusM);
  let n = Math.max(1, Math.ceil(Math.abs(sweepRad) / (2 * halfAngle)));
  // Guard against the ceil landing an ulp short of the bound.
  while (arcSagittaM(radiusM, sweepRad, n) > maxSagittaM) n += 1;
  return n;
}

/** Largest chord-to-arc distance when the arc is split into `segments` equal chords. */
export function arcSagittaM(radiusM: number, sweepRad: number, segments: number): number {
  return radiusM * (1 - Math.cos(Math.abs(sweepRad) / (2 * segments)));
}

function arcPoint(p: ArcPrim, fraction: number): { x: number; y: number } {
  const a = p.startRad + p.sweepRad * fraction;
  return { x: p.cx + p.radiusM * Math.cos(a), y: p.cy + p.radiusM * Math.sin(a) };
}

/**
 * Points along the piece from start to end: every line endpoint and enough
 * arc points that no chord's sagitta exceeds `maxSagittaM`. Joins between
 * primitives appear once.
 */
export function samplePiece(piece: HasPrims, maxSagittaM: number): SamplePoint[] {
  const out: SamplePoint[] = [];
  let s = 0;
  for (const p of piece.prims) {
    if (out.length === 0) {
      const start = p.kind === "line" ? { x: p.x0, y: p.y0 } : arcPoint(p, 0);
      out.push({ x: start.x, y: start.y, sM: 0 });
    }
    if (p.kind === "line") {
      s += primLengthM(p);
      out.push({ x: p.x1, y: p.y1, sM: s });
      continue;
    }
    const n = arcSegmentCount(p.radiusM, p.sweepRad, maxSagittaM);
    const stepM = primLengthM(p) / n;
    for (let i = 1; i <= n; i++) {
      const q = arcPoint(p, i / n);
      out.push({ x: q.x, y: q.y, sM: s + stepM * i });
    }
    s += primLengthM(p);
  }
  return out;
}

/**
 * Points on a piece's centreline (on the arcs themselves, not their chords) no more than
 * `maxStepM` of arc length apart: each primitive split into equal steps, both ends of the
 * piece included, each join once. Render-side (the earthworks' neighbour bounds).
 */
export function sampleCentrelineEvery(piece: HasPrims, maxStepM: number): SamplePoint[] {
  if (!(maxStepM > 0) || !Number.isFinite(maxStepM)) throw new RangeError(`maxStepM must be > 0, got ${maxStepM}`);
  const out: SamplePoint[] = [];
  let s = 0;
  for (const p of piece.prims) {
    const len = primLengthM(p);
    const n = Math.max(1, Math.ceil(len / maxStepM));
    for (let i = out.length === 0 ? 0 : 1; i <= n; i++) {
      const f = i / n;
      const q = p.kind === "line" ? { x: p.x0 + (p.x1 - p.x0) * f, y: p.y0 + (p.y1 - p.y0) * f } : arcPoint(p, f);
      out.push({ x: q.x, y: q.y, sM: s + len * f });
    }
    s += len;
  }
  return out;
}

const TWO_PI = 2 * Math.PI;

/**
 * How far angle `angle` (rad, seen from the arc's centre) lies from the arc's start along its
 * sweep direction, wrapped into [0, 2π): the angle is on the arc when this is at most
 * |sweepRad|.
 */
export function sweepOffsetRad(p: ArcPrim, angle: number): number {
  let delta = (angle - p.startRad) * (p.sweepRad >= 0 ? 1 : -1);
  delta -= TWO_PI * Math.floor(delta / TWO_PI);
  return delta;
}

/**
 * A piece's centreline prepared for nearest-point queries (render-side, e.g. earthworks):
 * each primitive's arc length at its start, each arc's end points (sx, sy, ex, ey per
 * primitive; zeros for lines), the total length, and the plan box (lines' end points, arcs'
 * ends plus every axis extreme inside the sweep).
 */
export interface CentrelineIndex {
  readonly prims: readonly RenderPrim[];
  readonly primStartM: Float64Array;
  readonly arcEnds: Float64Array;
  readonly lengthM: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * A centreline's two ends as frames: (x, y, tx, ty) at arc length 0, then at the far end, where (tx, ty) is the
 * unit tangent pointing out of the piece (backwards at the start, forwards at the end). The earthworks use them to
 * stop a ground piece's cut and fill at the plane through an end where a bridge or a tunnel continues (D4
 * feel-check fixes, 2026-09-28). An arc's tangent is square to its radius.
 */
export function centrelineEnds(piece: HasPrims): Float64Array {
  const out = new Float64Array(8);
  const prims = piece.prims;
  const first = prims[0];
  const last = prims[prims.length - 1];
  if (!first || !last) return out;
  const frame = (p: RenderPrim, atEnd: boolean, k: number): void => {
    if (p.kind === "line") {
      const dx = p.x1 - p.x0;
      const dy = p.y1 - p.y0;
      const len = Math.hypot(dx, dy);
      const sign = atEnd ? 1 : -1;
      out[k] = atEnd ? p.x1 : p.x0;
      out[k + 1] = atEnd ? p.y1 : p.y0;
      out[k + 2] = len > 0 ? (sign * dx) / len : 0;
      out[k + 3] = len > 0 ? (sign * dy) / len : 0;
      return;
    }
    const a = atEnd ? p.startRad + p.sweepRad : p.startRad;
    const rx = Math.cos(a);
    const ry = Math.sin(a);
    out[k] = p.cx + p.radiusM * rx;
    out[k + 1] = p.cy + p.radiusM * ry;
    // Travel along a counter-clockwise sweep is (−ry, rx), along a clockwise one (ry, −rx); at the start, out of the
    // piece is against the travel.
    const along = (p.sweepRad >= 0 ? 1 : -1) * (atEnd ? 1 : -1);
    out[k + 2] = -ry * along;
    out[k + 3] = rx * along;
  };
  frame(first, false, 0);
  frame(last, true, 4);
  return out;
}

export function centrelineIndex(piece: HasPrims): CentrelineIndex {
  const prims = piece.prims;
  const primStartM = new Float64Array(prims.length);
  const arcEnds = new Float64Array(prims.length * 4);
  let length = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  prims.forEach((p, i) => {
    primStartM[i] = length;
    length += primLengthM(p);
    if (p.kind === "line") {
      grow(p.x0, p.y0);
      grow(p.x1, p.y1);
      return;
    }
    const a1 = p.startRad + p.sweepRad;
    arcEnds[4 * i] = p.cx + p.radiusM * Math.cos(p.startRad);
    arcEnds[4 * i + 1] = p.cy + p.radiusM * Math.sin(p.startRad);
    arcEnds[4 * i + 2] = p.cx + p.radiusM * Math.cos(a1);
    arcEnds[4 * i + 3] = p.cy + p.radiusM * Math.sin(a1);
    grow(arcEnds[4 * i] ?? 0, arcEnds[4 * i + 1] ?? 0);
    grow(arcEnds[4 * i + 2] ?? 0, arcEnds[4 * i + 3] ?? 0);
    for (let k = 0; k < 4; k++) {
      const angle = (k * Math.PI) / 2;
      if (sweepOffsetRad(p, angle) <= Math.abs(p.sweepRad)) grow(p.cx + p.radiusM * Math.cos(angle), p.cy + p.radiusM * Math.sin(angle));
    }
  });
  return { prims, primStartM, arcEnds, lengthM: length, minX, minY, maxX, maxY };
}

/**
 * The centreline point nearest plan (x, y), written to `out`: its plan distance `d` and its
 * arc length `s` from the start. Lines project and clamp; arcs clamp the angle, falling back
 * to the nearer end point outside the sweep. Allocation-free.
 */
export function nearestOnCentreline(
  c: Pick<CentrelineIndex, "prims" | "primStartM" | "arcEnds">,
  x: number,
  y: number,
  out: { d: number; s: number },
): { d: number; s: number } {
  let bestD2 = Infinity;
  let bestS = 0;
  const prims = c.prims;
  for (let i = 0; i < prims.length; i++) {
    const prim = prims[i];
    if (!prim) continue;
    const s0 = c.primStartM[i] ?? 0;
    if (prim.kind === "line") {
      const dx = prim.x1 - prim.x0;
      const dy = prim.y1 - prim.y0;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((x - prim.x0) * dx + (y - prim.y0) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = prim.x0 + dx * t - x;
      const ey = prim.y0 + dy * t - y;
      const d2 = ex * ex + ey * ey;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestS = s0 + t * Math.sqrt(len2);
      }
      continue;
    }
    const vx = x - prim.cx;
    const vy = y - prim.cy;
    const sweep = Math.abs(prim.sweepRad);
    const delta = sweepOffsetRad(prim, Math.atan2(vy, vx));
    if (delta <= sweep) {
      const d = Math.sqrt(vx * vx + vy * vy) - prim.radiusM;
      if (d * d < bestD2) {
        bestD2 = d * d;
        bestS = s0 + prim.radiusM * delta;
      }
      continue;
    }
    const sx = (c.arcEnds[4 * i] ?? 0) - x;
    const sy = (c.arcEnds[4 * i + 1] ?? 0) - y;
    const ex = (c.arcEnds[4 * i + 2] ?? 0) - x;
    const ey = (c.arcEnds[4 * i + 3] ?? 0) - y;
    const ds = sx * sx + sy * sy;
    const de = ex * ex + ey * ey;
    if (ds < bestD2) {
      bestD2 = ds;
      bestS = s0;
    }
    if (de < bestD2) {
      bestD2 = de;
      bestS = s0 + prim.radiusM * sweep;
    }
  }
  out.d = Math.sqrt(bestD2);
  out.s = bestS;
  return out;
}
