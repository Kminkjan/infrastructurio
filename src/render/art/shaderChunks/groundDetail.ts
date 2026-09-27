import { Color, type IUniform, Vector2 } from "three";
import { palette } from "../palette";

/**
 * Crisp ground detail on the grass (terrain look variants, 2026-09-27). The
 * D11a grass is baked per 5 m lattice node, so every variation it has is at
 * least 5 m soft, and its 70 m patches read as blotches. This adds calm,
 * pixel-crisp detail in the shader, all from palette colours, on the grass
 * only (the splat chunk runs it on the vertex colour before laying fields,
 * roads, cobbles and forest floor over it):
 *
 * 1. tone patches (about 16 m, broken up at 5 m) cut at two levels into
 *    lighter and darker grass, with edges one pixel wide at any zoom;
 * 2. sparse darker tufts (static-grass dots about 0.5 m across, one chance
 *    per 1.6 m cell) that fade out before they shrink under 2 px;
 * 3. meadow flecks that grow denser uphill (the cut level falls with height),
 *    so hilltops read by colour as well as by light;
 * 4. soil on steep banks: a slope cut frayed by noise;
 * 5. a wet, darker soil band where a bank meets the water.
 *
 * Cuts are antialiased with `fwidth` of the cut function, so they stay crisp
 * without aliasing at Far. Colours are mixed toward palette targets scaled by
 * the grass's relative brightness (as the splat does), so the baked hollows
 * and height shading still show. The splat chunk includes `GROUND_DETAIL_PARS`
 * and calls `groundDetail`; `groundDetailAlbedo` mirrors the GLSL for tests
 * (with hard cuts: the mirror has no pixel footprint).
 */

export interface GroundDetailUniforms {
  readonly uGdGrass: IUniform<Color>;
  readonly uGdGrassLight: IUniform<Color>;
  readonly uGdGrassShade: IUniform<Color>;
  readonly uGdMeadow: IUniform<Color>;
  readonly uGdSoil: IUniform<Color>;
  /** Crisp tone patches, 0–1. */
  readonly uGdPatch: IUniform<number>;
  readonly uGdPatchCellM: IUniform<number>;
  /** Share of 1.6 m cells holding a tuft, 0–1 (0 = none). */
  readonly uGdTufts: IUniform<number>;
  /** Meadow flecks, 0–1. */
  readonly uGdMeadowAmount: IUniform<number>;
  /** Flecks begin at x and are densest from y (world height, m). */
  readonly uGdMeadowM: IUniform<Vector2>;
  /** Soil on steep ground, 0–1. */
  readonly uGdSlopeSoil: IUniform<number>;
  /** Cosines of the slope angles: steeper than x always, gentler than y never show soil; noise picks between. */
  readonly uGdSlopeCos: IUniform<Vector2>;
  /** The wet band above the water, 0–1. */
  readonly uGdWaterline: IUniform<number>;
  /** Water level (world y, m). */
  readonly uGdWaterLevel: IUniform<number>;
}

export interface GroundDetailSettings {
  readonly patch: number;
  readonly patchCellM: number;
  readonly tufts: number;
  readonly meadow: number;
  readonly meadowM: readonly [number, number];
  readonly slopeSoil: number;
  /** [always, never]: soil on slopes steeper than the first angle, never below the second. */
  readonly slopeDeg: readonly [number, number];
  readonly waterline: number;
}

/** Detail off: `groundDetail` returns its input unchanged. */
export const NO_GROUND_DETAIL: GroundDetailSettings = { patch: 0, patchCellM: 16, tufts: 0, meadow: 0, meadowM: [22, 34], slopeSoil: 0, slopeDeg: [16, 10], waterline: 0 };

/** How far each detail layer moves toward its target at full amount. */
export const DETAIL_MIX = { light: 0.18, dark: 0.12, tuft: 0.3, meadow: 0.35, soil: 0.35, wet: 0.72 } as const;
/** The patches' second octave: cells this share of the patch cell, with this weight. */
export const PATCH_FINE_RATIO = 0.31;
export const PATCH_FINE_WEIGHT = 0.35;
/** The meadow flecks take this weight of the patches' second octave on top of their own 6.5 m noise. */
export const MEADOW_FINE_WEIGHT = 0.3;
/** Tufts: one chance per cell of this size (m), a dot of this radius (m), fading out between these on-screen diameters (px). */
export const TUFT_CELL_M = 1.6;
export const TUFT_RADIUS_M = 0.26;
export const TUFT_FADE_PX = [1.5, 3] as const;
/** Patch cut levels on the patch noise: above `light` lighter grass, below `dark` darker. */
export const PATCH_CUTS = { light: 0.6, dark: 0.4 } as const;
/** Meadow cut level on the fleck noise at and below the lower height, and from the upper one. */
export const MEADOW_CUTS = [0.95, 0.72] as const;
/** The wet band reaches this far above the water level, plus up to `WET_NOISE_M`. */
export const WET_BAND_M = 0.25;
export const WET_NOISE_M = 0.2;
const LUMA = [0.2126, 0.7152, 0.0722] as const;
const SHADE_MIN = 0.75;
const SHADE_MAX = 1.15;

export function createGroundDetailUniforms(settings: GroundDetailSettings = NO_GROUND_DETAIL, waterLevelM = 10): GroundDetailUniforms {
  const u: GroundDetailUniforms = {
    uGdGrass: { value: new Color() },
    uGdGrassLight: { value: new Color() },
    uGdGrassShade: { value: new Color() },
    uGdMeadow: { value: new Color() },
    uGdSoil: { value: new Color() },
    uGdPatch: { value: 0 },
    uGdPatchCellM: { value: 16 },
    uGdTufts: { value: 0 },
    uGdMeadowAmount: { value: 0 },
    uGdMeadowM: { value: new Vector2() },
    uGdSlopeSoil: { value: 0 },
    uGdSlopeCos: { value: new Vector2() },
    uGdWaterline: { value: 0 },
    uGdWaterLevel: { value: waterLevelM },
  };
  applyGroundDetailSettings(u, settings);
  syncGroundDetailColors(u);
  return u;
}

export function applyGroundDetailSettings(u: GroundDetailUniforms, s: GroundDetailSettings): void {
  u.uGdPatch.value = s.patch;
  u.uGdPatchCellM.value = s.patchCellM;
  u.uGdTufts.value = s.tufts;
  u.uGdMeadowAmount.value = s.meadow;
  u.uGdMeadowM.value.set(s.meadowM[0], s.meadowM[1]);
  u.uGdSlopeSoil.value = s.slopeSoil;
  u.uGdSlopeCos.value.set(Math.cos((s.slopeDeg[0] * Math.PI) / 180), Math.cos((s.slopeDeg[1] * Math.PI) / 180));
  u.uGdWaterline.value = s.waterline;
}

/** Copies the palette into the colour uniforms (after a tweak-panel override, too). */
export function syncGroundDetailColors(u: GroundDetailUniforms): void {
  u.uGdGrass.value.setHex(palette.grass);
  u.uGdGrassLight.value.setHex(palette.grassLight);
  u.uGdGrassShade.value.setHex(palette.grassShade);
  u.uGdMeadow.value.setHex(palette.meadow);
  u.uGdSoil.value.setHex(palette.soil);
}

export const GROUND_DETAIL_PARS = /* glsl */ `
uniform vec3 uGdGrass;
uniform vec3 uGdGrassLight;
uniform vec3 uGdGrassShade;
uniform vec3 uGdMeadow;
uniform vec3 uGdSoil;
uniform float uGdPatch;
uniform float uGdPatchCellM;
uniform float uGdTufts;
uniform float uGdMeadowAmount;
uniform vec2 uGdMeadowM;
uniform float uGdSlopeSoil;
uniform vec2 uGdSlopeCos;
uniform float uGdWaterline;
uniform float uGdWaterLevel;

float gdHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

// Smooth 2D value noise in [0, 1].
float gdNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( gdHash( i ), gdHash( i + vec2( 1, 0 ) ), u.x ), mix( gdHash( i + vec2( 0, 1 ) ), gdHash( i + vec2( 1, 1 ) ), u.x ), u.y );
}

// 1 where x > 0, 0 where x < 0, over about one pixel of x's own screen gradient.
float gdCut( float x ) {
  float w = max( fwidth( x ), 1e-4 );
  return smoothstep( - w, w, x );
}

// base: the grass albedo (linear), p: sim plan (m), h: world height (m), up: world normal y.
// Three value noises in all (16 m and 5 m for the patches, 6.5 m for flecks and fraying),
// shared between layers; each layer sits behind a uniform branch, so a zero amount costs nothing.
vec3 groundDetail( vec3 base, vec2 p, float h, float up ) {
  vec3 luma = vec3( ${LUMA.join(", ")} );
  float shade = clamp( dot( base, luma ) / max( dot( uGdGrass, luma ), 1e-3 ), ${SHADE_MIN.toFixed(2)}, ${SHADE_MAX.toFixed(2)} );
  float nFine = 0.0;
  if ( uGdPatch > 0.0 || uGdMeadowAmount > 0.0 ) nFine = gdNoise( p / ( ${PATCH_FINE_RATIO.toFixed(2)} * uGdPatchCellM ) + 17.0 );
  if ( uGdPatch > 0.0 ) {
    float n = ${(1 - PATCH_FINE_WEIGHT).toFixed(2)} * gdNoise( p / uGdPatchCellM ) + ${PATCH_FINE_WEIGHT.toFixed(2)} * nFine;
    base *= mix( vec3( 1.0 ), uGdGrassLight / uGdGrass, ${DETAIL_MIX.light.toFixed(2)} * uGdPatch * gdCut( n - ${PATCH_CUTS.light.toFixed(2)} ) );
    base *= mix( vec3( 1.0 ), uGdGrassShade / uGdGrass, ${DETAIL_MIX.dark.toFixed(2)} * uGdPatch * gdCut( ${PATCH_CUTS.dark.toFixed(2)} - n ) );
  }
  if ( uGdTufts > 0.0 ) {
    vec2 tuftCell = p / ${TUFT_CELL_M.toFixed(2)};
    vec2 tuftId = floor( tuftCell );
    vec2 tuftAt = tuftId + 0.2 + 0.6 * vec2( gdHash( tuftId + 13.0 ), gdHash( tuftId + 29.0 ) );
    float tuftPx = max( fwidth( tuftCell.x ), 1e-4 );
    float tuftR = ${(TUFT_RADIUS_M / TUFT_CELL_M).toFixed(4)};
    float tuft = 1.0 - smoothstep( tuftR - tuftPx, tuftR + tuftPx, length( tuftCell - tuftAt ) );
    tuft *= step( gdHash( tuftId + 71.0 ), uGdTufts ) * smoothstep( ${TUFT_FADE_PX[0].toFixed(1)}, ${TUFT_FADE_PX[1].toFixed(1)}, 2.0 * tuftR / tuftPx );
    base *= mix( vec3( 1.0 ), uGdGrassShade / uGdGrass, ${DETAIL_MIX.tuft.toFixed(2)} * tuft );
  }
  if ( uGdMeadowAmount > 0.0 || uGdSlopeSoil > 0.0 || uGdWaterline > 0.0 ) {
    float nFleck = gdNoise( p / 6.5 + 41.0 );
    if ( uGdMeadowAmount > 0.0 ) {
      float m = ${(1 - MEADOW_FINE_WEIGHT).toFixed(2)} * nFleck + ${MEADOW_FINE_WEIGHT.toFixed(2)} * nFine;
      float meadowCut = mix( ${MEADOW_CUTS[0].toFixed(2)}, ${MEADOW_CUTS[1].toFixed(2)}, smoothstep( uGdMeadowM.x, uGdMeadowM.y, h ) );
      base = mix( base, uGdMeadow * shade, ${DETAIL_MIX.meadow.toFixed(2)} * uGdMeadowAmount * gdCut( m - meadowCut ) );
    }
    if ( uGdSlopeSoil > 0.0 ) {
      float slopeCos = mix( uGdSlopeCos.x, uGdSlopeCos.y, nFleck );
      base = mix( base, uGdSoil * shade, ${DETAIL_MIX.soil.toFixed(2)} * uGdSlopeSoil * gdCut( slopeCos - up ) );
    }
    if ( uGdWaterline > 0.0 ) {
      float wetTop = uGdWaterLevel + ${WET_BAND_M.toFixed(2)} + ${WET_NOISE_M.toFixed(2)} * nFleck;
      base = mix( base, uGdSoil * ${DETAIL_MIX.wet.toFixed(2)} * shade, uGdWaterline * gdCut( wetTop - h ) );
    }
  }
  return base;
}
`;

function fract(x: number): number {
  return x - Math.floor(x);
}

/** Mirror of `gdHash` (float64; the GPU's float32 differs in the last bits). */
export function gdHash(x: number, y: number): number {
  let a = fract(x * 0.1031);
  let b = fract(y * 0.1031);
  let c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return fract((a + b) * c);
}

/** Mirror of `gdNoise`: smooth value noise in [0, 1]. */
export function gdNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const s = (t: number) => t * t * (3 - 2 * t);
  const ux = s(x - ix);
  const uy = s(y - iy);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(lerp(gdHash(ix, iy), gdHash(ix + 1, iy), ux), lerp(gdHash(ix, iy + 1), gdHash(ix + 1, iy + 1), ux), uy);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Mirror of `gdCut` for a given screen footprint `w` of x (0 = a hard step). */
export function gdCut(x: number, w = 0): number {
  if (w <= 0) return x > 0 ? 1 : x < 0 ? 0 : 0.5;
  return smoothstep(-w, w, x);
}

type Rgb = readonly [number, number, number];

export interface GroundDetailColours {
  readonly grass: Rgb;
  readonly grassLight: Rgb;
  readonly grassShade: Rgb;
  readonly meadow: Rgb;
  readonly soil: Rgb;
}

/** Linear palette colours for the mirror. */
export function groundDetailColours(): GroundDetailColours {
  const rgb = (hex: number): Rgb => {
    const c = new Color(hex);
    return [c.r, c.g, c.b];
  };
  return { grass: rgb(palette.grass), grassLight: rgb(palette.grassLight), grassShade: rgb(palette.grassShade), meadow: rgb(palette.meadow), soil: rgb(palette.soil) };
}

/**
 * Mirror of the tuft term: 1 inside a tuft, 0 outside, at sim plan (x, y) with
 * `density` (0–1) and a screen footprint of `metresPerPx` (0 = a hard edge and
 * no fade; tufts fade out as their diameter drops from 3 to 1.5 px).
 */
export function tuftAt(x: number, y: number, density: number, metresPerPx = 0): number {
  const cx = x / TUFT_CELL_M;
  const cy = y / TUFT_CELL_M;
  const ix = Math.floor(cx);
  const iy = Math.floor(cy);
  const ax = ix + 0.2 + 0.6 * gdHash(ix + 13, iy + 13);
  const ay = iy + 0.2 + 0.6 * gdHash(ix + 29, iy + 29);
  const r = TUFT_RADIUS_M / TUFT_CELL_M;
  const d = Math.hypot(cx - ax, cy - ay);
  const px = metresPerPx / TUFT_CELL_M;
  const inside = px <= 0 ? (d < r ? 1 : 0) : 1 - smoothstep(r - px, r + px, d);
  const present = gdHash(ix + 71, iy + 71) <= density ? 1 : 0;
  const legible = px <= 0 ? 1 : smoothstep(TUFT_FADE_PX[0], TUFT_FADE_PX[1], (2 * r) / px);
  return inside * present * legible;
}

/**
 * Mirror of `groundDetail` with hard cuts: the grass albedo at sim plan
 * (x, y), world height `h` (m) and world normal y `up`; `metresPerPx` only
 * affects the tufts (see `tuftAt`).
 */
export function groundDetailAlbedo(
  base: Rgb,
  x: number,
  y: number,
  h: number,
  up: number,
  s: GroundDetailSettings,
  c: GroundDetailColours,
  waterLevelM = 10,
  metresPerPx = 0,
): [number, number, number] {
  const luma = (v: Rgb) => v[0] * LUMA[0] + v[1] * LUMA[1] + v[2] * LUMA[2];
  const shade = Math.min(SHADE_MAX, Math.max(SHADE_MIN, luma(base) / Math.max(luma(c.grass), 1e-3)));
  let out: [number, number, number] = [base[0], base[1], base[2]];
  const scale = (ratio: Rgb, t: number) => {
    out = out.map((v, i) => v * (1 + ((ratio[i] ?? 1) - 1) * t)) as [number, number, number];
  };
  const toward = (target: Rgb, k: number, t: number) => {
    out = out.map((v, i) => v + ((target[i] ?? 0) * k * shade - v) * t) as [number, number, number];
  };
  const ratio = (a: Rgb): Rgb => [a[0] / c.grass[0], a[1] / c.grass[1], a[2] / c.grass[2]];

  const fineCell = PATCH_FINE_RATIO * s.patchCellM;
  const nFine = gdNoise(x / fineCell + 17, y / fineCell + 17);
  if (s.patch > 0) {
    const n = (1 - PATCH_FINE_WEIGHT) * gdNoise(x / s.patchCellM, y / s.patchCellM) + PATCH_FINE_WEIGHT * nFine;
    scale(ratio(c.grassLight), DETAIL_MIX.light * s.patch * gdCut(n - PATCH_CUTS.light));
    scale(ratio(c.grassShade), DETAIL_MIX.dark * s.patch * gdCut(PATCH_CUTS.dark - n));
  }
  if (s.tufts > 0) scale(ratio(c.grassShade), DETAIL_MIX.tuft * tuftAt(x, y, s.tufts, metresPerPx));
  const nFleck = gdNoise(x / 6.5 + 41, y / 6.5 + 41);
  if (s.meadow > 0) {
    const m = (1 - MEADOW_FINE_WEIGHT) * nFleck + MEADOW_FINE_WEIGHT * nFine;
    const meadowCut = MEADOW_CUTS[0] + (MEADOW_CUTS[1] - MEADOW_CUTS[0]) * smoothstep(s.meadowM[0], s.meadowM[1], h);
    toward(c.meadow, 1, DETAIL_MIX.meadow * s.meadow * gdCut(m - meadowCut));
  }
  if (s.slopeSoil > 0) {
    const [steep, gentle] = s.slopeDeg.map((deg) => Math.cos((deg * Math.PI) / 180)) as [number, number];
    toward(c.soil, 1, DETAIL_MIX.soil * s.slopeSoil * gdCut(steep + (gentle - steep) * nFleck - up));
  }
  if (s.waterline > 0) toward(c.soil, DETAIL_MIX.wet, s.waterline * gdCut(waterLevelM + WET_BAND_M + WET_NOISE_M * nFleck - h));
  return out;
}
