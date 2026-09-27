import { Color, MeshLambertMaterial } from "three";
import type { MaterialSlot } from "./AssetRegistry";
import { palette } from "./palette";
import { type ShaderChunk, installChunks } from "./shaderChunks/chunk";
import { type EarthworkUniforms, createEarthworkChunk, createEarthworkUniforms, syncEarthworkColors } from "./shaderChunks/earthwork";
import { type EdgeFadeUniforms, createEdgeFadeChunk, createEdgeFadeUniforms, hazeForToneMapping } from "./shaderChunks/edgeFade";
import { createFoliageTintChunk } from "./shaderChunks/foliageTint";
import { type GrainUniforms, GRAIN_AMOUNT, createGrainChunk, createGrainUniforms } from "./shaderChunks/grain";
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
  hazeForToneMapping(haze.setHex(palette.haze), exposure, u.edge.uEdgeHaze.value);
  syncSplatColors(u.splat);
  syncEarthworkColors(u.earthwork);
}

/** Wind sway on or off (reduced motion turns it off, and the ambient reason with it). */
export function setSwayEnabled(u: ArtUniforms, on: boolean): void {
  u.sway.uSwayAmplitude.value = on ? SWAY_AMPLITUDE_M : 0;
}

/** Chunks after the lattice on the terrain material (the earthwork fade right after the splat it fades). */
export function terrainChunks(u: ArtUniforms): ShaderChunk[] {
  return [createSplatChunk(u.splat), createEarthworkChunk(u.earthwork), createGrainChunk(u.grain), createEdgeFadeChunk(u.edge)];
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
