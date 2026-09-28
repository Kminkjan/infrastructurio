import { Color, MeshLambertMaterial } from "three";
import type { MaterialSlot } from "./AssetRegistry";
import { palette } from "./palette";
import { type ShaderChunk, installChunks } from "./shaderChunks/chunk";
import { type EarthworkUniforms, createEarthworkChunk, createEarthworkUniforms, syncEarthworkColors } from "./shaderChunks/earthwork";
import { type EdgeFadeUniforms, createEdgeFadeChunk, createEdgeFadeUniforms, hazeForToneMapping } from "./shaderChunks/edgeFade";
import { createFoliageTintChunk } from "./shaderChunks/foliageTint";
import { type GrainUniforms, GRAIN_AMOUNT, createGrainChunk, createGrainUniforms } from "./shaderChunks/grain";
import { type GroundDetailUniforms, createGroundDetailUniforms, syncGroundDetailColors } from "./shaderChunks/groundDetail";
import { type ReliefUniforms, createReliefChunk, createReliefUniforms } from "./shaderChunks/relief";
import { type SplatUniforms, createSplatChunk, createSplatUniforms, syncSplatColors } from "./shaderChunks/splat";
import { type TrackStripeUniforms, createTrackStripeChunk, createTrackStripeUniforms } from "./shaderChunks/trackStripe";
import { type WindSwayUniforms, SWAY_AMPLITUDE_M, createWindSwayChunk, createWindSwayUniforms } from "./shaderChunks/windSway";

/**
 * The world's shared materials (ADR 0013 decision 3, art direction
 * "Materials"): `MeshLambertMaterial` with vertex colours (and instance
 * colours where instanced), one material per distinct shader-chunk
 * combination, never one per colour, because colour is data.
 *
 * D11a has six: terrain and water (owned by `LatticeOverlay`, which puts the
 * lattice first and these chunks after it), foliage, built (walls, roofs,
 * trim, metal and sails share one combination, so a chunk merges them into
 * one draw), glass and props. Flat shading: foliage, built (roofs) and props;
 * terrain stays smooth. D3 adds the three track materials (ballast with the
 * far-LOD stripe, sleepers, rails), nine in all; steam and vehicles bring the
 * total to about the dozen ADR 0013 plans.
 */

export interface ArtUniforms {
  /** Terrain look variants (2026-09-27): relief shading and grass detail, installed only by the variants. */
  readonly relief: ReliefUniforms;
  readonly detail: GroundDetailUniforms;
  readonly sway: WindSwayUniforms;
  readonly grain: GrainUniforms;
  readonly waterGrain: GrainUniforms;
  readonly edge: EdgeFadeUniforms;
  readonly splat: SplatUniforms;
  readonly earthwork: EarthworkUniforms;
}

/** Water takes half the grain, so the surface reads calm. */
const WATER_GRAIN = GRAIN_AMOUNT / 2;

export function createArtUniforms(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): ArtUniforms {
  const u: ArtUniforms = {
    relief: createReliefUniforms(),
    detail: createGroundDetailUniforms(),
    sway: createWindSwayUniforms(),
    grain: createGrainUniforms(),
    waterGrain: createGrainUniforms(WATER_GRAIN),
    edge: createEdgeFadeUniforms(bounds),
    splat: createSplatUniforms(),
    earthwork: createEarthworkUniforms(),
  };
  syncArtColors(u, 1);
  return u;
}

const haze = new Color();

/** Re-reads palette-driven uniforms (after a tweak-panel change) for the current exposure. */
export function syncArtColors(u: ArtUniforms, exposure: number): void {
  syncGroundDetailColors(u.detail);
  hazeForToneMapping(haze.setHex(palette.haze), exposure, u.edge.uEdgeHaze.value);
  syncSplatColors(u.splat);
  syncEarthworkColors(u.earthwork);
}

/** Wind sway on or off (reduced motion turns it off, and the ambient reason with it). */
export function setSwayEnabled(u: ArtUniforms, on: boolean): void {
  u.sway.uSwayAmplitude.value = on ? SWAY_AMPLITUDE_M : 0;
}

/** What a terrain look variant adds to the terrain material (nothing: D11a's splat exactly, plus the earthwork colours). */
export interface TerrainChunkOptions {
  readonly crispSplat?: boolean;
  readonly detail?: boolean;
  /** The splat keeps the grass on earthworks (fades its surfaces and AO tint there); without it the splat is D11a's `terrain-splat-v2`. */
  readonly earthworkSplat?: boolean;
  readonly relief?: boolean;
  /** Compile the relief chunk's facet path (lattice triangles lit as facets). */
  readonly facets?: boolean;
}

/**
 * Chunks after the lattice on the terrain material: splat (keeping the grass on
 * earthworks when asked), then the earthwork colours right after it, then
 * relief (its contour hint darkens fields and roads too; its facets fade out
 * on earthworks), grain and edge fade. Without options the splat is D11a's
 * exactly, and the earthwork chunk acts only on earthwork vertices, so where no
 * track is built the terrain renders as D11a's.
 */
export function terrainChunks(u: ArtUniforms, options: TerrainChunkOptions = {}): ShaderChunk[] {
  const splat = createSplatChunk(u.splat, { crisp: options.crispSplat === true, earthwork: options.earthworkSplat === true, ...(options.detail ? { detail: u.detail } : {}) });
  const relief = options.relief ? [createReliefChunk(u.relief, { facets: options.facets === true })] : [];
  return [splat, createEarthworkChunk(u.earthwork), ...relief, createGrainChunk(u.grain), createEdgeFadeChunk(u.edge)];
}

/** Chunks after the lattice on the water material. */
export function waterChunks(u: ArtUniforms): ShaderChunk[] {
  return [createGrainChunk(u.waterGrain), createEdgeFadeChunk(u.edge)];
}

export interface WorldMaterials {
  readonly foliage: MeshLambertMaterial;
  readonly built: MeshLambertMaterial;
  readonly glass: MeshLambertMaterial;
  readonly props: MeshLambertMaterial;
  readonly all: readonly MeshLambertMaterial[];
  dispose(): void;
}

export function createWorldMaterials(u: ArtUniforms): WorldMaterials {
  const foliage = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  installChunks(foliage, [createFoliageTintChunk(), createWindSwayChunk(u.sway), createGrainChunk(u.grain), createEdgeFadeChunk(u.edge)]);
  const built = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  installChunks(built, [createGrainChunk(u.grain), createEdgeFadeChunk(u.edge)]);
  // Glass stays clean (no grain), so windows read as dark panes, not painted wall.
  const glass = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  installChunks(glass, [createEdgeFadeChunk(u.edge)]);
  const props = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  installChunks(props, [createGrainChunk(u.grain), createEdgeFadeChunk(u.edge)]);
  const all = [foliage, built, glass, props];
  for (const [m, name] of [[foliage, "foliage"], [built, "built"], [glass, "glass"], [props, "props"]] as const) m.name = name;
  return {
    foliage,
    built,
    glass,
    props,
    all,
    dispose: () => {
      for (const m of all) m.dispose();
    },
  };
}

/** Which shared material draws a slot. */
export function materialForSlot(m: WorldMaterials, slot: MaterialSlot): MeshLambertMaterial {
  switch (slot) {
    case "glass":
      return m.glass;
    case "foliage":
      return m.foliage;
    default:
      return m.built;
  }
}

export interface TrackMaterials {
  readonly ballast: MeshLambertMaterial;
  readonly sleepers: MeshLambertMaterial;
  readonly rails: MeshLambertMaterial;
  readonly stripe: TrackStripeUniforms;
  readonly all: readonly MeshLambertMaterial[];
  dispose(): void;
}

/**
 * Track materials (art direction "Track"): vertex-coloured Lambert with the
 * geometry's own normals. Ballast and sleepers take the grain; rails stay
 * clean so the steel reads smooth. All fade into the haze at the map edge.
 */
export function createTrackMaterials(u: ArtUniforms): TrackMaterials {
  const stripe = createTrackStripeUniforms();
  const ballast = new MeshLambertMaterial({ vertexColors: true });
  installChunks(ballast, [createTrackStripeChunk(stripe), createGrainChunk(u.grain), createEdgeFadeChunk(u.edge)]);
  const sleepers = new MeshLambertMaterial({ vertexColors: true });
  installChunks(sleepers, [createGrainChunk(u.grain), createEdgeFadeChunk(u.edge)]);
  const rails = new MeshLambertMaterial({ vertexColors: true });
  installChunks(rails, [createEdgeFadeChunk(u.edge)]);
  const all = [ballast, sleepers, rails];
  for (const [m, name] of [[ballast, "ballast"], [sleepers, "sleepers"], [rails, "rails"]] as const) m.name = name;
  return {
    ballast,
    sleepers,
    rails,
    stripe,
    all,
    dispose: () => {
      for (const m of all) m.dispose();
    },
  };
}
