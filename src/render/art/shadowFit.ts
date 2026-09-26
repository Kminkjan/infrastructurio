import { type IsoView, type Xyz, cameraBasis, screenToWorldAtHeight } from "../camera/isoMath";

/**
 * One directional shadow map fitted to what the camera sees (architecture
 * "Quality presets and shadows"): no cascades, because an orthographic view
 * has a bounded footprint. Pure maths, so the fit is testable.
 *
 * The frustum's size moves in 1.25× steps and its origin snaps to whole
 * texels in a light space fixed per yaw, so a pan slides the map by whole
 * texels and shadow edges don't shimmer.
 */

export const SUN_ELEVATION_RAD = (42 * Math.PI) / 180;
/**
 * The sun's horizontal direction in the camera's frame: left and toward the
 * viewer, so it lights the scene from the screen's upper left. These are the
 * smoke scene's tuned values (−0.55 right, 0.45 toward the camera at yaw 0).
 */
const SUN_RIGHT = -0.55;
const SUN_TOWARD_CAMERA = 0.45;
/** Extent quantisation step. */
export const SHADOW_EXTENT_STEP = 1.25;
/** Extra depth toward the sun for casters taller than the terrain (trees, buildings, bridges). */
const CASTER_HEADROOM_M = 60;
/** Distance of the shadow camera beyond the nearest caster, and slack at the far end. */
const DEPTH_MARGIN_M = 10;

/** Light space: x and y span the shadow map, z points toward the sun. */
export interface LightBasis {
  readonly x: Xyz;
  readonly y: Xyz;
  readonly z: Xyz;
}

/** The fitted shadow camera. Mutable so the frame loop can refit into one object without allocating. */
export interface ShadowFit {
  /** Light position (world), at the snapped centre of the map, on the sun side. */
  readonly position: Xyz;
  /** Light target (world): straight down the light direction from the position. */
  readonly target: Xyz;
  /** Shadow-camera frustum, relative to the light position in light space. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
  /** Square extent of the map in metres, and one texel's size. */
  extent: number;
  texel: number;
  /** Snapped centre in light-space x and y. */
  centreX: number;
  centreY: number;
}

export function createShadowFit(): ShadowFit {
  return {
    position: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    near: 0,
    far: 0,
    extent: 0,
    texel: 0,
    centreX: 0,
    centreY: 0,
  };
}

/** World box of the terrain: the map's XZ extent and its height range. */
export interface WorldBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * Unit vector toward the sun at 42° elevation (or `elevationRad`, which only
 * the lookdev tweak panel changes), locked to camera yaw.
 */
export function sunDirection(yaw: number, out: Xyz = { x: 0, y: 0, z: 0 }, elevationRad: number = SUN_ELEVATION_RAD): Xyz {
  const { right, back } = cameraBasis(yaw, 0, scratchCameraBasis);
  // With pitch 0, `back` is the horizontal direction toward the camera.
  const hx = SUN_RIGHT * right.x + SUN_TOWARD_CAMERA * back.x;
  const hz = SUN_RIGHT * right.z + SUN_TOWARD_CAMERA * back.z;
  // Normalise the horizontal part first so the elevation is exactly 42°.
  const scale = Math.cos(elevationRad) / Math.hypot(hx, hz);
  out.x = hx * scale;
  out.y = Math.sin(elevationRad);
  out.z = hz * scale;
  return out;
}

/**
 * The basis three's shadow camera builds when it looks from the light toward
 * its target with up = +Y: z toward the sun, x = up × z, y = z × x. Using the
 * same basis here makes left/right/top/bottom mean the same thing.
 */
export function lightBasis(sun: Readonly<Xyz>, out?: LightBasis): LightBasis {
  const basis = out ?? { x: { x: 0, y: 0, z: 0 }, y: { x: 0, y: 0, z: 0 }, z: { x: 0, y: 0, z: 0 } };
  const { x, y, z } = basis;
  const zl = Math.hypot(sun.x, sun.y, sun.z);
  z.x = sun.x / zl;
  z.y = sun.y / zl;
  z.z = sun.z / zl;
  const xl = Math.hypot(z.z, z.x);
  x.x = z.z / xl;
  x.y = 0;
  x.z = -z.x / xl;
  y.x = z.y * x.z - z.z * x.y;
  y.y = z.z * x.x - z.x * x.z;
  y.z = z.x * x.y - z.y * x.x;
  return basis;
}

/** Smallest SHADOW_EXTENT_STEP^n (n integer) that is ≥ `extent`. */
export function quantizeExtent(extent: number): number {
  const n = Math.ceil(Math.log(extent) / Math.log(SHADOW_EXTENT_STEP) - 1e-9);
  return SHADOW_EXTENT_STEP ** n;
}

const corner = { x: 0, y: 0, z: 0 };
const scratchCameraBasis = cameraBasis(0);
const scratchLightBasis = lightBasis({ x: 0, y: 1, z: 1 });

/**
 * Fits the shadow camera to the view footprint: the four viewport corners
 * projected onto the terrain's lowest and highest planes, taken into light
 * space. When `map` is given the box is also clipped to the map's box in light
 * space, which saves texels at Far zoom. Depth then reaches toward the sun
 * far enough for the highest ground (plus headroom for future scenery) to
 * cast into the footprint.
 */
export function fitShadowFrustum(
  view: IsoView,
  heights: { readonly minM: number; readonly maxM: number },
  sun: Readonly<Xyz>,
  mapSize: number,
  map?: WorldBox,
  out: ShadowFit = createShadowFit(),
): ShadowFit {
  const basis = lightBasis(sun, scratchLightBasis);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < 8; i++) {
    const cssX = i & 1 ? view.cssWidth : 0;
    const cssY = i & 2 ? view.cssHeight : 0;
    screenToWorldAtHeight(view, cssX, cssY, i & 4 ? heights.maxM : heights.minM, corner);
    const lx = dot(corner, basis.x);
    const ly = dot(corner, basis.y);
    const lz = dot(corner, basis.z);
    minX = Math.min(minX, lx);
    maxX = Math.max(maxX, lx);
    minY = Math.min(minY, ly);
    maxY = Math.max(maxY, ly);
    minZ = Math.min(minZ, lz);
    maxZ = Math.max(maxZ, lz);
  }

  if (map) {
    let mx0 = Infinity;
    let mx1 = -Infinity;
    let my0 = Infinity;
    let my1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      corner.x = i & 1 ? map.maxX : map.minX;
      corner.y = i & 2 ? map.maxY : map.minY;
      corner.z = i & 4 ? map.maxZ : map.minZ;
      const lx = dot(corner, basis.x);
      const ly = dot(corner, basis.y);
      mx0 = Math.min(mx0, lx);
      mx1 = Math.max(mx1, lx);
      my0 = Math.min(my0, ly);
      my1 = Math.max(my1, ly);
    }
    // Keep the clip only if the view still overlaps the map.
    if (Math.max(minX, mx0) < Math.min(maxX, mx1) && Math.max(minY, my0) < Math.min(maxY, my1)) {
      minX = Math.max(minX, mx0);
      maxX = Math.min(maxX, mx1);
      minY = Math.max(minY, my0);
      maxY = Math.min(maxY, my1);
    }
  }

  // Casters up to the highest ground (and headroom) stand along +z from the lowest receivers.
  maxZ += (heights.maxM - heights.minM) / Math.max(1e-3, sun.y) + CASTER_HEADROOM_M;

  // Pad so snapping the centre by up to half a texel never uncovers the footprint.
  const required = Math.max(maxX - minX, maxY - minY, 1) * (1 + 2 / mapSize);
  const extent = quantizeExtent(required);
  const texel = extent / mapSize;
  const centreX = Math.round((minX + maxX) / 2 / texel) * texel;
  const centreY = Math.round((minY + maxY) / 2 / texel) * texel;
  const top = maxZ + DEPTH_MARGIN_M;
  const half = extent / 2;
  const { position, target } = out;
  position.x = centreX * basis.x.x + centreY * basis.y.x + top * basis.z.x;
  position.y = centreX * basis.x.y + centreY * basis.y.y + top * basis.z.y;
  position.z = centreX * basis.x.z + centreY * basis.y.z + top * basis.z.z;
  target.x = position.x - basis.z.x;
  target.y = position.y - basis.z.y;
  target.z = position.z - basis.z.z;
  out.left = -half;
  out.right = half;
  out.top = half;
  out.bottom = -half;
  out.near = 0.5;
  out.far = top - minZ + DEPTH_MARGIN_M;
  out.extent = extent;
  out.texel = texel;
  out.centreX = centreX;
  out.centreY = centreY;
  return out;
}

function dot(a: Readonly<Xyz>, b: Readonly<Xyz>): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
