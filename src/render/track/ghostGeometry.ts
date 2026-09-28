import { Color } from "three";
import { TRACK_RAIL_TOP_M, type TrackCentreline, type TrackFrame, sampleCentreline } from "./trackGeometry";

/**
 * Construction overlays as data (art direction "Overlays and construction
 * feedback"): flat ribbons along planned or highlighted pieces, dashed for an
 * invalid plan, and the drop lines and end-height tags of an elevated ghost.
 * Ribbons float just above the rail tops so a reused (cyan) piece shows over
 * the built track it matches.
 */

/** Ribbon half width: the sleeper length, so the ghost reads as a track. */
export const RIBBON_HALF_WIDTH_M = 1.3;
/** Height of the ribbon above the track height: 5 cm over the drawn rail tops (0.5 m with the 0.15 m lift). */
export const RIBBON_LIFT_M = TRACK_RAIL_TOP_M + 0.05;
/** Ghost sampling is coarser than the track's: 5 cm is invisible on a translucent ribbon. */
export const RIBBON_MAX_SAGITTA_M = 0.05;
/** Invalid ghosts are dashed: 3 m on, 2 m off along the plan. */
export const DASH_ON_M = 3;
export const DASH_OFF_M = 2;
/** Drop lines every 20 m of plan length, where the ghost is this far above the terrain. */
export const DROP_LINE_EVERY_M = 20;
export const ELEVATED_ABOVE_M = 0.5;

export interface RibbonPiece {
  readonly centreline: TrackCentreline;
  /** A palette value. */
  readonly color: number;
  /** Half width of this ribbon (default RIBBON_HALF_WIDTH_M). */
  readonly halfWidthM?: number;
  /** Lateral offset of its centre, metres to the right of travel (default 0): a band beside the track. */
  readonly offsetM?: number;
  /** Height above the track height (default RIBBON_LIFT_M). */
  readonly liftM?: number;
  /** Its own dash pattern (on, off metres along the piece), whatever `buildRibbons`' `dashed` says. */
  readonly dash?: readonly [number, number];
}

export interface RibbonData {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
}

/** The "on" intervals of a dash pattern over [0, lengthM], starting with a dash. */
export function dashIntervals(lengthM: number, on = DASH_ON_M, off = DASH_OFF_M): [number, number][] {
  const out: [number, number][] = [];
  for (let s = 0; s < lengthM; s += on + off) out.push([s, Math.min(lengthM, s + on)]);
  return out;
}

function lerpFrame(a: TrackFrame, b: TrackFrame, s: number): TrackFrame {
  const span = b.sM - a.sM;
  const f = span > 0 ? (s - a.sM) / span : 0;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, sM: s, tx: a.tx, ty: a.ty };
}

/** Frames clipped to arc lengths [from, to], with interpolated frames at both cuts. */
export function clipFrames(frames: readonly TrackFrame[], from: number, to: number): TrackFrame[] {
  const out: TrackFrame[] = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (!a || !b || b.sM < from || a.sM > to) continue;
    if (out.length === 0) out.push(a.sM >= from ? a : lerpFrame(a, b, from));
    out.push(b.sM <= to ? b : lerpFrame(a, b, to));
  }
  return out;
}

const scratch = new Color();

/**
 * Ribbons for the pieces, in order. With `dashed`, the dash pattern runs
 * along the whole plan (arc length carried across pieces), so it flows
 * through the joins. World space via (x, z, −y), as `coords.ts` maps it.
 */
export function buildRibbons(pieces: readonly RibbonPiece[], dashed: boolean): RibbonData {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let count = 0;
  let offset = 0;
  const strip = (frames: readonly TrackFrame[], half: number, shift: number, lift: number): void => {
    let prev = -1;
    for (const f of frames) {
      const lx = -f.ty;
      const ly = f.tx;
      const z = f.z + lift;
      // The band's centre sits `shift` to the right of travel, that is −shift along the left normal.
      const cx = f.x - lx * shift;
      const cy = f.y - ly * shift;
      pos.push(cx + lx * half, z, -(cy + ly * half));
      pos.push(cx - lx * half, z, -(cy - ly * half));
      for (let k = 0; k < 2; k++) col.push(scratch.r, scratch.g, scratch.b);
      const left = count;
      count += 2;
      // Left edge to right edge, then forward: the ribbon faces up (checked in tests).
      if (prev >= 0) idx.push(prev, prev + 1, left + 1, prev, left + 1, left);
      prev = left;
    }
  };
  for (const piece of pieces) {
    scratch.setHex(piece.color);
    const half = piece.halfWidthM ?? RIBBON_HALF_WIDTH_M;
    const shift = piece.offsetM ?? 0;
    const lift = piece.liftM ?? RIBBON_LIFT_M;
    const frames = sampleCentreline(piece.centreline, RIBBON_MAX_SAGITTA_M);
    const length = frames[frames.length - 1]?.sM ?? 0;
    if (piece.dash) {
      const [on, off] = piece.dash;
      for (const [from, to] of dashIntervals(length, on, off)) strip(clipFrames(frames, from, to), half, shift, lift);
    } else if (!dashed) strip(frames, half, shift, lift);
    else {
      const period = DASH_ON_M + DASH_OFF_M;
      const first = Math.floor(offset / period) * period;
      for (let s = first; s < offset + length; s += period) {
        const from = Math.max(s, offset) - offset;
        const to = Math.min(s + DASH_ON_M, offset + length) - offset;
        if (to > from) strip(clipFrames(frames, from, to), half, shift, lift);
      }
    }
    offset += length;
  }
  return { positions: new Float32Array(pos), colors: new Float32Array(col), indices: new Uint32Array(idx), vertexCount: count };
}

export interface ElevationMarks {
  /** World-space segment pairs from the ghost down to the terrain. */
  readonly dropLines: Float32Array;
  /** The plan's two ends: sim position (m) and height above the terrain (m). */
  readonly ends: readonly { readonly x: number; readonly y: number; readonly z: number; readonly aboveM: number }[];
  /** True when any station stands more than 0.5 m above the terrain. */
  readonly elevated: boolean;
}

/**
 * Drop lines every 20 m of plan length (and at the end), wherever the ghost
 * is more than 0.5 m above the terrain, plus both ends' heights above the
 * terrain for the end-height tags. `groundM` samples the terrain in sim
 * metres; off the map it returns undefined and no line is drawn.
 */
export function elevationMarks(
  pieces: readonly TrackCentreline[],
  groundM: (x: number, y: number) => number | undefined,
): ElevationMarks {
  const lines: number[] = [];
  const ends: { x: number; y: number; z: number; aboveM: number }[] = [];
  let elevated = false;
  let offset = 0;
  let next = 0;
  let lastFrame: TrackFrame | undefined;
  const mark = (f: TrackFrame): void => {
    const ground = groundM(f.x, f.y);
    if (ground === undefined) return;
    const above = f.z - ground;
    if (above > ELEVATED_ABOVE_M) {
      elevated = true;
      lines.push(f.x, f.z + RIBBON_LIFT_M, -f.y, f.x, ground, -f.y);
    }
  };
  for (const c of pieces) {
    const frames = sampleCentreline(c, RIBBON_MAX_SAGITTA_M);
    const length = frames[frames.length - 1]?.sM ?? 0;
    while (next <= offset + length) {
      const at = clipFrames(frames, next - offset, next - offset)[0] ?? frames[0];
      if (at) mark(at);
      next += DROP_LINE_EVERY_M;
    }
    const first = frames[0];
    if (first && ends.length === 0) ends.push(endOf(first, groundM));
    lastFrame = frames[frames.length - 1] ?? lastFrame;
    offset += length;
  }
  if (lastFrame) {
    // The end gets a line too, unless a 20 m station just drew one there.
    if (next - DROP_LINE_EVERY_M < offset - 1e-6) mark(lastFrame);
    ends.push(endOf(lastFrame, groundM));
  }
  return { dropLines: new Float32Array(lines), ends, elevated };
}

function endOf(f: TrackFrame, groundM: (x: number, y: number) => number | undefined): { x: number; y: number; z: number; aboveM: number } {
  const ground = groundM(f.x, f.y);
  return { x: f.x, y: f.y, z: f.z, aboveM: ground === undefined ? 0 : f.z - ground };
}

/** An end-height tag: "+6 m", "−2.5 m", "0 m" (0.1 m resolution). */
export function heightTagText(aboveM: number): string {
  const tenths = Math.round(aboveM * 10);
  if (tenths === 0) return "0 m";
  const abs = Math.abs(tenths);
  return `${tenths > 0 ? "+" : "−"}${abs % 10 === 0 ? String(abs / 10) : (abs / 10).toFixed(1)} m`;
}
