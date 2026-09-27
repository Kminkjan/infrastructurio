import { type IUniform, Vector2 } from "three";
import { ALBEDO_ANCHOR, type ShaderChunk, ensureArtWorld, inject } from "./chunk";
import { smoothstep } from "../../math";

/**
 * Terrain relief (terrain look variants, 2026-09-27): makes the gentle
 * diorama hills read without post-processing, by lighting, not geometry.
 *
 * - **Slope gain.** The shading normal is tilted as if the slope were
 *   steeper: for y = f(x, z), n ∝ (−fx, 1, −fz), so a slope of tangent t turns
 *   into t′ = t·g / (1 + t·g / tMax), keeping its aspect. Gentle slopes steepen
 *   about g times, steep ones level off below atan(tMax), so no bank goes black
 *   (tMax = ∞ is a plain height scale by g). Flat ground keeps exactly its old
 *   normal and colour; only slopes turn toward or away from the sun. The map's
 *   median slope is 3.6° and its 90th percentile 7.5°, which under the 42° sun
 *   and the hemisphere fill moves the light by only a few percent.
 * - **Facets** (optional, `facets: true`). Adds each lattice triangle's own
 *   plane normal, from screen derivatives of the world position (what three's
 *   flatShading does, in world space), as a detail on top of the steepened
 *   smooth normal: n = normalize(n′ + w·(n_facet − n_smooth)). The hills keep
 *   the smooth gain; the facets add a crisp, hand-cut tone per triangle (the
 *   Int16 heights' 1 dm steps included, which is what makes them irregular).
 *   `w` fades in between two zooms, so Far zoom stays smooth. On earthworks
 *   (the terrain's `earthwork` attribute, when present) the facets fade out
 *   by its lip weight: the refined 1.25 m triangles of a cutting or bank would
 *   otherwise show as stair-stepped facets along its crest (render pass
 *   iteration, 2026-09-27).
 * - **Contour hint** (optional). A faint line every `uReliefContourM` metres of
 *   height, one pixel wide at any zoom (distance to the line over `fwidth`),
 *   every `uReliefContourMajor`-th a little stronger, faded out where lines
 *   would crowd closer than `uReliefContourFadePx`.
 *
 * Geometry, heights, picking and the sim are untouched. `steepenSlope`,
 * `exaggerateNormal`, `facetNormal`, `facetWeight`, `reliefNormal` and
 * `contourShade` mirror the GLSL for tests.
 */

export interface ReliefUniforms {
  readonly uReliefGain: IUniform<number>;
  /** The steepened slope's tangent levels off below this (a large value: linear gain). */
  readonly uReliefMaxTan: IUniform<number>;
  /** Weight of each lattice triangle's own plane on top of the smooth normal (0 = smooth; facets chunk only). */
  readonly uReliefFacet: IUniform<number>;
  /** Facets fade in between these zooms (ppm). */
  readonly uReliefFacetPpm: IUniform<Vector2>;
  /** The camera's zoom (ppm), set per frame. */
  readonly uReliefPpm: IUniform<number>;
  /** Contour darkening at a line (0 = off). */
  readonly uReliefContour: IUniform<number>;
  readonly uReliefContourM: IUniform<number>;
  readonly uReliefContourMajor: IUniform<number>;
  readonly uReliefContourFadePx: IUniform<number>;
}

export interface ReliefSettings {
  readonly gain: number;
  readonly maxTan: number;
  readonly facet: number;
  readonly facetPpm: readonly [number, number];
  readonly contour: number;
  readonly contourM: number;
  readonly contourMajor: number;
  readonly contourFadePx: number;
}

/** No relief change: gain 1, no facets, no contours. */
export const NEUTRAL_RELIEF: ReliefSettings = { gain: 1, maxTan: 1e6, facet: 0, facetPpm: [1.5, 3], contour: 0, contourM: 2.5, contourMajor: 4, contourFadePx: 5 };
/** A major contour line darkens this many times as much as a minor one. */
export const CONTOUR_MAJOR_FACTOR = 1.6;

export function createReliefUniforms(settings: ReliefSettings = NEUTRAL_RELIEF): ReliefUniforms {
  const u: ReliefUniforms = {
    uReliefGain: { value: 1 },
    uReliefMaxTan: { value: 1e6 },
    uReliefFacet: { value: 0 },
    uReliefFacetPpm: { value: new Vector2(1.5, 3) },
    uReliefPpm: { value: 6 },
    uReliefContour: { value: 0 },
    uReliefContourM: { value: 2.5 },
    uReliefContourMajor: { value: 4 },
    uReliefContourFadePx: { value: 5 },
  };
  applyReliefSettings(u, settings);
  return u;
}

export function applyReliefSettings(u: ReliefUniforms, s: ReliefSettings): void {
  u.uReliefGain.value = s.gain;
  u.uReliefMaxTan.value = s.maxTan;
  u.uReliefFacet.value = s.facet;
  u.uReliefFacetPpm.value.set(s.facetPpm[0], s.facetPpm[1]);
  u.uReliefContour.value = s.contour;
  u.uReliefContourM.value = s.contourM;
  u.uReliefContourMajor.value = s.contourMajor;
  u.uReliefContourFadePx.value = s.contourFadePx;
}

const FRAGMENT_PARS = /* glsl */ `
uniform float uReliefGain;
uniform float uReliefMaxTan;
uniform float uReliefFacet;
uniform vec2 uReliefFacetPpm;
uniform float uReliefPpm;
uniform float uReliefContour;
uniform float uReliefContourM;
uniform float uReliefContourMajor;
uniform float uReliefContourFadePx;
`;

// After the surface colours: contour lines darken the albedo, over grass, fields and roads alike.
const FRAGMENT_ALBEDO = /* glsl */ `
if ( uReliefContour > 0.0 ) {
  float reliefH = vArtWorld.y / uReliefContourM;
  float reliefPerPx = max( fwidth( reliefH ), 1e-5 );
  float reliefLinePx = abs( fract( reliefH + 0.5 ) - 0.5 ) / reliefPerPx;
  float reliefLine = 1.0 - smoothstep( 0.25, 1.0, reliefLinePx );
  float reliefMajor = abs( mod( floor( reliefH + 0.5 ), uReliefContourMajor ) ) < 0.5 ? ${CONTOUR_MAJOR_FACTOR.toFixed(2)} : 1.0;
  float reliefLegible = smoothstep( uReliefContourFadePx, 2.0 * uReliefContourFadePx, 1.0 / reliefPerPx );
  diffuseColor.rgb *= 1.0 - uReliefContour * reliefMajor * reliefLine * reliefLegible;
}
`;

// After three's normal: view → world, steepen the slope, add the facet detail, back to view space.
const FRAGMENT_NORMAL = /* glsl */ `
{
  vec3 reliefN = ( vec4( normal, 0.0 ) * viewMatrix ).xyz;
  vec3 reliefSmooth = reliefN;
  float reliefTan = length( reliefN.xz ) / max( reliefN.y, 1e-3 );
  float reliefScale = uReliefGain / ( 1.0 + reliefTan * uReliefGain / uReliefMaxTan );
  reliefN = normalize( vec3( reliefN.x * reliefScale, reliefN.y, reliefN.z * reliefScale ) );
  #ifdef RELIEF_FACETS
  vec3 reliefF = cross( dFdx( vArtWorld ), dFdy( vArtWorld ) );
  reliefF = normalize( reliefF.y < 0.0 ? - reliefF : reliefF );
  float reliefFacetW = uReliefFacet * smoothstep( uReliefFacetPpm.x, uReliefFacetPpm.y, uReliefPpm );
  #ifdef TERRAIN_EARTHWORK
  reliefFacetW *= 1.0 - earthworkLip();
  #endif
  reliefN = normalize( reliefN + reliefFacetW * ( reliefF - reliefSmooth ) );
  #endif
  normal = normalize( ( viewMatrix * vec4( reliefN, 0.0 ) ).xyz );
}
`;

export const NORMAL_ANCHOR = "#include <normal_fragment_maps>";

/** `facets` compiles the facet path in; without it `uReliefFacet` does nothing. */
export function createReliefChunk(uniforms: ReliefUniforms, options: { readonly facets?: boolean } = {}): ShaderChunk {
  const facets = options.facets === true;
  return {
    key: facets ? "terrain-relief-v2-facets" : "terrain-relief-v2",
    patch(shader) {
      Object.assign(shader.uniforms, uniforms);
      ensureArtWorld(shader);
      const pars = facets ? `#define RELIEF_FACETS\n${FRAGMENT_PARS}` : FRAGMENT_PARS;
      shader.fragmentShader = inject(shader.fragmentShader, "#include <common>", pars, "after");
      shader.fragmentShader = inject(shader.fragmentShader, ALBEDO_ANCHOR, FRAGMENT_ALBEDO, "before");
      shader.fragmentShader = inject(shader.fragmentShader, NORMAL_ANCHOR, FRAGMENT_NORMAL, "after");
    },
  };
}

type Vec3 = readonly [number, number, number];

function normalize(v: Vec3): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** The steepened slope tangent: t·g / (1 + t·g / tMax). */
export function steepenSlope(tan: number, gain: number, maxTan: number): number {
  return (tan * gain) / (1 + (tan * gain) / maxTan);
}

/** The shading normal for world normal `n` (Y up): its slope steepened by `steepenSlope`, aspect kept. */
export function exaggerateNormal(n: Vec3, gain: number, maxTan = 1e6): [number, number, number] {
  const u = normalize(n);
  const tan = Math.hypot(u[0], u[2]) / Math.max(u[1], 1e-3);
  const scale = gain / (1 + (tan * gain) / maxTan);
  return normalize([u[0] * scale, u[1], u[2] * scale]);
}

/** How much of the facet normal the shader blends in at a zoom, over earthwork lip weight `lip` (0 off earthworks). */
export function facetWeight(facet: number, ppm: number, fadePpm: readonly [number, number], lip = 0): number {
  return facet * smoothstep(fadePpm[0], fadePpm[1], ppm) * (1 - lip);
}

/** A triangle's upward unit normal from its world vertices (what the derivative cross product gives). */
export function facetNormal(a: Vec3, b: Vec3, c: Vec3): [number, number, number] {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
  const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return normalize(n[1] < 0 ? [-n[0], -n[1], -n[2]] : n);
}

/**
 * The shading normal: the smooth normal's slope steepened, plus `weight` times
 * the facet's deviation from the smooth normal.
 */
export function reliefNormal(smooth: Vec3, facet: Vec3, weight: number, gain: number, maxTan = 1e6): [number, number, number] {
  const s = normalize(smooth);
  const e = exaggerateNormal(s, gain, maxTan);
  return normalize([e[0] + weight * (facet[0] - s[0]), e[1] + weight * (facet[1] - s[1]), e[2] + weight * (facet[2] - s[2])]);
}

/**
 * The albedo factor of the contour hint at height `heightM`, where the height
 * changes by `metresPerPx` per screen pixel (the shader's fwidth, in metres).
 */
export function contourShade(heightM: number, metresPerPx: number, s: Pick<ReliefSettings, "contour" | "contourM" | "contourMajor" | "contourFadePx">): number {
  if (s.contour <= 0) return 1;
  const h = heightM / s.contourM;
  const perPx = Math.max(metresPerPx / s.contourM, 1e-5);
  const linePx = Math.abs(h + 0.5 - Math.floor(h + 0.5) - 0.5) / perPx;
  const line = 1 - smoothstep(0.25, 1, linePx);
  const index = Math.floor(h + 0.5);
  const major = Math.abs(index - s.contourMajor * Math.floor(index / s.contourMajor)) < 0.5 ? CONTOUR_MAJOR_FACTOR : 1;
  const legible = smoothstep(s.contourFadePx, 2 * s.contourFadePx, 1 / perPx);
  return 1 - s.contour * major * line * legible;
}
