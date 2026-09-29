import { Color } from "three";
import { samplePiece } from "../../core/geometry/sample";
import type { RenderPrim } from "../../core/sim/api";
import { palette } from "../art/palette";

/**
 * Track geometry (art direction "Track", issue #67 "Presentation"), pure
 * data builders over a piece's centreline: the analytic lines and arcs of
 * its render prims, sampled through `core/geometry/sample.ts` (the single
 * source of curve maths) at Δθ = min(2·acos(1 − 0.02/r), 5°), a chord error
 * of at most 2 cm.
 *
 * Cross-sections, in metres across (u, positive to the left of travel) and
 * up (v) from the track height:
 * - ballast: the trapezoid (−2.2, −0.35) (−1.6, 0) (1.6, 0) (2.2, −0.35), light
 *   top and darker shoulders, with the centre band marked for the far-LOD
 *   stripe;
 * - sleepers: 2.6 × 0.14 × 0.24 m boxes every 0.9 m (evenly spread per piece);
 * - rails: 0.11 × 0.16 m at u = ±0.817 m, on the sleepers.
 *
 * Everything sits `TRACK_LIFT_M` above the track height, render-only (sim
 * heights never change), so the ballast top never z-fights terrain it lies on
 * and the rails stay visible where the terrain bulges between nodes (see the
 * constant). Colours come from the
 * palette through `THREE.Color` (linear). Positions and normals are written
 * in three's world space through the same mapping as `coords.ts`
 * (x, z, −y), inlined in `pushVertex` so the builders allocate no vectors.
 */

/** Chord error bound for arcs, metres. */
export const TRACK_MAX_SAGITTA_M = 0.02;
/** Largest angle one chord may span, radians (5°). */
export const TRACK_MAX_CHORD_RAD = (5 * Math.PI) / 180;
/**
 * Render-only lift of the whole track above its height, metres. Track follows
 * the ground at its nodes (D3), but between nodes the lattice-triangle terrain
 * can rise above a piece's straight height line, most across the slope at the
 * rails and ballast edges. 0.15 m was chosen from a 2026-09-27 measurement of
 * 3,000 ground-level plans on the diorama map (`trackLift.test.ts`; ADR 0010,
 * D3 ground-following finding): on straights it leaves 0.007% (primary) and 0.055% (secondary) of
 * rail-top samples under the terrain, against 0.27% and 0.26% at the former
 * 0.05 m, while the 0.35 m deep ballast still meets flat ground with its
 * shoulders 0.2 m below the surface. Long curves and shifts, whose interiors
 * the planner cannot shape, stay outside what a lift can fix.
 */
export const TRACK_LIFT_M = 0.15;

export const BALLAST_TOP_HALF_M = 1.6;
export const BALLAST_BASE_HALF_M = 2.2;
export const BALLAST_DEPTH_M = 0.35;
/** Half width of the centre band the far-LOD stripe darkens (covers both rails). */
export const BALLAST_STRIPE_HALF_M = 0.85;

export const SLEEPER_LENGTH_M = 2.6;
export const SLEEPER_HEIGHT_M = 0.14;
export const SLEEPER_WIDTH_M = 0.24;
export const SLEEPER_PITCH_M = 0.9;

export const RAIL_WIDTH_M = 0.11;
export const RAIL_HEIGHT_M = 0.16;
export const RAIL_OFFSET_M = 0.817;

/** Where the rail tops are drawn above the track height, lift included (0.45 m): overlays and picking key off it. */
export const TRACK_RAIL_TOP_M = TRACK_LIFT_M + SLEEPER_HEIGHT_M + RAIL_HEIGHT_M;

/** A piece's centreline: prims in sim plan metres (from → to) and the end heights. */
export interface TrackCentreline {
  readonly prims: readonly RenderPrim[];
  readonly z0M: number;
  readonly z1M: number;
}

/** One sample along the centreline: sim position (metres), arc length and unit plan tangent. */
export interface TrackFrame {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly sM: number;
  readonly tx: number;
  readonly ty: number;
}

/** Plain arrays for one layer of one piece, world space, indexed triangles. */
export interface TrackMeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  /** Ballast only: 1 on the centre band the far-LOD stripe darkens, else 0. */
  readonly stripe: Float32Array | null;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly indexCount: number;
  /** Sim plan position of the piece's start, for spatial chunking. */
  readonly anchorX: number;
  readonly anchorY: number;
}

export interface TrackPieceMeshes {
  readonly ballast: TrackMeshData;
  readonly sleepers: TrackMeshData;
  readonly rails: TrackMeshData;
}

/**
 * The sagitta bound that gives Δθ = min(2·acos(1 − 0.02/r), 5°) for the
 * piece's arcs: a chord over angle φ bulges r(1 − cos(φ/2)), so capping the
 * sagitta at r(1 − cos 2.5°) also caps each chord at 5°. A piece has at most
 * one radius (a curve, or a shift's two equal arcs), and the smallest wins.
 */
export function trackSagittaM(prims: readonly RenderPrim[], maxSagittaM = TRACK_MAX_SAGITTA_M): number {
  let bound = maxSagittaM;
  for (const p of prims) {
    if (p.kind === "arc") bound = Math.min(bound, p.radiusM * (1 - Math.cos(TRACK_MAX_CHORD_RAD / 2)));
  }
  return bound;
}

/** Unit plan tangent at the start (`atEnd` false) or end of a prim. */
function primTangent(p: RenderPrim, atEnd: boolean): { x: number; y: number } {
  if (p.kind === "line") {
    const len = Math.hypot(p.x1 - p.x0, p.y1 - p.y0) || 1;
    return { x: (p.x1 - p.x0) / len, y: (p.y1 - p.y0) / len };
  }
  const a = atEnd ? p.startRad + p.sweepRad : p.startRad;
  const s = p.sweepRad >= 0 ? 1 : -1;
  return { x: -Math.sin(a) * s, y: Math.cos(a) * s };
}

/**
 * Samples a centreline into frames: sample.ts points, heights linear in arc
 * length (a piece's grade is uniform), exact tangents at both ends (lattice
 * headings, so neighbouring pieces meet flush) and mitred tangents between.
 */
export function sampleCentreline(c: TrackCentreline, maxSagittaM = trackSagittaM(c.prims)): TrackFrame[] {
  const first = c.prims[0];
  const lastPrim = c.prims[c.prims.length - 1];
  if (!first || !lastPrim) return [];
  const points = samplePiece(c, maxSagittaM);
  const length = points[points.length - 1]?.sM ?? 0;
  const frames: TrackFrame[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    let t: { x: number; y: number };
    if (i === 0) t = primTangent(first, false);
    else if (i === points.length - 1) t = primTangent(lastPrim, true);
    else {
      const a = points[i - 1];
      const b = points[i + 1];
      if (!a || !b) continue;
      const la = Math.hypot(p.x - a.x, p.y - a.y) || 1;
      const lb = Math.hypot(b.x - p.x, b.y - p.y) || 1;
      const x = (p.x - a.x) / la + (b.x - p.x) / lb;
      const y = (p.y - a.y) / la + (b.y - p.y) / lb;
      const l = Math.hypot(x, y) || 1;
      t = { x: x / l, y: y / l };
    }
    const f = length > 0 ? p.sM / length : 0;
    frames.push({ x: p.x, y: p.y, z: c.z0M + (c.z1M - c.z0M) * f, sM: p.sM, tx: t.x, ty: t.y });
  }
  return frames;
}

/** Growable indexed mesh arrays. */
class Builder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly str: number[] | null;
  private readonly idx: number[] = [];
  private count = 0;

  constructor(withStripe: boolean) {
    this.str = withStripe ? [] : null;
  }

  /** Adds a vertex given in sim space (x east, y north, z up); stores world (x, z, −y). */
  pushVertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, color: Color, stripe = 0): number {
    this.pos.push(x, z, -y);
    this.nor.push(nx, nz, -ny);
    this.col.push(color.r, color.g, color.b);
    this.str?.push(stripe);
    return this.count++;
  }

  triangle(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  build(anchorX: number, anchorY: number): TrackMeshData {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      colors: new Float32Array(this.col),
      stripe: this.str ? new Float32Array(this.str) : null,
      indices: new Uint32Array(this.idx),
      vertexCount: this.count,
      indexCount: this.idx.length,
      anchorX,
      anchorY,
    };
  }
}

/** A cross-section corner: across (u, left positive), up (v), and whether it lies on the stripe band. */
interface ProfilePoint {
  readonly u: number;
  readonly v: number;
}

/**
 * Sweeps a cross-section polyline along the frames. The profile runs from
 * left to right (u decreasing); each segment becomes a flat-normal strip
 * whose normal (Δv, −Δu) points out of the section, and triangles are wound
 * (a, b, c), (a, c, d) so they face along that normal (checked in tests).
 */
function sweep(
  b: Builder,
  frames: readonly TrackFrame[],
  profile: readonly ProfilePoint[],
  colorOf: (segment: number) => Color,
  stripeOf: (segment: number) => number = () => 0,
): void {
  for (let k = 0; k + 1 < profile.length; k++) {
    const p0 = profile[k];
    const p1 = profile[k + 1];
    if (!p0 || !p1) continue;
    const du = p1.u - p0.u;
    const dv = p1.v - p0.v;
    const len = Math.hypot(du, dv) || 1;
    const nu = dv / len;
    const nv = -du / len;
    const color = colorOf(k);
    const stripe = stripeOf(k);
    let prev0 = -1;
    let prev1 = -1;
    for (const f of frames) {
      const lx = -f.ty;
      const ly = f.tx;
      const nx = lx * nu;
      const ny = ly * nu;
      const i0 = b.pushVertex(f.x + lx * p0.u, f.y + ly * p0.u, f.z + p0.v + TRACK_LIFT_M, nx, ny, nv, color, stripe);
      const i1 = b.pushVertex(f.x + lx * p1.u, f.y + ly * p1.u, f.z + p1.v + TRACK_LIFT_M, nx, ny, nv, color, stripe);
      if (prev0 >= 0) {
        b.triangle(prev0, prev1, i1);
        b.triangle(prev0, i1, i0);
      }
      prev0 = i0;
      prev1 = i1;
    }
  }
}

const BALLAST_PROFILE: readonly ProfilePoint[] = [
  { u: BALLAST_BASE_HALF_M, v: -BALLAST_DEPTH_M },
  { u: BALLAST_TOP_HALF_M, v: 0 },
  { u: BALLAST_STRIPE_HALF_M, v: 0 },
  { u: -BALLAST_STRIPE_HALF_M, v: 0 },
  { u: -BALLAST_TOP_HALF_M, v: 0 },
  { u: -BALLAST_BASE_HALF_M, v: -BALLAST_DEPTH_M },
];

/**
 * Ballast skirts (issue #68, "Earthworks conform … with ballast skirts"): on ground track the
 * shoulders run on at their own slope, 1.2 times as far again, to 2.92 m out and 0.62 m under the
 * track height. That is still inside the earthworks' flat 3 m formation, so where the drawn ground
 * is the bed the skirt lies under it and nothing changes; where the drawn ground falls away from
 * the ballast's edge (with `?earthworks=0`, on the natural leave-alone band, on the coarser far
 * LOD, at a structure's end) the skirt closes the gap under the edge. Bridges carry their ballast
 * in a deck and tunnels are not drawn, so neither gets one.
 */
export const SKIRT_RUN = 1.2;
export const SKIRT_HALF_M = BALLAST_BASE_HALF_M + SKIRT_RUN * (BALLAST_BASE_HALF_M - BALLAST_TOP_HALF_M);
export const SKIRT_DEPTH_M = BALLAST_DEPTH_M * (1 + SKIRT_RUN);

const SKIRTED_PROFILE: readonly ProfilePoint[] = [
  { u: SKIRT_HALF_M, v: -SKIRT_DEPTH_M },
  ...BALLAST_PROFILE,
  { u: -SKIRT_HALF_M, v: -SKIRT_DEPTH_M },
];

function railProfile(centre: number): ProfilePoint[] {
  const half = RAIL_WIDTH_M / 2;
  const base = SLEEPER_HEIGHT_M;
  const top = SLEEPER_HEIGHT_M + RAIL_HEIGHT_M;
  return [
    { u: centre + half, v: base },
    { u: centre + half, v: top },
    { u: centre - half, v: top },
    { u: centre - half, v: base },
  ];
}

const RAIL_PROFILES = [railProfile(RAIL_OFFSET_M), railProfile(-RAIL_OFFSET_M)] as const;

/** Sleeper centres along a piece of `lengthM`: round(L / 0.9) of them, evenly spread, at least one. */
export function sleeperStations(lengthM: number): number[] {
  if (!(lengthM > 0)) return [];
  const n = Math.max(1, Math.round(lengthM / SLEEPER_PITCH_M));
  const pitch = lengthM / n;
  return Array.from({ length: n }, (_, j) => (j + 0.5) * pitch);
}

/** Position and chord tangent at arc length `s` along the frames. */
function frameAt(frames: readonly TrackFrame[], s: number): { x: number; y: number; z: number; tx: number; ty: number } {
  let i = 1;
  while (i < frames.length - 1 && (frames[i]?.sM ?? 0) < s) i++;
  const a = frames[i - 1] ?? frames[0];
  const b = frames[i] ?? a;
  if (!a || !b) return { x: 0, y: 0, z: 0, tx: 1, ty: 0 };
  const span = b.sM - a.sM;
  const f = span > 0 ? Math.min(1, Math.max(0, (s - a.sM) / span)) : 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return {
    x: a.x + dx * f,
    y: a.y + dy * f,
    z: a.z + (b.z - a.z) * f,
    tx: len > 0 ? dx / len : a.tx,
    ty: len > 0 ? dy / len : a.ty,
  };
}

/** One box face as two triangles, wound so its normal (nx, ny, nz) faces out. Corners go counter-clockwise seen from outside. */
function boxFace(b: Builder, corners: readonly (readonly [number, number, number])[], n: readonly [number, number, number], color: Color): void {
  const ids = corners.map(([x, y, z]) => b.pushVertex(x, y, z, n[0], n[1], n[2], color));
  const [a, c1, c2, c3] = ids;
  if (a === undefined || c1 === undefined || c2 === undefined || c3 === undefined) return;
  b.triangle(a, c1, c2);
  b.triangle(a, c2, c3);
}

function pushSleeper(b: Builder, at: { x: number; y: number; z: number; tx: number; ty: number }, color: Color): void {
  const tx = at.tx;
  const ty = at.ty;
  const lx = -ty;
  const ly = tx;
  const hu = SLEEPER_LENGTH_M / 2;
  const hw = SLEEPER_WIDTH_M / 2;
  const z0 = at.z + TRACK_LIFT_M;
  const z1 = z0 + SLEEPER_HEIGHT_M;
  // Corner in sim space from (w along the tangent, u to the left, z).
  const p = (w: number, u: number, z: number): [number, number, number] => [at.x + tx * w + lx * u, at.y + ty * w + ly * u, z];
  // Outward normals: tangent (t), left (l), up.
  const t: [number, number, number] = [tx, ty, 0];
  const tBack: [number, number, number] = [-tx, -ty, 0];
  const l: [number, number, number] = [lx, ly, 0];
  const lRight: [number, number, number] = [-lx, -ly, 0];
  const up: [number, number, number] = [0, 0, 1];
  // Counter-clockwise seen from outside, in the right-handed (t, l, up) frame.
  boxFace(b, [p(-hw, -hu, z1), p(hw, -hu, z1), p(hw, hu, z1), p(-hw, hu, z1)], up, color);
  boxFace(b, [p(hw, -hu, z0), p(hw, hu, z0), p(hw, hu, z1), p(hw, -hu, z1)], t, color);
  boxFace(b, [p(-hw, hu, z0), p(-hw, -hu, z0), p(-hw, -hu, z1), p(-hw, hu, z1)], tBack, color);
  boxFace(b, [p(hw, hu, z0), p(-hw, hu, z0), p(-hw, hu, z1), p(hw, hu, z1)], l, color);
  boxFace(b, [p(-hw, -hu, z0), p(hw, -hu, z0), p(hw, -hu, z1), p(-hw, -hu, z1)], lRight, color);
}

const cBallast = new Color();
const cShoulder = new Color();
const cSleeper = new Color();
const cRailTop = new Color();
const cRailSide = new Color();

/** Ballast (with skirts when asked: ground track), sleepers and rails for one piece. */
export function buildTrackMeshes(c: TrackCentreline, options: { readonly skirts?: boolean } = {}): TrackPieceMeshes {
  const frames = sampleCentreline(c);
  const start = frames[0];
  const ax = start?.x ?? 0;
  const ay = start?.y ?? 0;
  cBallast.setHex(palette.ballast);
  cShoulder.setHex(palette.ballastShoulder);
  cSleeper.setHex(palette.sleeper);
  cRailTop.setHex(palette.railTop);
  cRailSide.setHex(palette.railSide);

  const ballast = new Builder(true);
  const profile = options.skirts ? SKIRTED_PROFILE : BALLAST_PROFILE;
  const skirt = options.skirts ? 1 : 0;
  const last = profile.length - 2;
  sweep(
    ballast,
    frames,
    profile,
    (k) => (k <= skirt || k >= last - skirt ? cShoulder : cBallast),
    (k) => (k === 2 + skirt ? 1 : 0),
  );

  const sleepers = new Builder(false);
  const length = frames[frames.length - 1]?.sM ?? 0;
  for (const s of sleeperStations(length)) pushSleeper(sleepers, frameAt(frames, s), cSleeper);

  const rails = new Builder(false);
  for (const profile of RAIL_PROFILES) sweep(rails, frames, profile, (k) => (k === 1 ? cRailTop : cRailSide));

  return { ballast: ballast.build(ax, ay), sleepers: sleepers.build(ax, ay), rails: rails.build(ax, ay) };
}
