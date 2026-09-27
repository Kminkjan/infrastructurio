import type { Texture } from "three";
import type { ArtUniforms, TerrainChunkOptions } from "../art/materials";
import { DETAIL_MIX, type GroundDetailSettings, MEADOW_CUTS, NO_GROUND_DETAIL, applyGroundDetailSettings } from "../art/shaderChunks/groundDetail";
import { NEUTRAL_RELIEF, type ReliefSettings, applyReliefSettings } from "../art/shaderChunks/relief";
import { D11A_TERRAIN_COLOURS, type TerrainColourOptions } from "./terrainShading";

/**
 * Terrain look variants for the owner's side-by-side comparison (2026-09-27,
 * after the owner found the ground "too blurry/flat"), chosen by URL like the
 * pitch A/B: `?terrain=d11a|a|b|c`. `d11a` is the look Look Gate A scored,
 * unchanged. The variants keep every palette colour and the lighting recipe;
 * they change only how the ground is shaded and detailed, all without
 * post-processing and without per-frame work beyond one uniform (the zoom):
 *
 * - `a` crisp relief: slope gain on smooth shading (normals from smoothed
 *   heights), calm 70 m patches, crisp grass detail (tone patches, tufts,
 *   meadow flecks rising uphill, soil on steep banks, a wet waterline), crisp
 *   splat edges and anisotropic splat filtering;
 * - `b` faceted: `a` plus each lattice triangle's own plane as a facet detail
 *   from Region zoom in (smooth at Far), with the tone patches toned down
 *   because the facets carry variation;
 * - `c` contour hint: `b` plus a faint line every 2.5 m of height (every 10 m
 *   a little stronger).
 *
 * So `a` → `b` isolates the facets and `b` → `c` the contours. The default
 * (no parameter, or an unknown value) is the agent's recommendation, recorded
 * in art direction; the owner decides.
 */

export const TERRAIN_LOOK_IDS = ["d11a", "a", "b", "c"] as const;
export type TerrainLookId = (typeof TERRAIN_LOOK_IDS)[number];

export interface TerrainLook {
  readonly id: TerrainLookId;
  readonly label: string;
  /** The baked vertex-colour recipe. */
  readonly colours: TerrainColourOptions;
  /** Relief shading (normal gain, facets, contours); undefined leaves the chunk out. */
  readonly relief: ReliefSettings | undefined;
  /** Grass detail under the splat surfaces; undefined leaves it out. */
  readonly detail: GroundDetailSettings | undefined;
  /** Pixel-crisp splat edges. */
  readonly crispSplat: boolean;
  /** Anisotropic filtering of the splat and AO maps (1 = off, as in D11a). */
  readonly anisotropy: number;
}

/**
 * The variants' calmer bake: patches at a quarter, no jitter, faint soft
 * meadow, and normals from heights smoothed twice (no quantisation streaks
 * under the slope gain). Hollows and ridges keep D11a's faint tint: a deeper
 * one drew the map's small pits as dark blobs.
 */
const CALM_COLOURS: TerrainColourOptions = {
  ...D11A_TERRAIN_COLOURS,
  normalSmoothing: 2,
  patchAmount: 0.25,
  jitter: 0,
  meadowStrength: 0.15,
};

const CRISP_DETAIL: GroundDetailSettings = {
  patch: 1,
  patchCellM: 16,
  toneSoft: 0,
  patchMix: [DETAIL_MIX.light, DETAIL_MIX.dark],
  tufts: 0.35,
  meadow: 1,
  meadowM: [22, 34],
  meadowCuts: MEADOW_CUTS,
  slopeSoil: 1,
  slopeDeg: [32, 17],
  waterline: 1,
};

/** Gentle slopes lit about 5× as steep, levelling off below 45°. */
const SMOOTH_RELIEF: ReliefSettings = { ...NEUTRAL_RELIEF, gain: 5, maxTan: 1 };
/**
 * Look `b` as the owner chose it (2026-09-27, `3e8a8d3`): facets at weight 2.5 from Region zoom
 * (2.5 ppm) in, gone below 1.5 ppm (the 10 m LOD starts at 2), and the tone patches at 70%.
 * Kept for the record; the render pass iteration calmed `b` (below) after the owner found it
 * "Facets too strong/noisy".
 */
export const FACET_RELIEF_V1: ReliefSettings = { ...SMOOTH_RELIEF, facet: 2.5, facetPpm: [1.5, 2.5] };
export const FACET_DETAIL_V1: GroundDetailSettings = { ...CRISP_DETAIL, patch: 0.7 };
/** Calmer facets: about a third of the old weight, still from Region zoom in. */
const FACET_RELIEF: ReliefSettings = { ...SMOOTH_RELIEF, facet: 0.8, facetPpm: [1.5, 2.5] };
/** Calmer detail: larger, softer, weaker tone patches; fewer, fainter and softer meadow flecks; fewer tufts. */
const FACET_DETAIL: GroundDetailSettings = {
  ...CRISP_DETAIL,
  patch: 1,
  patchCellM: 26,
  toneSoft: 0.08,
  patchMix: [0.08, 0.07],
  tufts: 0.2,
  meadow: 0.5,
  meadowCuts: [0.97, 0.8],
};

export const TERRAIN_LOOKS: { readonly [K in TerrainLookId]: TerrainLook } = {
  d11a: {
    id: "d11a",
    label: "D11a (scored at Look Gate A)",
    colours: D11A_TERRAIN_COLOURS,
    relief: undefined,
    detail: undefined,
    crispSplat: false,
    anisotropy: 1,
  },
  a: {
    id: "a",
    label: "A: crisp relief",
    colours: CALM_COLOURS,
    relief: SMOOTH_RELIEF,
    detail: CRISP_DETAIL,
    crispSplat: true,
    anisotropy: 8,
  },
  b: {
    id: "b",
    label: "B: faceted",
    colours: CALM_COLOURS,
    relief: FACET_RELIEF,
    detail: FACET_DETAIL,
    crispSplat: true,
    anisotropy: 8,
  },
  c: {
    id: "c",
    label: "C: contour hint",
    colours: CALM_COLOURS,
    relief: { ...FACET_RELIEF, contour: 0.08, contourM: 2.5, contourMajor: 4, contourFadePx: 4 },
    detail: FACET_DETAIL,
    crispSplat: true,
    anisotropy: 8,
  },
};

/** The agent's recommendation (art direction, 2026-09-27); the owner decides. */
export const DEFAULT_TERRAIN_LOOK: TerrainLookId = "b";

/** `?terrain=` value → look id; missing or unknown values give the default. */
export function parseTerrainLook(value: string | null): TerrainLookId {
  return (TERRAIN_LOOK_IDS as readonly string[]).includes(value ?? "") ? (value as TerrainLookId) : DEFAULT_TERRAIN_LOOK;
}

/** Which terrain chunks a look installs (none beyond D11a's for `d11a`). */
export function terrainChunkOptions(look: TerrainLook): TerrainChunkOptions {
  return { crispSplat: look.crispSplat, detail: look.detail !== undefined, relief: look.relief !== undefined, facets: hasFacets(look) };
}

/** Whether a look lights lattice triangles as facets. */
export function hasFacets(look: TerrainLook): boolean {
  return (look.relief?.facet ?? 0) > 0;
}

/** Writes a look's relief and detail settings, and the water level, into the shared uniforms. */
export function applyTerrainLook(u: ArtUniforms, look: TerrainLook, waterLevelM: number): void {
  applyReliefSettings(u.relief, look.relief ?? NEUTRAL_RELIEF);
  applyGroundDetailSettings(u.detail, look.detail ?? NO_GROUND_DETAIL);
  u.detail.uGdWaterLevel.value = waterLevelM;
}

/**
 * Sets anisotropic filtering on the terrain's data textures, capped by the
 * device. Call before their first upload (three applies it on upload).
 */
export function setTerrainAnisotropy(textures: readonly (Texture | null)[], look: TerrainLook, maxAnisotropy: number): void {
  const n = Math.max(1, Math.min(look.anisotropy, maxAnisotropy));
  for (const t of textures) if (t) t.anisotropy = n;
}
