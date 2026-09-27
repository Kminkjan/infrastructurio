import { Color, type IUniform } from "three";
import { palette } from "../palette";
import { CREST_ROUND_M, EARTHWORK_WEIGHT_FROM_X, FORMATION_HALF_WIDTH_M, SIDE_SLOPE_RUN, encodeEarthworkPotential, slopeRiseM } from "../../terrain/earthworks";
import { ALBEDO_ANCHOR, type ShaderChunk, type ShaderSource, inject } from "./chunk";
import { smoothstep } from "../../math";

/**
 * Earthworks on the terrain (earthworks-lite, `render/terrain/earthworks.ts`;
 * render pass iteration, 2026-09-27). Every terrain chunk geometry carries a
 * vec3 `earthwork` attribute (zeros on natural ground):
 * - x: the encoded potential, how far the natural ground lies outside the
 *   conform envelopes (`encodeEarthworkPotential`, `terrain/earthworks.ts`).
 *   It is interpolated unclamped and cut per fragment, so a cutting's edge
 *   follows the smooth daylight contour, never the sub-lattice's triangles.
 *   It gives two weights:
 *   the *lip* (0 → 1 from 1 m outside the sharp daylight line to 5 cm inside
 *   it, covering the rounded lip the smooth clamp digs) and the *earthwork*
 *   weight (0 → 1 from 5 cm to 40 cm inside it);
 * - y: the signed departure C − N (m, negative in cuts);
 * - z: the plan distance to the nearest ground centreline (m).
 *
 * Colour, by the owner's feedback (grassed-over banks, as on a 1900 line, with
 * earth only where it is fresh and steep): the splat (with its `earthwork`
 * option) fades fields, roads, forest floor and the AO tint by the earthwork
 * weight and the grass detail's slope soil by the lip, so earthworks keep the
 * surrounding grass. This chunk, installed right after the splat, then tints
 * steep earthwork slopes slightly toward light grass, lays `earthworkFace` in
 * cuts deeper than about 1.5 m (fading in from 1.2 to 2.2 m of cut), but only
 * on the lower batter, up to about 2 m above the formation (the side slope's
 * rise, from the centreline distance through the conform's own ease), so a deep
 * cutting stays grassed above a fresh lower face and the upper lip is never
 * bare; and `earthworkBed` on a narrow shoulder beside the ballast (2.4 → 3.0 m
 * from the centreline) where the formation is cut, merging into that face. Steepness comes from the
 * smooth vertex normal. The
 * relief chunk fades its lattice facets out by the lip, so the refined 1.25 m
 * triangles never show as facets. `earthworkAlbedo` mirrors the GLSL.
 */

/** Bare earth fades in between these cut depths (m, the departure N − C). */
export const BARE_CUT_M = [1.2, 2.2] as const;
/** Bare earth's most (a little grass always stays in the colour). */
export const BARE_MAX = 0.85;
/** Bare earth fades out between these heights above the formation (m, the side slope's rise): the lower batter only. */
export const BARE_RISE_M = [1.5, 2.5] as const;
/** World normal y for the slope tint: steeper than the first (about 31°) is fully steep, gentler than the second (about 20°) not at all. */
export const STEEP_NORMAL_Y = [0.86, 0.94] as const;
/** The shoulder: full within the first plan distance from the centreline, gone past the second (the formation edge). */
export const SHOULDER_M = [2.4, 3.0] as const;
/**
 * The shoulder's own weight is full from this potential (m), sooner than the earthwork weight, and it
 * fades out on fills over the first SHOULDER_FILL_M of departure: a cutting's cess shows earth, an
 * embankment's formation stays grassed like its banks. (Faded by the earthwork weight instead, it drew a
 * thin detached line on the fill side of a cross-slope, where the fill grows outward across the shoulder.)
 */
export const SHOULDER_FULL_M = 0.15;
export const SHOULDER_FILL_M = 0.1;
const SHOULDER_FULL_X = encodeEarthworkPotential(SHOULDER_FULL_M);
/** Steep earthwork slopes move this far toward light grass (a drier, sunnier bank). */
export const SLOPE_TINT = 0.12;
const LUMA = [0.2126, 0.7152, 0.0722] as const;
const SHADE_MIN = 0.75;
const SHADE_MAX = 1.15;

/** The earthwork weight (0–1) of an interpolated attribute x. */
export function earthworkWeightOf(x: number): number {
  return Math.min(1, Math.max(0, (x - EARTHWORK_WEIGHT_FROM_X) / (1 - EARTHWORK_WEIGHT_FROM_X)));
}

/** The lip weight (0–1) of an interpolated attribute x. */
export function earthworkLipOf(x: number): number {
  return Math.min(1, Math.max(0, x / EARTHWORK_WEIGHT_FROM_X));
}

export interface EarthworkUniforms {
  readonly uEarthworkBed: IUniform<Color>;
  readonly uEarthworkFace: IUniform<Color>;
  readonly uEarthworkGrass: IUniform<Color>;
  readonly uEarthworkGrassLight: IUniform<Color>;
}

export function createEarthworkUniforms(): EarthworkUniforms {
  const u: EarthworkUniforms = { uEarthworkBed: { value: new Color() }, uEarthworkFace: { value: new Color() }, uEarthworkGrass: { value: new Color() }, uEarthworkGrassLight: { value: new Color() } };
  syncEarthworkColors(u);
  return u;
}

/** Copies the palette into the colour uniforms (after a tweak-panel override, too). */
export function syncEarthworkColors(u: EarthworkUniforms): void {
  u.uEarthworkBed.value.setHex(palette.earthworkBed);
  u.uEarthworkFace.value.setHex(palette.earthworkFace);
  u.uEarthworkGrass.value.setHex(palette.grass);
  u.uEarthworkGrassLight.value.setHex(palette.grassLight);
}

/** Name of the vertex attribute every terrain chunk geometry carries (zeros where nothing moved), and its size. */
export const EARTHWORK_ATTRIBUTE = "earthwork";
export const EARTHWORK_ITEM_SIZE = 3;

const VERTEX_PARS = /* glsl */ `
attribute vec3 earthwork;
varying vec3 vEarthwork;
`;

const VERTEX_MAIN = /* glsl */ `
vEarthwork = earthwork;
`;

// TERRAIN_EARTHWORK tells the splat and relief chunks the attribute is there; the helpers
// turn the interpolated encoding into the two weights (see the module comment).
const FRAGMENT_VARYING = /* glsl */ `
#define TERRAIN_EARTHWORK
varying vec3 vEarthwork;
float earthworkWeight() {
  return clamp( ( vEarthwork.x - ${EARTHWORK_WEIGHT_FROM_X.toFixed(6)} ) / ${(1 - EARTHWORK_WEIGHT_FROM_X).toFixed(6)}, 0.0, 1.0 );
}
float earthworkLip() {
  return clamp( vEarthwork.x / ${EARTHWORK_WEIGHT_FROM_X.toFixed(6)}, 0.0, 1.0 );
}
`;

/**
 * Adds the attribute, the varying and the weight helpers once per shader, however
 * many chunks read them (the earthwork chunk, and the splat's `earthwork` option).
 */
export function ensureEarthworkVarying(shader: ShaderSource): void {
  if (shader.fragmentShader.includes("#define TERRAIN_EARTHWORK")) return;
  shader.vertexShader = inject(shader.vertexShader, "#include <common>", VERTEX_PARS, "after");
  shader.vertexShader = inject(shader.vertexShader, "#include <begin_vertex>", VERTEX_MAIN, "after");
  shader.fragmentShader = inject(shader.fragmentShader, "#include <common>", FRAGMENT_VARYING, "after");
}

const FRAGMENT_PARS = /* glsl */ `
uniform vec3 uEarthworkBed;
uniform vec3 uEarthworkFace;
uniform vec3 uEarthworkGrass;
uniform vec3 uEarthworkGrassLight;
`;

const FRAGMENT_MAIN = /* glsl */ `
{
  float ewWeight = earthworkWeight();
  if ( ewWeight > 0.0 ) {
    vec3 ewUp = inverseTransformDirection( normalize( vNormal ), viewMatrix );
    float ewSteep = 1.0 - smoothstep( ${STEEP_NORMAL_Y[0].toFixed(3)}, ${STEEP_NORMAL_Y[1].toFixed(3)}, ewUp.y );
    vec3 ewLuma = vec3( ${LUMA.join(", ")} );
    float ewShade = clamp( dot( diffuseColor.rgb, ewLuma ) / max( dot( uEarthworkGrass, ewLuma ), 1e-3 ), ${SHADE_MIN.toFixed(2)}, ${SHADE_MAX.toFixed(2)} );
    diffuseColor.rgb *= mix( vec3( 1.0 ), uEarthworkGrassLight / uEarthworkGrass, ${SLOPE_TINT.toFixed(3)} * ewSteep * ewWeight );
    float ewRun = vEarthwork.z - ${FORMATION_HALF_WIDTH_M.toFixed(3)};
    float ewRise = ewRun <= 0.0 ? 0.0 : ( ewRun < ${CREST_ROUND_M.toFixed(3)} ? ewRun * ewRun / ${(2 * CREST_ROUND_M).toFixed(3)} : ewRun - ${(CREST_ROUND_M / 2).toFixed(3)} ) / ${SIDE_SLOPE_RUN.toFixed(3)};
    float ewBare = ${BARE_MAX.toFixed(3)} * smoothstep( ${BARE_CUT_M[0].toFixed(3)}, ${BARE_CUT_M[1].toFixed(3)}, - vEarthwork.y ) * ( 1.0 - smoothstep( ${BARE_RISE_M[0].toFixed(3)}, ${BARE_RISE_M[1].toFixed(3)}, ewRise ) );
    float ewShoulder = ( 1.0 - smoothstep( ${SHOULDER_M[0].toFixed(3)}, ${SHOULDER_M[1].toFixed(3)}, vEarthwork.z ) ) * clamp( ( vEarthwork.x - ${EARTHWORK_WEIGHT_FROM_X.toFixed(6)} ) / ${(SHOULDER_FULL_X - EARTHWORK_WEIGHT_FROM_X).toFixed(6)}, 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.0, ${SHOULDER_FILL_M.toFixed(3)}, vEarthwork.y ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, uEarthworkFace * ewShade, ewBare * ewWeight );
    diffuseColor.rgb = mix( diffuseColor.rgb, uEarthworkBed * ewShade, ewShoulder );
  }
}
`;

export function createEarthworkChunk(uniforms: EarthworkUniforms): ShaderChunk {
  return {
    key: "terrain-earthwork-v2",
    patch(shader) {
      Object.assign(shader.uniforms, uniforms);
      ensureEarthworkVarying(shader);
      shader.fragmentShader = inject(shader.fragmentShader, "#include <common>", FRAGMENT_PARS, "after");
      shader.fragmentShader = inject(shader.fragmentShader, ALBEDO_ANCHOR, FRAGMENT_MAIN, "before");
    },
  };
}

type Rgb = readonly [number, number, number];

function linear(hex: number): Rgb {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

/**
 * Mirror of the fragment chunk (linear RGB): `under` is the splatted colour (the grass
 * where the splat faded its surfaces), `attr` the interpolated attribute and `normalY`
 * the smooth world normal's y.
 */
export function earthworkAlbedo(under: Rgb, attr: Rgb, normalY: number): [number, number, number] {
  const w = earthworkWeightOf(attr[0]);
  if (w <= 0) return [under[0], under[1], under[2]];
  const steep = 1 - smoothstep(STEEP_NORMAL_Y[0], STEEP_NORMAL_Y[1], normalY);
  const grass = linear(palette.grass);
  const light = linear(palette.grassLight);
  const face = linear(palette.earthworkFace);
  const bed = linear(palette.earthworkBed);
  const luma = (c: Rgb) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
  const shade = Math.min(SHADE_MAX, Math.max(SHADE_MIN, luma(under) / Math.max(luma(grass), 1e-3)));
  const bare = BARE_MAX * smoothstep(BARE_CUT_M[0], BARE_CUT_M[1], -attr[1]) * (1 - smoothstep(BARE_RISE_M[0], BARE_RISE_M[1], slopeRiseM(attr[2])));
  const shoulder =
    (1 - smoothstep(SHOULDER_M[0], SHOULDER_M[1], attr[2])) *
    Math.min(1, Math.max(0, (attr[0] - EARTHWORK_WEIGHT_FROM_X) / (SHOULDER_FULL_X - EARTHWORK_WEIGHT_FROM_X))) *
    (1 - smoothstep(0, SHOULDER_FILL_M, attr[1]));
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    let v = under[i]! * (1 + (light[i]! / grass[i]! - 1) * SLOPE_TINT * steep * w);
    v += (face[i]! * shade - v) * bare * w;
    v += (bed[i]! * shade - v) * shoulder;
    out[i] = v;
  }
  return out;
}
