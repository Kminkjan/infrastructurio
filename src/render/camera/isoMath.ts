import type { Vector3 } from "three";
import { simToWorld } from "../coords";

/**
 * Pure isometric camera maths (ADR 0009, docs/architecture.md "Camera").
 *
 * Everything here is in three's world space (Y-up metres, X east, Z south).
 * The camera orbits a target on the Y = 0 datum at a fixed distance and looks
 * at it through an orthographic projection, so a screen pixel always covers
 * 1/ppm metres of the camera plane whatever the terrain height. That makes
 * every mapping below linear, which is what lets zoom-to-cursor and panning
 * be exact instead of iterative.
 *
 * Hot-path functions take an optional `out` so the frame loop can call them
 * without allocating.
 */

/** True isometric pitch, 35.264°. The one constant the look gate A/Bs against 30°. */
export const ISO_PITCH_RAD = Math.atan(1 / Math.SQRT2);
export const CAMERA_DISTANCE_M = 2000;
export const CAMERA_NEAR = 10;
export const CAMERA_FAR = 4000;
export const PPM_MIN = 0.75;
export const PPM_MAX = 24;
export const NAMED_ZOOMS = { far: 0.9, region: 2.5, default: 6, close: 12, detail: 22 } as const;
export const WHEEL_ZOOM_FACTOR = 1.15;
/** Yaw comes in six 60° steps so lattice headings stay screen-aligned at rest. */
export const YAW_STEPS = 6;
export const YAW_STEP_RAD = Math.PI / 3;
/** How far the target may leave the map, in metres. */
export const TARGET_MARGIN_M = 100;
/** LOD band edges in ppm: far below 2, mid 2–5, near above 5 (architecture "Camera"). */
export const LOD_MID_FROM_PPM = 2;
export const LOD_NEAR_ABOVE_PPM = 5;

const NAMED_ZOOM_LEVELS: readonly number[] = Object.values(NAMED_ZOOMS).sort((a, b) => a - b);
/** Relative tolerance so a ppm sitting on a named level counts as that level. */
const NAMED_ZOOM_EPSILON = 1e-6;

export interface Xyz {
  x: number;
  y: number;
  z: number;
}

/** A point on the Y = 0 datum. */
export interface GroundPoint {
  x: number;
  z: number;
}

/** World-space XZ rectangle, e.g. the map's extent. */
export interface GroundBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Everything the projection depends on. `IsoCamera` satisfies it structurally. */
export interface IsoView {
  readonly target: Readonly<GroundPoint>;
  readonly ppm: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
}

/** Orthonormal camera axes in world space: screen right, screen up, toward the camera. */
export interface CameraBasis {
  readonly right: Xyz;
  readonly up: Xyz;
  readonly back: Xyz;
}

export type LodBand = "far" | "mid" | "near";

export function normalizeYawStep(k: number): number {
  if (!Number.isInteger(k)) throw new RangeError(`yaw step must be an integer, got ${k}`);
  return ((k % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;
}

/** k·60° in radians, with k normalized to 0..5. */
export function yawForStep(k: number): number {
  return normalizeYawStep(k) * YAW_STEP_RAD;
}

/** Camera position relative to its target: D·(sin(yaw)·cos p, sin p, cos(yaw)·cos p). */
export function cameraOffset(
  yaw: number,
  pitch: number = ISO_PITCH_RAD,
  distance: number = CAMERA_DISTANCE_M,
  out: Xyz = { x: 0, y: 0, z: 0 },
): Xyz {
  const cosPitch = Math.cos(pitch);
  out.x = distance * Math.sin(yaw) * cosPitch;
  out.y = distance * Math.sin(pitch);
  out.z = distance * Math.cos(yaw) * cosPitch;
  return out;
}

/**
 * The axes three's `lookAt` builds for this camera with up = +Y:
 * back = unit offset, right = up × back = (cos yaw, 0, −sin yaw),
 * screen up = back × right = (−sin p·sin yaw, cos p, −sin p·cos yaw).
 * At yaw 0 right is +X (east), so heading-0 lines are horizontal on screen
 * and the camera looks north.
 */
export function cameraBasis(yaw: number, pitch: number = ISO_PITCH_RAD, out?: CameraBasis): CameraBasis {
  const basis = out ?? { right: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 0 }, back: { x: 0, y: 0, z: 0 } };
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const sinPitch = Math.sin(pitch);
  const cosPitch = Math.cos(pitch);
  setXyz(basis.right, cosYaw, 0, -sinYaw);
  setXyz(basis.up, -sinPitch * sinYaw, cosPitch, -sinPitch * cosYaw);
  setXyz(basis.back, sinYaw * cosPitch, sinPitch, cosYaw * cosPitch);
  return basis;
}

/** Orthographic frustum for a CSS viewport: halfW = cssW/(2·ppm), halfH = cssH/(2·ppm). */
export function frustumFor(
  cssWidth: number,
  cssHeight: number,
  ppm: number,
): { left: number; right: number; top: number; bottom: number } {
  const halfW = cssWidth / (2 * ppm);
  const halfH = cssHeight / (2 * ppm);
  return { left: -halfW, right: halfW, top: halfH, bottom: -halfH };
}

export function clampPpm(ppm: number): number {
  if (Number.isNaN(ppm)) throw new RangeError("ppm is NaN");
  return Math.min(PPM_MAX, Math.max(PPM_MIN, ppm));
}

/**
 * The next named zoom level above (direction 1) or below (−1) `ppm`. A ppm
 * already past the last level in that direction stays where it is, so + and −
 * never jump to an unnamed extreme.
 */
export function nextNamedZoom(ppm: number, direction: 1 | -1): number {
  if (direction === 1) {
    for (const level of NAMED_ZOOM_LEVELS) if (level > ppm * (1 + NAMED_ZOOM_EPSILON)) return level;
  } else {
    for (let i = NAMED_ZOOM_LEVELS.length - 1; i >= 0; i--) {
      const level = NAMED_ZOOM_LEVELS[i] ?? ppm;
      if (level < ppm * (1 - NAMED_ZOOM_EPSILON)) return level;
    }
  }
  return clampPpm(ppm);
}

export function lodBandForPpm(ppm: number): LodBand {
  if (ppm < LOD_MID_FROM_PPM) return "far";
  return ppm > LOD_NEAR_ABOVE_PPM ? "near" : "mid";
}

/** Keeps the target on the map, give or take `marginM` (default 100 m). */
export function clampTarget(
  target: Readonly<GroundPoint>,
  bounds: GroundBounds,
  marginM: number = TARGET_MARGIN_M,
  out: GroundPoint = { x: 0, z: 0 },
): GroundPoint {
  out.x = Math.min(bounds.maxX + marginM, Math.max(bounds.minX - marginM, target.x));
  out.z = Math.min(bounds.maxZ + marginM, Math.max(bounds.minZ - marginM, target.z));
  return out;
}

const scratchBasis = cameraBasis(0);

/** Screen position in CSS px (origin top-left, y down) of a world point. */
export function worldToScreen(view: IsoView, p: Readonly<Xyz>, out: { x: number; y: number } = { x: 0, y: 0 }) {
  const { right, up } = cameraBasis(view.yaw, view.pitch, scratchBasis);
  const dx = p.x - view.target.x;
  const dy = p.y;
  const dz = p.z - view.target.z;
  out.x = view.cssWidth / 2 + (dx * right.x + dy * right.y + dz * right.z) * view.ppm;
  out.y = view.cssHeight / 2 - (dx * up.x + dy * up.y + dz * up.z) * view.ppm;
  return out;
}

/**
 * The view ray through a CSS pixel: it starts on the camera plane (the camera
 * sits at target + D·back) and runs along −back, like three's ortho raycaster.
 */
export function screenRay(
  view: IsoView,
  cssX: number,
  cssY: number,
  out: { origin: Xyz; direction: Xyz } = { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 0 } },
): { origin: Xyz; direction: Xyz } {
  const { right, up, back } = cameraBasis(view.yaw, view.pitch, scratchBasis);
  const sx = (cssX - view.cssWidth / 2) / view.ppm;
  const sy = (view.cssHeight / 2 - cssY) / view.ppm;
  const d = CAMERA_DISTANCE_M;
  setXyz(
    out.origin,
    view.target.x + d * back.x + sx * right.x + sy * up.x,
    d * back.y + sx * right.y + sy * up.y,
    view.target.z + d * back.z + sx * right.z + sy * up.z,
  );
  setXyz(out.direction, -back.x, -back.y, -back.z);
  return out;
}

const scratchRay = { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 0 } };

/** Where the ray through a CSS pixel crosses the horizontal plane Y = `height`. */
export function screenToWorldAtHeight(
  view: IsoView,
  cssX: number,
  cssY: number,
  height: number,
  out: Xyz = { x: 0, y: 0, z: 0 },
): Xyz {
  const { origin, direction } = screenRay(view, cssX, cssY, scratchRay);
  // direction.y = −sin(pitch) < 0, so the plane is always crossed ahead.
  const t = (height - origin.y) / direction.y;
  return setXyz(out, origin.x + t * direction.x, height, origin.z + t * direction.z);
}

/**
 * New target and ppm that zoom to `newPpm` (clamped) while the world point
 * `anchor` keeps its screen position.
 *
 * Maths: in an orthographic view the screen offset of a point P from the
 * viewport centre, in metres, is a = (P − T)·right and b = (P − T)·up, and in
 * CSS px it is (a·ppm, −b·ppm). Keeping it fixed across a zoom needs
 * a' = a·ppm/ppm' and b' = b·ppm/ppm', i.e. the target moves by Δ with
 * Δ·right = f·a and Δ·up = f·b, where f = 1 − ppm/ppm'. The target stays on
 * Y = 0, so write Δ = α·right + β·h with h = (sin yaw, 0, cos yaw), the
 * horizontal direction toward the camera: right·up = 0 and h·up = −sin p give
 * α = f·a and β = −f·b / sin p.
 *
 * Every point on one view ray projects to the same pixel, so the anchor can be
 * the ray's hit on the terrain or its crossing of Y = 0: the result is the
 * same, and the terrain point under the cursor stays put either way.
 */
export function zoomAboutPoint(
  state: { readonly target: Readonly<GroundPoint>; readonly ppm: number },
  anchor: Readonly<{ x: number; y?: number; z: number }>,
  newPpm: number,
  yaw: number,
  pitch: number = ISO_PITCH_RAD,
): { target: GroundPoint; ppm: number } {
  const ppm = clampPpm(newPpm);
  const { right, up } = cameraBasis(yaw, pitch, scratchBasis);
  const dx = anchor.x - state.target.x;
  const dy = anchor.y ?? 0;
  const dz = anchor.z - state.target.z;
  const a = dx * right.x + dy * right.y + dz * right.z;
  const b = dx * up.x + dy * up.y + dz * up.z;
  const f = 1 - state.ppm / ppm;
  const alpha = f * a;
  const beta = (-f * b) / Math.sin(pitch);
  return {
    target: {
      x: state.target.x + alpha * right.x + beta * Math.sin(yaw),
      z: state.target.z + alpha * right.z + beta * Math.cos(yaw),
    },
    ppm,
  };
}

/**
 * Target after the content moves by (dxPx, dyPx) CSS px (y down), as when
 * the pointer drags the ground: the ground point under the pointer follows it.
 * Same algebra as `zoomAboutPoint`: Δ·right = −dx/ppm, Δ·up = dy/ppm.
 */
export function panByScreen(
  target: Readonly<GroundPoint>,
  dxPx: number,
  dyPx: number,
  ppm: number,
  yaw: number,
  pitch: number = ISO_PITCH_RAD,
  out: GroundPoint = { x: 0, z: 0 },
): GroundPoint {
  const alpha = -dxPx / ppm;
  const beta = -dyPx / (ppm * Math.sin(pitch));
  const x = target.x + alpha * Math.cos(yaw) + beta * Math.sin(yaw);
  const z = target.z - alpha * Math.sin(yaw) + beta * Math.cos(yaw);
  out.x = x;
  out.z = z;
  return out;
}

/** Row spacing of the lattice's parallel lines: 5 m · √3/2. */
const LATTICE_ROW_SPACING_M = 4.330127018922193;
/**
 * World directions of the three lattice line families, headings 0°, 60° and
 * 120° (sim, CCW from east). Converted once through coords.ts, the single
 * sim ↔ world conversion, so the frame loop does no trig or allocation here.
 */
const FAMILY_DIRECTIONS: readonly Vector3[] = [0, Math.PI / 3, (2 * Math.PI) / 3].map((heading) =>
  simToWorld(Math.cos(heading), Math.sin(heading), 0),
);

/**
 * The smallest on-screen spacing, in CSS px, between parallel lattice lines.
 * A ground line family with direction t and spacing h projects to screen
 * lines h·|det M|/|M·t| apart, where M is the ground → screen map; its
 * determinant is sin(pitch). At every rest yaw one family is screen-horizontal
 * and comes out at h·sin(pitch)·ppm = 2.5 m·ppm (art direction "Terrain").
 */
export function minLatticeLineSpacingPx(
  yaw: number,
  pitch: number,
  ppm: number,
  spacingM: number = LATTICE_ROW_SPACING_M,
): number {
  const { right, up } = cameraBasis(yaw, pitch, scratchBasis);
  const groundSpacingPx = spacingM * Math.sin(pitch) * ppm;
  let min = Infinity;
  for (let i = 0; i < FAMILY_DIRECTIONS.length; i++) {
    const t = FAMILY_DIRECTIONS[i];
    if (t === undefined) continue;
    const sx = t.x * right.x + t.z * right.z;
    const sy = t.x * up.x + t.z * up.z;
    const spacing = groundSpacingPx / Math.hypot(sx, sy);
    if (spacing < min) min = spacing;
  }
  return min;
}

/** Symmetric cubic ease for the 300 ms yaw rotation. */
export function easeInOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - ((-2 * c + 2) * (-2 * c + 2) * (-2 * c + 2)) / 2;
}

function setXyz(v: Xyz, x: number, y: number, z: number): Xyz {
  v.x = x;
  v.y = y;
  v.z = z;
  return v;
}
