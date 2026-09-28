import { describe, expect, it } from "vitest";
import { ShaderLib, Texture } from "three";
import { DEFAULT_TERRAIN_SIZE, generateTerrain } from "../../core/sim/api";
import { createArtUniforms, terrainChunks } from "../art/materials";
import { earthworkLipOf, earthworkWeightOf } from "../art/shaderChunks/earthwork";
import { NEUTRAL_RELIEF } from "../art/shaderChunks/relief";
import { D11A_TERRAIN_COLOURS, computeTerrainShading } from "./terrainShading";
import {
  DEFAULT_TERRAIN_LOOK,
  FACET_DETAIL_V1,
  FACET_RELIEF_V1,
  TERRAIN_LOOKS,
  TERRAIN_LOOK_IDS,
  applyTerrainLook,
  hasFacets,
  parseTerrainLook,
  setTerrainAnisotropy,
  terrainChunkOptions,
} from "./terrainLook";

const bounds = { minX: 0, minZ: -1494, maxX: 1997.5, maxZ: 0 };

/** FNV-1a (32-bit) over a string's UTF-16 code units, low byte first. */
function fnvText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= s.charCodeAt(i) >>> 8;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** FNV-1a (32-bit) over the bytes of typed arrays. */
function fnvBytes(arrays: readonly ArrayBufferView[]): string {
  let h = 0x811c9dc5;
  for (const a of arrays) {
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i] ?? 0;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, "0");
}

describe("terrain look variants", () => {
  it("parse ?terrain= strictly, falling back to the recommended default", () => {
    for (const id of TERRAIN_LOOK_IDS) expect(parseTerrainLook(id)).toBe(id);
    for (const other of [null, "", "B", "e", "d11", " a"]) expect(parseTerrainLook(other)).toBe(DEFAULT_TERRAIN_LOOK);
    expect(TERRAIN_LOOK_IDS).toContain(DEFAULT_TERRAIN_LOOK);
    expect(DEFAULT_TERRAIN_LOOK).not.toBe("d11a");
  });

  it("keep d11a the look Look Gate A scored where no track is built: D11a's splat GLSL, bake and filtering, plus the earthwork chunk", () => {
    const d11a = TERRAIN_LOOKS.d11a;
    expect(d11a.colours).toBe(D11A_TERRAIN_COLOURS);
    expect(d11a.relief).toBeUndefined();
    expect(d11a.detail).toBeUndefined();
    expect(d11a.crispSplat).toBe(false);
    expect(d11a.earthworkSplat).toBe(false);
    expect(d11a.anisotropy).toBe(1);
    const u = createArtUniforms(bounds);
    const chunks = terrainChunks(u, terrainChunkOptions(d11a));
    // Review finding (PR #83): d11a had compiled the earthwork splat (`terrain-splat-v4-earthwork`). Now D11a's own.
    expect(chunks.map((c) => c.key)).toEqual(["terrain-splat-v2", "terrain-earthwork-v2", "grain-v1", "edge-fade-v1"]);
    // The splat patched onto three's Lambert shader is D11a's byte for byte: the hash was recorded from
    // `createSplatChunk` at origin/main 61bd690 and at b0a7500 (the Look Gate A record), which agree.
    const shader = { uniforms: {}, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader };
    chunks[0]?.patch(shader);
    expect(fnvText(`${shader.vertexShader}\u0000${shader.fragmentShader}`)).toBe("80dd4c25");
    // The baked normals, colours and water rings on the diorama are D11a's byte for byte (recorded at 61bd690).
    const t = generateTerrain({ seed: "baltic-diorama", ...DEFAULT_TERRAIN_SIZE });
    const bake = computeTerrainShading(t, d11a.colours);
    expect(fnvBytes([bake.normals, bake.colors, bake.waterDistance])).toBe("8e56f4bd");
    // Where no track is built every terrain vertex carries a zero earthwork attribute, which reads as no weight
    // and no lip, and the earthwork chunk writes the colour only behind that weight.
    expect(earthworkWeightOf(0)).toBe(0);
    expect(earthworkLipOf(0)).toBe(0);
    const withEarthwork = { uniforms: {}, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader };
    chunks[1]?.patch(withEarthwork);
    const main = withEarthwork.fragmentShader.slice(withEarthwork.fragmentShader.indexOf("float ewWeight = earthworkWeight();"));
    expect(main.indexOf("if ( ewWeight > 0.0 ) {")).toBeLessThan(main.indexOf("diffuseColor.rgb"));
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
    expect(terrainChunks(u, terrainChunkOptions(b)).map((k) => k.key)).toEqual(["terrain-splat-v4-crisp-detail-earthwork", "terrain-earthwork-v2", "terrain-relief-v2-facets", "grain-v1", "edge-fade-v1"]);
  });

  it("calm b after the owner found it noisy: weaker facets, softer, larger and weaker patches, fewer tufts and flecks, the same hills", () => {
    const { a, b } = TERRAIN_LOOKS;
    const relief = b.relief;
    const detail = b.detail;
    if (!relief || !detail || !a.detail) throw new Error("b and a have relief and detail");
    // The owner's pick at 3e8a8d3, kept for the record.
    expect(FACET_RELIEF_V1.facet).toBe(2.5);
    expect(FACET_DETAIL_V1.patch).toBe(0.7);
    expect(relief.facet).toBeLessThanOrEqual(FACET_RELIEF_V1.facet / 2);
    expect(relief.facet).toBeGreaterThan(0);
    expect(relief.gain).toBe(FACET_RELIEF_V1.gain);
    expect(relief.maxTan).toBe(FACET_RELIEF_V1.maxTan);
    expect(detail.toneSoft).toBeGreaterThan(0);
    expect(detail.patchCellM).toBeGreaterThan(FACET_DETAIL_V1.patchCellM);
    // Patch contrast, light and dark, under the owner's pick's (70% of the crisp mixes); light, the yellowish one, most.
    expect(detail.patch * detail.patchMix[0]).toBeLessThan(0.7 * FACET_DETAIL_V1.patch * FACET_DETAIL_V1.patchMix[0]);
    expect(detail.patch * detail.patchMix[1]).toBeLessThan(FACET_DETAIL_V1.patch * FACET_DETAIL_V1.patchMix[1]);
    expect(detail.tufts).toBeLessThan(FACET_DETAIL_V1.tufts);
    expect(detail.meadow).toBeLessThan(FACET_DETAIL_V1.meadow);
    expect(detail.meadowCuts[1]).toBeGreaterThan(FACET_DETAIL_V1.meadowCuts[1]);
    // a keeps its crisp detail exactly.
    expect(a.detail.toneSoft).toBe(0);
    expect(a.detail.patchMix).toEqual(FACET_DETAIL_V1.patchMix);
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
