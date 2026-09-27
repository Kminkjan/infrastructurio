import { Color, type IUniform, type Texture, Vector2 } from "three";
import { palette } from "../palette";
import { ALBEDO_ANCHOR, type ShaderChunk, ensureArtWorld, inject } from "./chunk";
import { ensureEarthworkVarying } from "./earthwork";
import { GROUND_DETAIL_PARS, type GroundDetailUniforms } from "./groundDetail";
import { smoothstep } from "../../math";

/**
 * The terrain splat (art direction "Terrain and water"): data textures painted
 * from the scenario replace the grass albedo with dirt, cobble, field and
 * forest-floor colours from the palette, then a world AO tint map darkens
 * ground under trees and around buildings.
 *
 * - `uSplatMap` RGBA8, 1 m per texel, filtered: weights for dirt (R), cobble
 *   (G), field (B) and forest floor (A).
 * - `uFieldMap` RG8, same grid, read with `texelFetch` (categorical, never
 *   filtered): crop index (0–3) and furrow heading (0–5, lines at k·30°).
 * - `uAoMap` R8 over the map: ambient-occlusion weight.
 *
 * Splat colours keep the vertex colour's relative brightness, so the baked
 * hollow AO and height shading still show under roads and fields. Furrows are
 * a cosine stripe across each field's heading, faded to its mean by its screen
 * frequency (`fwidth`) so it never aliases. `splatAlbedo` and `furrowStripe`
 * mirror the GLSL for tests.
 *
 * Terrain look variants (2026-09-27) opt into two extras; without them the
 * GLSL and cache key are exactly D11a's:
 * - `crisp`: the 1 m splat is bilinear, so at Default and Close zoom its edges
 *   blur over 6–12 px. Fields and cobbles are cut at weight 0.5 and roads and
 *   yards at 0.45 (keeping the yard's partial weight), and the forest floor at
 *   a noisy level, each over one pixel (`crispSplatWeight` mirrors it).
 * - `detail`: runs `groundDetail` on the grass before any surface is laid.
 *
 * The terrain material always adds a third (render pass iteration, 2026-09-27):
 * - `earthwork`: reads the terrain's `earthwork` attribute (see
 *   `shaderChunks/earthwork.ts`) and fades the surfaces and the AO tint by its
 *   earthwork weight, and the grass detail's slope soil by its lip, so cuttings
 *   and embankments keep the grass (and its detail) instead of fields, roads,
 *   forest floor or a frayed soil rim. Off earthworks the colour is unchanged.
 */

export const FURROW_SPACING_M = 1.4;
export const FURROW_STRENGTH = 0.12;
export const AO_STRENGTH = 0.38;
/** Furrows fade out between these screen frequencies (cycles per pixel; Nyquist is 0.5). */
export const FURROW_FADE_CYCLES_PER_PX = [0.3, 0.5] as const;
const LUMA = [0.2126, 0.7152, 0.0722] as const;
const SHADE_MIN = 0.75;
const SHADE_MAX = 1.15;

export interface SplatUniforms {
  readonly uSplatMap: IUniform<Texture | null>;
  readonly uFieldMap: IUniform<Texture | null>;
  readonly uAoMap: IUniform<Texture | null>;
  /** Plan metres the splat and field textures span (texels × texel size). */
  readonly uSplatSizeM: IUniform<Vector2>;
  /** Plan metres the AO map spans. */
  readonly uAoSizeM: IUniform<Vector2>;
  readonly uSplatDirt: IUniform<Color>;
  readonly uSplatCobble: IUniform<Color>;
  readonly uSplatCobbleDark: IUniform<Color>;
  readonly uSplatForestFloor: IUniform<Color>;
  readonly uSplatGrassRef: IUniform<Color>;
  readonly uSplatCrops: IUniform<Color[]>;
  readonly uFurrowNormals: IUniform<Vector2[]>;
  readonly uFurrowSpacing: IUniform<number>;
  readonly uFurrowStrength: IUniform<number>;
  readonly uAoStrength: IUniform<number>;
}

/** Unit normals of the six furrow line directions (k·30°), in sim plan (x east, y north). */
export function furrowNormals(): Vector2[] {
  return [0, 1, 2, 3, 4, 5].map((k) => {
    const angle = (k * Math.PI) / 6;
    return new Vector2(-Math.sin(angle), Math.cos(angle));
  });
}

export function createSplatUniforms(): SplatUniforms {
  const uniforms: SplatUniforms = {
    uSplatMap: { value: null },
    uFieldMap: { value: null },
    uAoMap: { value: null },
    uSplatSizeM: { value: new Vector2(1, 1) },
    uAoSizeM: { value: new Vector2(1, 1) },
    uSplatDirt: { value: new Color() },
    uSplatCobble: { value: new Color() },
    uSplatCobbleDark: { value: new Color() },
    uSplatForestFloor: { value: new Color() },
    uSplatGrassRef: { value: new Color() },
    uSplatCrops: { value: [new Color(), new Color(), new Color(), new Color()] },
    uFurrowNormals: { value: furrowNormals() },
    uFurrowSpacing: { value: FURROW_SPACING_M },
    uFurrowStrength: { value: FURROW_STRENGTH },
    uAoStrength: { value: AO_STRENGTH },
  };
  syncSplatColors(uniforms);
  return uniforms;
}

/** Copies the palette into the colour uniforms (after a tweak-panel override, too). */
export function syncSplatColors(u: SplatUniforms): void {
  u.uSplatDirt.value.setHex(palette.dirtRoad);
  u.uSplatCobble.value.setHex(palette.cobble);
  u.uSplatCobbleDark.value.setHex(palette.cobbleDark);
  u.uSplatForestFloor.value.setHex(palette.forestFloor);
  u.uSplatGrassRef.value.setHex(palette.grass);
  const crops = [palette.rye, palette.hay, palette.crop, palette.fallow];
  u.uSplatCrops.value.forEach((c, i) => c.setHex(crops[i] ?? palette.crop));
}

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uSplatMap;
uniform sampler2D uFieldMap;
uniform sampler2D uAoMap;
uniform vec2 uSplatSizeM;
uniform vec2 uAoSizeM;
uniform vec3 uSplatDirt;
uniform vec3 uSplatCobble;
uniform vec3 uSplatCobbleDark;
uniform vec3 uSplatForestFloor;
uniform vec3 uSplatGrassRef;
uniform vec3 uSplatCrops[ 4 ];
uniform vec2 uFurrowNormals[ 6 ];
uniform float uFurrowSpacing;
uniform float uFurrowStrength;
uniform float uAoStrength;

float splatHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

// Smooth 2D value noise in [0, 1]: stone-to-stone tone variation in the cobbles.
float splatNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( splatHash( i ), splatHash( i + vec2( 1, 0 ) ), u.x ), mix( splatHash( i + vec2( 0, 1 ) ), splatHash( i + vec2( 1, 1 ) ), u.x ), u.y );
}
`;

/** The crisp-mode cut levels on the splat weights (see `crispSplatWeight`). */
export const SPLAT_CUTS = { dirt: 0.45, cobble: 0.5, field: 0.5, forestFloor: [0.2, 0.4] } as const;

const CRISP_PARS = /* glsl */ `
// 1 where x > 0, 0 where x < 0, over about one pixel of x's screen gradient.
float splatCut( float x ) {
  float w = max( fwidth( x ), 1e-4 );
  return smoothstep( - w, w, x );
}
`;

// Cuts the bilinear 1 m weights to pixel-crisp edges. Roads and yards keep their weight
// past the cut (yards are painted at 0.55); fields and cobbles become all or nothing; the
// forest floor's edge frays with a 4 m noise.
const CRISP_MAIN = /* glsl */ `  splat.r *= splatCut( splat.r - ${SPLAT_CUTS.dirt.toFixed(2)} );
  splat.g = splatCut( splat.g - ${SPLAT_CUTS.cobble.toFixed(2)} );
  splat.b = splatCut( splat.b - ${SPLAT_CUTS.field.toFixed(2)} );
  splat.a *= splatCut( splat.a - mix( ${SPLAT_CUTS.forestFloor[0].toFixed(2)}, ${SPLAT_CUTS.forestFloor[1].toFixed(2)}, splatNoise( splatXY / 4.0 + 11.0 ) ) );
`;

// The grass detail runs on the vertex colour before any surface is laid over it; the
// surfaces keep their shade from the undetailed grass, so no patch shows through a road.
function detailMain(earthwork: boolean): string {
  return /* glsl */ `  #ifdef FLAT_SHADED
  float splatUp = abs( normalize( cross( dFdx( vArtWorld ), dFdy( vArtWorld ) ) ).y );
  #else
  float splatUp = ( vec4( normalize( vNormal ), 0.0 ) * viewMatrix ).y;
  #endif
  base = groundDetail( base, splatXY, vArtWorld.y, splatUp, ${earthwork ? "1.0 - splatLip" : "1.0"} );
`;
}

// Earthworks keep the grass: surfaces fade by the earthwork weight, the slope soil by the lip.
const EARTHWORK_MAIN = /* glsl */ `  float splatEarthwork = earthworkWeight();
  float splatLip = earthworkLip();
  splat *= 1.0 - splatEarthwork;
`;

function fragmentMain(crisp: boolean, detail: boolean, earthwork: boolean): string {
  return /* glsl */ `
{
  vec2 splatXY = vec2( vArtWorld.x, -vArtWorld.z );
  vec2 splatUv = splatXY / uSplatSizeM;
  vec4 splat = texture( uSplatMap, splatUv );
${crisp ? CRISP_MAIN : ""}${earthwork ? EARTHWORK_MAIN : ""}  vec3 luma = vec3( ${LUMA.join(", ")} );
  float shade = clamp( dot( diffuseColor.rgb, luma ) / max( dot( uSplatGrassRef, luma ), 1e-3 ), ${SHADE_MIN.toFixed(2)}, ${SHADE_MAX.toFixed(2)} );
  ivec2 fieldSize = textureSize( uFieldMap, 0 );
  ivec2 fieldTexel = clamp( ivec2( floor( splatUv * vec2( fieldSize ) ) ), ivec2( 0 ), fieldSize - 1 );
  vec2 fieldInfo = texelFetch( uFieldMap, fieldTexel, 0 ).rg * 255.0;
  int crop = clamp( int( fieldInfo.r + 0.5 ), 0, 3 );
  int furrow = clamp( int( fieldInfo.g + 0.5 ), 0, 5 );
  // Furrows fade to their mean as they approach the pixel Nyquist limit (0.5 cycles per
  // pixel), so Far and Region zooms show flat crop colour instead of moiré.
  float furrowPhase = dot( splatXY, uFurrowNormals[ furrow ] ) / uFurrowSpacing;
  float stripe = 0.5 + 0.5 * cos( 6.28318530718 * furrowPhase );
  stripe = mix( 0.5, stripe, 1.0 - smoothstep( ${FURROW_FADE_CYCLES_PER_PX[0].toFixed(2)}, ${FURROW_FADE_CYCLES_PER_PX[1].toFixed(2)}, fwidth( furrowPhase ) ) );
  vec3 field = uSplatCrops[ crop ] * ( 1.0 - uFurrowStrength * stripe );
  vec3 cobble = mix( uSplatCobble, uSplatCobbleDark, splatNoise( splatXY * 1.6 ) );
  vec3 base = diffuseColor.rgb;
${detail ? detailMain(earthwork) : ""}  base = mix( base, uSplatForestFloor * shade, splat.a );
  base = mix( base, field * shade, splat.b );
  base = mix( base, uSplatDirt * shade, splat.r );
  base = mix( base, cobble * shade, splat.g );
  diffuseColor.rgb = base * ( 1.0 - uAoStrength * texture( uAoMap, splatXY / uAoSizeM ).r${earthwork ? " * ( 1.0 - splatEarthwork )" : ""} );
}
`;
}

export interface SplatOptions {
  /** Pixel-crisp surface edges (terrain look variants). */
  readonly crisp?: boolean;
  /** Ground detail on the grass under the surfaces (terrain look variants). */
  readonly detail?: GroundDetailUniforms;
  /** Keep the grass on earthworks (reads the terrain's `earthwork` attribute; the terrain material always sets it). */
  readonly earthwork?: boolean;
}

/** Without options this is D11a's splat, GLSL and cache key unchanged. */
export function createSplatChunk(uniforms: SplatUniforms, options: SplatOptions = {}): ShaderChunk {
  const crisp = options.crisp === true;
  const detail = options.detail;
  const earthwork = options.earthwork === true;
  const extras = `${crisp ? "-crisp" : ""}${detail ? "-detail" : ""}${earthwork ? "-earthwork" : ""}`;
  const pars = `${FRAGMENT_PARS}${crisp ? CRISP_PARS : ""}${detail ? GROUND_DETAIL_PARS : ""}`;
  const main = fragmentMain(crisp, detail !== undefined, earthwork);
  return {
    key: extras === "" ? "terrain-splat-v2" : `terrain-splat-v4${extras}`,
    patch(shader) {
      Object.assign(shader.uniforms, uniforms);
      if (detail) Object.assign(shader.uniforms, detail);
      ensureArtWorld(shader);
      if (earthwork) ensureEarthworkVarying(shader);
      shader.fragmentShader = inject(shader.fragmentShader, "#include <common>", pars, "after");
      shader.fragmentShader = inject(shader.fragmentShader, ALBEDO_ANCHOR, main, "before");
    },
  };
}

type Rgb = readonly [number, number, number];

/** Splat weights in 0–1 as the shader reads them. */
export interface SplatWeights {
  readonly dirt: number;
  readonly cobble: number;
  readonly field: number;
  readonly forestFloor: number;
}

/**
 * The albedo the shader produces from a vertex colour, splat weights and the
 * surface colours (all linear), before the AO tint. Mirrors the GLSL mix order:
 * forest floor, then field, dirt and cobble on top.
 */
export function splatAlbedo(
  vertex: Rgb,
  w: SplatWeights,
  colours: { readonly grassRef: Rgb; readonly forestFloor: Rgb; readonly field: Rgb; readonly dirt: Rgb; readonly cobble: Rgb },
): [number, number, number] {
  const luma = (c: Rgb) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
  const shade = Math.min(SHADE_MAX, Math.max(SHADE_MIN, luma(vertex) / Math.max(luma(colours.grassRef), 1e-3)));
  let base: [number, number, number] = [vertex[0], vertex[1], vertex[2]];
  const mixIn = (c: Rgb, t: number) => {
    base = base.map((v, i) => v + ((c[i] ?? 0) * shade - v) * t) as [number, number, number];
  };
  mixIn(colours.forestFloor, w.forestFloor);
  mixIn(colours.field, w.field);
  mixIn(colours.dirt, w.dirt);
  mixIn(colours.cobble, w.cobble);
  return base;
}

/**
 * The furrow stripe (0–1) at sim plan (x, y) for furrow heading k (0–5), at a
 * screen frequency of `cyclesPerPx` (the shader's `fwidth` of the phase; 0 is
 * an unfiltered stripe).
 */
export function furrowStripe(x: number, y: number, k: number, spacing = FURROW_SPACING_M, cyclesPerPx = 0): number {
  const angle = (k * Math.PI) / 6;
  const stripe = 0.5 + 0.5 * Math.cos((2 * Math.PI * (x * -Math.sin(angle) + y * Math.cos(angle))) / spacing);
  const [e0, e1] = FURROW_FADE_CYCLES_PER_PX;
  const t = Math.min(1, Math.max(0, (cyclesPerPx - e0) / (e1 - e0)));
  return 0.5 + (stripe - 0.5) * (1 - t * t * (3 - 2 * t));
}

/**
 * Mirror of the crisp mode's cut on one splat weight `w` whose screen footprint is `fw`
 * (the shader's fwidth; 0 = a hard step): roads and yards keep their weight past the cut,
 * fields and cobbles become all or nothing, the forest floor keeps its weight past a cut
 * level between SPLAT_CUTS.forestFloor chosen by `noise` (0–1).
 */
export function crispSplatWeight(channel: keyof SplatWeights, w: number, fw = 0, noise = 0.5): number {
  const cut = (x: number) => (fw <= 0 ? (x > 0 ? 1 : x < 0 ? 0 : 0.5) : smoothstep(0, 1, (x + fw) / (2 * fw)));
  switch (channel) {
    case "dirt":
      return w * cut(w - SPLAT_CUTS.dirt);
    case "cobble":
      return cut(w - SPLAT_CUTS.cobble);
    case "field":
      return cut(w - SPLAT_CUTS.field);
    case "forestFloor": {
      const [lo, hi] = SPLAT_CUTS.forestFloor;
      return w * cut(w - (lo + (hi - lo) * noise));
    }
  }
}
