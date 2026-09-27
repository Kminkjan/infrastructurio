import { describe, expect, it } from "vitest";
import { Texture } from "three";
import { createArtUniforms, terrainChunks } from "../art/materials";
import { NEUTRAL_RELIEF } from "../art/shaderChunks/relief";
import { D11A_TERRAIN_COLOURS } from "./terrainShading";
import {
  DEFAULT_TERRAIN_LOOK,
  TERRAIN_LOOKS,
  TERRAIN_LOOK_IDS,
  applyTerrainLook,
  hasFacets,
  parseTerrainLook,
  setTerrainAnisotropy,
  terrainChunkOptions,
} from "./terrainLook";

const bounds = { minX: 0, minZ: -1494, maxX: 1997.5, maxZ: 0 };

describe("terrain look variants", () => {
  it("parse ?terrain= strictly, falling back to the recommended default", () => {
    for (const id of TERRAIN_LOOK_IDS) expect(parseTerrainLook(id)).toBe(id);
    for (const other of [null, "", "B", "e", "d11", " a"]) expect(parseTerrainLook(other)).toBe(DEFAULT_TERRAIN_LOOK);
    expect(TERRAIN_LOOK_IDS).toContain(DEFAULT_TERRAIN_LOOK);
    expect(DEFAULT_TERRAIN_LOOK).not.toBe("d11a");
  });

  it("keep d11a exactly the look Look Gate A scored: D11a's bake, chunks and filtering", () => {
    const d11a = TERRAIN_LOOKS.d11a;
    expect(d11a.colours).toBe(D11A_TERRAIN_COLOURS);
    expect(d11a.relief).toBeUndefined();
    expect(d11a.detail).toBeUndefined();
    expect(d11a.crispSplat).toBe(false);
    expect(d11a.anisotropy).toBe(1);
    const u = createArtUniforms(bounds);
    expect(terrainChunks(u, terrainChunkOptions(d11a)).map((c) => c.key)).toEqual(terrainChunks(u).map((c) => c.key));
  });

  it("step from a to b by adding facets only, and from b to c by adding contours only", () => {
    const { a, b, c } = TERRAIN_LOOKS;
    expect(hasFacets(a)).toBe(false);
    expect(hasFacets(b)).toBe(true);
    expect(b.colours).toEqual(a.colours);
    expect({ ...b.relief, facet: 0, facetPpm: NEUTRAL_RELIEF.facetPpm }).toEqual({ ...a.relief, facetPpm: NEUTRAL_RELIEF.facetPpm });
    const noContour = { contour: 0, contourM: 0, contourMajor: 0, contourFadePx: 0 };
    expect({ ...c, id: "b", label: b.label, relief: { ...c.relief, ...noContour } }).toEqual({ ...b, relief: { ...b.relief, ...noContour } });
    expect(c.relief?.contour).toBeGreaterThan(0);
    expect(b.relief?.contour).toBe(0);
    const u = createArtUniforms(bounds);
    expect(terrainChunks(u, terrainChunkOptions(b)).map((k) => k.key)).toEqual(["terrain-splat-v3-crisp-detail", "terrain-earthwork-v1", "terrain-relief-v1-facets", "grain-v1", "edge-fade-v1"]);
  });

  it("write their settings and the water level into the shared uniforms", () => {
    const u = createArtUniforms(bounds);
    applyTerrainLook(u, TERRAIN_LOOKS.c, 10);
    expect(u.relief.uReliefGain.value).toBe(TERRAIN_LOOKS.c.relief?.gain);
    expect(u.relief.uReliefContour.value).toBe(TERRAIN_LOOKS.c.relief?.contour);
    expect(u.detail.uGdPatch.value).toBe(TERRAIN_LOOKS.c.detail?.patch);
    expect(u.detail.uGdWaterLevel.value).toBe(10);
    applyTerrainLook(u, TERRAIN_LOOKS.d11a, 10);
    expect([u.relief.uReliefGain.value, u.relief.uReliefFacet.value, u.detail.uGdPatch.value, u.detail.uGdTufts.value]).toEqual([1, 0, 0, 0]);
  });

  it("filter the splat and AO maps anisotropically, capped by the device", () => {
    const splat = new Texture();
    const ao = new Texture();
    setTerrainAnisotropy([splat, ao, null], TERRAIN_LOOKS.b, 16);
    expect([splat.anisotropy, ao.anisotropy]).toEqual([8, 8]);
    setTerrainAnisotropy([splat], TERRAIN_LOOKS.b, 4);
    expect(splat.anisotropy).toBe(4);
    setTerrainAnisotropy([splat], TERRAIN_LOOKS.d11a, 16);
    expect(splat.anisotropy).toBe(1);
    splat.dispose();
    ao.dispose();
  });
});
