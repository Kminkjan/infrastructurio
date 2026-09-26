import { describe, expect, it } from "vitest";
import type { Mesh } from "three";
import { DIORAMA_SEED, generateDiorama } from "../../../core/scenarios/baltic-diorama";
import { DEFAULT_TERRAIN_SIZE, generateTerrain } from "../../../core/terrain";
import { AssetRegistry } from "../../art/AssetRegistry";
import { createArtUniforms, createWorldMaterials } from "../../art/materials";
import { terrainWorldBounds } from "../../terrain/terrainGeometry";
import { BUILDING_LOD0_FROM_PPM, BuildingLayer } from "./BuildingLayer";
import { registerBuildingAssets } from "./grammar";

const terrain = generateTerrain({ seed: DIORAMA_SEED, ...DEFAULT_TERRAIN_SIZE });
const scenery = generateDiorama(terrain);

describe("building layer", () => {
  const registry = new AssetRegistry();
  registerBuildingAssets(registry);
  const materials = createWorldMaterials(createArtUniforms(terrainWorldBounds(terrain)));
  const layer = new BuildingLayer(scenery, terrain, registry, materials);
  const meshes = layer.group.children.filter((c): c is Mesh => (c as Mesh).isMesh === true);

  it("merges every building into a few draws per 256 m chunk, material and LOD", () => {
    // Two materials (built, glass) × two LODs per chunk that holds buildings.
    expect(scenery.lots.length).toBeGreaterThan(100);
    expect(meshes.length).toBeLessThanOrEqual(4 * 12);
    expect(meshes.every((m) => m.geometry.boundingSphere !== null)).toBe(true);
    const lod0Triangles = meshes.filter((m) => m.visible).reduce((n, m) => n + m.geometry.getAttribute("position").count / 3, 0);
    expect(lod0Triangles).toBeLessThanOrEqual(scenery.lots.length * 600 + 900);
  });

  it("keeps the windmill's sails as their own mesh and turns them with ambient time", () => {
    expect(layer.animated).toBe(true);
    const sails = layer.group.getObjectByName("windmill sails") as Mesh;
    expect(sails).toBeDefined();
    layer.update(6, 2);
    expect(sails.rotation.x).toBeCloseTo(2 * 0.7, 9);
  });

  it("shows silhouettes in the far band and details from the mid band up", () => {
    layer.update(BUILDING_LOD0_FROM_PPM - 0.1, 0);
    const far = meshes.filter((m) => m.visible).length;
    layer.update(BUILDING_LOD0_FROM_PPM, 0);
    expect(meshes.filter((m) => m.visible).length).toBe(meshes.length - far);
  });

  it("collects chimney smoke anchors in world space", () => {
    expect(layer.smokeAnchors.length).toBeGreaterThan(scenery.lots.filter((l) => l.kind === "townhouse").length);
    for (const p of layer.smokeAnchors) expect(p.y).toBeGreaterThan(10);
  });
});
