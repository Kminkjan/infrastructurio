import { Color, type IUniform } from "three";
import { palette } from "../palette";
import { ALBEDO_ANCHOR, type ShaderChunk, inject } from "./chunk";

/**
 * Earthwork faces on the terrain (earthworks-lite, `render/terrain/earthworks.ts`).
 * The terrain geometry carries an `earthwork` vertex attribute: how far the
 * conform moved the ground there, as an unclamped ramp (≤ 0 on natural ground,
 * 1 from 0.5 m of cut or fill). It is clamped per fragment, after interpolation,
 * so the edge of a cutting follows a smooth contour instead of the sub-lattice's
 * triangles. Installed after the splat, it replaces the splat's albedo (fields,
 * roads, forest floor, the AO tint) by that weight with the earthwork colour,
 * slope-based like the terrain: `earthworkBed` on the flat formation,
 * `earthworkFace` on cut and fill slopes, chosen by the smooth world normal.
 * Natural ground (weight ≤ 0) is untouched.
 */

/** World normal y at and above which the ground is bed, and at and below which it is face (a 1 : 1.5 slope is 0.83). */
export const EARTHWORK_BED_NORMAL_Y = 0.97;
export const EARTHWORK_FACE_NORMAL_Y = 0.88;

export interface EarthworkUniforms {
  readonly uEarthworkBed: IUniform<Color>;
  readonly uEarthworkFace: IUniform<Color>;
}

export function createEarthworkUniforms(): EarthworkUniforms {
  const u: EarthworkUniforms = { uEarthworkBed: { value: new Color() }, uEarthworkFace: { value: new Color() } };
  syncEarthworkColors(u);
  return u;
}

/** Copies the palette into the colour uniforms (after a tweak-panel override, too). */
export function syncEarthworkColors(u: EarthworkUniforms): void {
  u.uEarthworkBed.value.setHex(palette.earthworkBed);
  u.uEarthworkFace.value.setHex(palette.earthworkFace);
}

const VERTEX_PARS = /* glsl */ `
attribute float earthwork;
varying float vEarthwork;
`;

const VERTEX_MAIN = /* glsl */ `
vEarthwork = earthwork;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform vec3 uEarthworkBed;
uniform vec3 uEarthworkFace;
varying float vEarthwork;
`;

const FRAGMENT_MAIN = /* glsl */ `
{
  float earthworkWeight = clamp( vEarthwork, 0.0, 1.0 );
  vec3 earthworkUp = inverseTransformDirection( normalize( vNormal ), viewMatrix );
  float earthworkFace = 1.0 - smoothstep( ${EARTHWORK_FACE_NORMAL_Y.toFixed(3)}, ${EARTHWORK_BED_NORMAL_Y.toFixed(3)}, earthworkUp.y );
  diffuseColor.rgb = mix( diffuseColor.rgb, mix( uEarthworkBed, uEarthworkFace, earthworkFace ), earthworkWeight );
}
`;

/** Name of the vertex attribute every terrain chunk geometry carries (zeros where nothing moved). */
export const EARTHWORK_ATTRIBUTE = "earthwork";

export function createEarthworkChunk(uniforms: EarthworkUniforms): ShaderChunk {
  return {
    key: "terrain-earthwork-v1",
    patch(shader) {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = inject(shader.vertexShader, "#include <common>", VERTEX_PARS, "after");
      shader.vertexShader = inject(shader.vertexShader, "#include <begin_vertex>", VERTEX_MAIN, "after");
      shader.fragmentShader = inject(shader.fragmentShader, "#include <common>", FRAGMENT_PARS, "after");
      shader.fragmentShader = inject(shader.fragmentShader, ALBEDO_ANCHOR, FRAGMENT_MAIN, "before");
    },
  };
}

/** The albedo the fragment chunk produces (linear RGB), for tests: `under` is the splatted colour. */
export function earthworkAlbedo(under: readonly [number, number, number], ramp: number, normalY: number): [number, number, number] {
  const w = Math.min(1, Math.max(0, ramp));
  const t = Math.min(1, Math.max(0, (normalY - EARTHWORK_FACE_NORMAL_Y) / (EARTHWORK_BED_NORMAL_Y - EARTHWORK_FACE_NORMAL_Y)));
  const face = 1 - t * t * (3 - 2 * t);
  const bed = new Color(palette.earthworkBed);
  const faceColour = new Color(palette.earthworkFace);
  const earth = [bed.r + (faceColour.r - bed.r) * face, bed.g + (faceColour.g - bed.g) * face, bed.b + (faceColour.b - bed.b) * face];
  return [0, 1, 2].map((i) => (under[i] ?? 0) + ((earth[i] ?? 0) - (under[i] ?? 0)) * w) as [number, number, number];
}
