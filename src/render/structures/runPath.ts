import { samplePiece } from "../../core/geometry/sample";
import type { RenderPrim } from "../../core/sim/api";
import type { RunPiece } from "./runs";

/**
 * A run's centreline as one path in travel order (sim metres): points every
 * chord of at most PATH_SAGITTA_M along the pieces' analytic lines and arcs
 * (sampled through `geometry/sample.ts`, the single source of curve maths),
 * heights linear in each piece's own arc length, as the track meshes draw
 * them, and unit plan tangents (exact at the ends, central differences inside).
 *
 * Structures are generated in a run frame: `s` metres along the path, `right`
 * metres to the right of travel, `up` metres above the track height. `toSim`
 * maps that frame to sim space; beyond either end it extends straight along
 * the end tangent and grade, so parts that overhang a run's end (an abutment's
 * back, a portal's wings) stay attached.
 */

/** Chord bound for the path: 5 cm, so a 3 m offset (the deck edge) stays within a few cm of the true offset curve. */
export const PATH_SAGITTA_M = 0.05;

export interface PathPoint {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
}

/** Nearest point on the path: arc length and signed lateral offset (right positive). */
export interface PathNearest {
  s: number;
  d: number;
}

/** A prim run the other way: lines swap their ends, arcs start at their far end and sweep back. */
export function reversePrim(p: RenderPrim): RenderPrim {
  if (p.kind === "line") return { kind: "line", x0: p.x1, y0: p.y1, x1: p.x0, y1: p.y0 };
  return { ...p, startRad: p.startRad + p.sweepRad, sweepRad: -p.sweepRad };
}

function primTangent(p: RenderPrim, atEnd: boolean): { x: number; y: number } {
  if (p.kind === "line") {
    const len = Math.hypot(p.x1 - p.x0, p.y1 - p.y0) || 1;
    return { x: (p.x1 - p.x0) / len, y: (p.y1 - p.y0) / len };
  }
  const a = atEnd ? p.startRad + p.sweepRad : p.startRad;
  const sign = p.sweepRad >= 0 ? 1 : -1;
  return { x: -Math.sin(a) * sign, y: Math.cos(a) * sign };
}

export class RunPath {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly zs: Float64Array;
  readonly ss: Float64Array;
  readonly txs: Float64Array;
  readonly tys: Float64Array;
  readonly lengthM: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;

  private constructor(points: readonly { x: number; y: number; z: number; s: number }[], startTangent: { x: number; y: number }, endTangent: { x: number; y: number }) {
    const n = points.length;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.zs = new Float64Array(n);
    this.ss = new Float64Array(n);
    this.txs = new Float64Array(n);
    this.tys = new Float64Array(n);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    points.forEach((p, i) => {
      this.xs[i] = p.x;
      this.ys[i] = p.y;
      this.zs[i] = p.z;
      this.ss[i] = p.s;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    for (let i = 0; i < n; i++) {
      let tx: number;
      let ty: number;
      if (i === 0) ({ x: tx, y: ty } = startTangent);
      else if (i === n - 1) ({ x: tx, y: ty } = endTangent);
      else {
        tx = (this.xs[i + 1] ?? 0) - (this.xs[i - 1] ?? 0);
        ty = (this.ys[i + 1] ?? 0) - (this.ys[i - 1] ?? 0);
        const l = Math.hypot(tx, ty) || 1;
        tx /= l;
        ty /= l;
      }
      this.txs[i] = tx;
      this.tys[i] = ty;
    }
    this.lengthM = this.ss[n - 1] ?? 0;
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }

  /** The path of a run's pieces in travel order. */
  static ofRun(pieces: readonly RunPiece[]): RunPath {
    const points: { x: number; y: number; z: number; s: number }[] = [];
    let offset = 0;
    let startTangent = { x: 1, y: 0 };
    let endTangent = { x: 1, y: 0 };
    pieces.forEach((rp, index) => {
      const p = rp.piece;
      const prims = rp.forward ? p.prims : [...p.prims].reverse().map(reversePrim);
      const z0 = (rp.forward ? p.z0Mm : p.z1Mm) / 1000;
      const z1 = (rp.forward ? p.z1Mm : p.z0Mm) / 1000;
      const samples = samplePiece({ prims }, PATH_SAGITTA_M);
      const length = samples[samples.length - 1]?.sM ?? 0;
      samples.forEach((q, k) => {
        if (k === 0 && points.length > 0) return;
        const f = length > 0 ? q.sM / length : 0;
        points.push({ x: q.x, y: q.y, z: z0 + (z1 - z0) * f, s: offset + q.sM });
      });
      const first = prims[0];
      const last = prims[prims.length - 1];
      if (index === 0 && first) startTangent = primTangent(first, false);
      if (last) endTangent = primTangent(last, true);
      offset += length;
    });
    return new RunPath(points, startTangent, endTangent);
  }

  /**
   * The point at arc length `s`: interpolated between samples, the tangent a
   * normalised blend of theirs; beyond the ends, straight along the end tangent
   * and grade.
   */
  at(s: number, out: PathPoint): PathPoint {
    const n = this.ss.length;
    if (n === 0) {
      out.x = 0;
      out.y = 0;
      out.z = 0;
      out.tx = 1;
      out.ty = 0;
      return out;
    }
    if (n === 1 || s <= 0 || s >= this.lengthM) {
      // The end sample, and the grade of the end chord (a, b in travel order).
      const i = n === 1 || s <= 0 ? 0 : n - 1;
      const a = i === 0 ? 0 : Math.max(0, n - 2);
      const b = i === 0 ? Math.min(1, n - 1) : n - 1;
      const tx = this.txs[i] ?? 1;
      const ty = this.tys[i] ?? 0;
      const ds = s - (this.ss[i] ?? 0);
      const span = (this.ss[b] ?? 0) - (this.ss[a] ?? 0);
      const grade = span > 0 ? ((this.zs[b] ?? 0) - (this.zs[a] ?? 0)) / span : 0;
      out.x = (this.xs[i] ?? 0) + tx * ds;
      out.y = (this.ys[i] ?? 0) + ty * ds;
      out.z = (this.zs[i] ?? 0) + grade * ds;
      out.tx = tx;
      out.ty = ty;
      return out;
    }
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((this.ss[mid] ?? 0) <= s) lo = mid;
      else hi = mid;
    }
    const s0 = this.ss[lo] ?? 0;
    const s1 = this.ss[hi] ?? 0;
    const f = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    out.x = (this.xs[lo] ?? 0) + ((this.xs[hi] ?? 0) - (this.xs[lo] ?? 0)) * f;
    out.y = (this.ys[lo] ?? 0) + ((this.ys[hi] ?? 0) - (this.ys[lo] ?? 0)) * f;
    out.z = (this.zs[lo] ?? 0) + ((this.zs[hi] ?? 0) - (this.zs[lo] ?? 0)) * f;
    const tx = (this.txs[lo] ?? 1) * (1 - f) + (this.txs[hi] ?? 1) * f;
    const ty = (this.tys[lo] ?? 0) * (1 - f) + (this.tys[hi] ?? 0) * f;
    const l = Math.hypot(tx, ty) || 1;
    out.tx = tx / l;
    out.ty = ty / l;
    return out;
  }

  /** Sim position of run-frame point (s, right, up), written to `out` (x, y, z). */
  toSim(s: number, right: number, up: number, out: { x: number; y: number; z: number }, scratch: PathPoint = SCRATCH): { x: number; y: number; z: number } {
    const p = this.at(s, scratch);
    // Right of travel is the tangent turned clockwise: (ty, −tx).
    out.x = p.x + p.ty * right;
    out.y = p.y - p.tx * right;
    out.z = p.z + up;
    return out;
  }

  /** The path point nearest plan (x, y): its arc length and signed lateral offset (right positive), within the path's extent. */
  nearest(x: number, y: number, out: PathNearest): PathNearest {
    let best = Infinity;
    let bestS = 0;
    let bestD = 0;
    const n = this.ss.length;
    for (let i = 0; i + 1 < n; i++) {
      const ax = this.xs[i] ?? 0;
      const ay = this.ys[i] ?? 0;
      const dx = (this.xs[i + 1] ?? 0) - ax;
      const dy = (this.ys[i + 1] ?? 0) - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t - x;
      const py = ay + dy * t - y;
      const d2 = px * px + py * py;
      if (d2 < best) {
        best = d2;
        const s0 = this.ss[i] ?? 0;
        bestS = s0 + ((this.ss[i + 1] ?? 0) - s0) * t;
        const len = Math.sqrt(len2) || 1;
        // Signed: positive to the right of travel (dy, −dx).
        bestD = ((x - ax) * dy - (y - ay) * dx) / len;
      }
    }
    if (n === 1) {
      bestS = 0;
      bestD = Math.hypot(x - (this.xs[0] ?? 0), y - (this.ys[0] ?? 0));
    }
    out.s = bestS;
    out.d = bestD;
    return out;
  }
}

const SCRATCH: PathPoint = { x: 0, y: 0, z: 0, tx: 1, ty: 0 };
