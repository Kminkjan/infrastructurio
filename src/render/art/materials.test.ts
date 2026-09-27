import { describe, expect, it } from "vitest";
import { MATERIAL_SLOTS } from "./AssetRegistry";
import { createArtUniforms, createWorldMaterials, materialForSlot, setSwayEnabled, terrainChunks, waterChunks } from "./materials";
import { SWAY_AMPLITUDE_M } from "./shaderChunks/windSway";

const bounds = { minX: 0, minZ: -1494, maxX: 1997.5, maxZ: 0 };

describe("world materials", () => {
  it("are vertex-coloured, flat-shaded Lambert materials with their chunk combinations", () => {
    const u = createArtUniforms(bounds);
    const m = createWorldMaterials(u);
    for (const material of m.all) {
      expect(material.type).toBe("MeshLambertMaterial");
      expect(material.vertexColors).toBe(true);
      expect(material.flatShading).toBe(true);
    }
    expect(m.foliage.customProgramCacheKey()).toBe("foliage-tint-v1+wind-sway-v1+grain-v1+edge-fade-v1");
    expect(m.built.customProgramCacheKey()).toBe("grain-v1+edge-fade-v1");
    expect(m.glass.customProgramCacheKey()).toBe("edge-fade-v1");
    m.dispose();
  });

  it("draws every slot with a shared material: glass and foliage apart, the rest built", () => {
    const m = createWorldMaterials(createArtUniforms(bounds));
    for (const slot of MATERIAL_SLOTS) {
      const expected = slot === "glass" ? m.glass : slot === "foliage" ? m.foliage : m.built;
      expect(materialForSlot(m, slot)).toBe(expected);
    }
    m.dispose();
  });

  it("gives the terrain splat, grain and edge fade, and the water a calmer grain and edge fade", () => {
    const u = createArtUniforms(bounds);
    expect(terrainChunks(u).map((c) => c.key)).toEqual(["terrain-splat-v2", "grain-v1", "edge-fade-v1"]);
    expect(waterChunks(u).map((c) => c.key)).toEqual(["grain-v1", "edge-fade-v1"]);
    expect(u.waterGrain.uGrainAmount.value).toBeLessThan(u.grain.uGrainAmount.value);
  });

  it("adds the terrain look variants' splat extras and relief chunk only when asked", () => {
    const u = createArtUniforms(bounds);
    expect(terrainChunks(u, {}).map((c) => c.key)).toEqual(terrainChunks(u).map((c) => c.key));
    expect(terrainChunks(u, { crispSplat: true, detail: true, relief: true }).map((c) => c.key)).toEqual([
      "terrain-splat-v3-crisp-detail",
      "terrain-relief-v1",
      "grain-v1",
      "edge-fade-v1",
    ]);
    expect(terrainChunks(u, { crispSplat: true, detail: true, relief: true, facets: true }).map((c) => c.key)[1]).toBe("terrain-relief-v1-facets");
  });

  it("turns sway off and on (reduced motion)", () => {
    const u = createArtUniforms(bounds);
    setSwayEnabled(u, false);
    expect(u.sway.uSwayAmplitude.value).toBe(0);
    setSwayEnabled(u, true);
    expect(u.sway.uSwayAmplitude.value).toBe(SWAY_AMPLITUDE_M);
  });
});
