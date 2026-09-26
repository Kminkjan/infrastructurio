import type { ArcPrim, RenderPrim } from "./templates";

/**
 * Render-side sampling of piece geometry (simulation model §3). Pure and
 * float-based; the tick step never calls it. The one core consumer is
 * `clearance.ts`, whose float decision is taken at commit time only.
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
