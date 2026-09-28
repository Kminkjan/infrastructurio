import { describe, expect, it } from "vitest";
import { Color, MeshLambertMaterial, ShaderLib } from "three";
import { EARTHWORK_FULL_M, EARTHWORK_LIP_M, EARTHWORK_MIN_M, EARTHWORK_WEIGHT_FROM_X, FORMATION_HALF_WIDTH_M, encodeEarthworkPotential, slopeRiseM } from "../../terrain/earthworks";
import { palette } from "../palette";
import { ALBEDO_ANCHOR, type ShaderSource, installChunks } from "./chunk";
import {
  BARE_CUT_M,
  BARE_MAX,
  BARE_RISE_M,
  SHOULDER_FILL_M,
  SHOULDER_FULL_M,
  SHOULDER_M,
  STEEP_NORMAL_Y,
  createEarthworkChunk,
  createEarthworkUniforms,
  earthworkAlbedo,
  earthworkLipOf,
  earthworkWeightOf,
  syncEarthworkColors,
} from "./earthwork";
import { createSplatChunk, createSplatUniforms } from "./splat";

const rgb = (hex: number): [number, number, number] => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};
const grass = rgb(palette.grass);
/** An attribute for potential p (m), departure (m) and centreline distance (m). */
const attr = (p: number, departure: number, distance: number): [number, number, number] => [encodeEarthworkPotential(p), departure, distance];
const FLAT = 1;
const BANK = Math.cos(Math.atan(1 / 1.5));
const close = (a: readonly number[], b: readonly number[], digits = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));

describe("terrain earthwork chunk", () => {
  it("runs after the splat, before the albedo anchor, declaring the attribute and its helpers once", () => {
    const material = new MeshLambertMaterial({ vertexColors: true });
    const u = createEarthworkUniforms();
    installChunks(material, [createSplatChunk(createSplatUniforms(), { earthwork: true }), createEarthworkChunk(u)]);
    expect(material.customProgramCacheKey()).toBe("terrain-splat-v4-earthwork+terrain-earthwork-v2");
    const shader: ShaderSource = { uniforms: {}, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader.split("attribute vec3 earthwork;").length).toBe(2);
    expect(shader.vertexShader).toContain("vEarthwork = earthwork;");
    expect(shader.fragmentShader.split("#define TERRAIN_EARTHWORK").length).toBe(2);
    const splat = shader.fragmentShader.indexOf("uAoStrength * texture");
    const earthwork = shader.fragmentShader.indexOf("float ewWeight = earthworkWeight();");
    const anchor = shader.fragmentShader.indexOf(ALBEDO_ANCHOR);
    expect(splat).toBeGreaterThan(0);
    expect(earthwork).toBeGreaterThan(splat);
    expect(anchor).toBeGreaterThan(earthwork);
    for (const name of ["uEarthworkBed", "uEarthworkFace", "uEarthworkGrass", "uEarthworkGrassLight"] as const) expect(shader.uniforms[name]).toBe(u[name]);
    material.dispose();
  });

  it("encodes the potential so zeros read as natural ground: lip from 1 m outside, weight from 5 cm to 40 cm inside", () => {
    expect(encodeEarthworkPotential(-EARTHWORK_LIP_M)).toBeCloseTo(0, 12);
    expect(encodeEarthworkPotential(EARTHWORK_MIN_M)).toBeCloseTo(EARTHWORK_WEIGHT_FROM_X, 12);
    expect(encodeEarthworkPotential(EARTHWORK_FULL_M)).toBeCloseTo(1, 12);
    expect(encodeEarthworkPotential(-Infinity)).toBeLessThan(0);
    // The plain chunk's zeros: no weight and no lip.
    expect(earthworkWeightOf(0)).toBe(0);
    expect(earthworkLipOf(0)).toBe(0);
    expect(earthworkWeightOf(encodeEarthworkPotential(EARTHWORK_MIN_M))).toBe(0);
    expect(earthworkLipOf(encodeEarthworkPotential(EARTHWORK_MIN_M))).toBeCloseTo(1, 12);
    expect(earthworkWeightOf(encodeEarthworkPotential(3))).toBe(1);
    // Linear in the potential between, so interpolation across a triangle keeps the contour.
    const a = encodeEarthworkPotential(0.1);
    const b = encodeEarthworkPotential(0.3);
    expect((a + b) / 2).toBeCloseTo(encodeEarthworkPotential(0.2), 12);
  });

  it("leaves natural ground alone and keeps earthworks grassed: fills and shallow cuts show grass, slightly tinted when steep", () => {
    expect(earthworkAlbedo(grass, attr(-0.5, 0, 20), BANK)).toEqual(grass);
    expect(earthworkAlbedo(grass, attr(0.04, -0.04, 20), BANK)).toEqual(grass);
    // A tall fill's slope: grass, tinted a little toward light grass; its flat top away from the track: grass.
    const fill = earthworkAlbedo(grass, attr(2, 3, 8), BANK);
    const light = rgb(palette.grassLight);
    fill.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(Math.min(grass[i]!, light[i]!) - 1e-12);
      expect(v).toBeLessThanOrEqual(Math.max(grass[i]!, light[i]!) + 1e-12);
    });
    expect(fill).not.toEqual(grass);
    close(earthworkAlbedo(grass, attr(2, 3, 8), FLAT), grass);
    // A shallow cut's steep face: no bare earth (tint only).
    close(earthworkAlbedo(grass, attr(0.6, -0.6, 6), BANK), fill);
  });

  it("bares earth only on the lower batter of cuts deeper than about 1.5 m, never all the way", () => {
    const face = rgb(palette.earthworkFace);
    // 5 m out: 2 m past the formation edge, 0.67 m above it (inside the lower batter).
    const low = FORMATION_HALF_WIDTH_M + 2;
    expect(slopeRiseM(low)).toBeLessThan(BARE_RISE_M[0]);
    const deep = earthworkAlbedo(grass, attr(3, -3, low), BANK);
    const tinted = earthworkAlbedo(grass, attr(3, 0.1, low), BANK);
    // BARE_MAX of the way from the tinted grass to the face colour (grass is its own shade reference).
    deep.forEach((v, i) => expect(v).toBeCloseTo(tinted[i]! + (face[i]! - tinted[i]!) * BARE_MAX, 9));
    // The fade-in is continuous in depth, and a shallow cut shows none.
    close(earthworkAlbedo(grass, attr(1, -BARE_CUT_M[0], low), BANK), earthworkAlbedo(grass, attr(1, 0.1, low), BANK));
    const mid = earthworkAlbedo(grass, attr(3, -(BARE_CUT_M[0] + BARE_CUT_M[1]) / 2, low), BANK);
    mid.forEach((v, i) => expect((v - tinted[i]!) / (face[i]! - tinted[i]!)).toBeCloseTo(BARE_MAX / 2, 9));
    // Higher up a deep cut's face (here 4 m above the formation) it is grass again, however deep the cut.
    let high = FORMATION_HALF_WIDTH_M;
    while (slopeRiseM(high) < BARE_RISE_M[1] + 1.5) high += 0.1;
    close(earthworkAlbedo(grass, attr(8, -10, high), BANK), earthworkAlbedo(grass, attr(8, 0.1, high), BANK));
  });

  it("lays the bed colour on a narrow shoulder beside the ballast where the formation is cut, gone at its edge", () => {
    const bed = rgb(palette.earthworkBed);
    close(earthworkAlbedo(grass, attr(1, -1, SHOULDER_M[0] - 0.1), FLAT), bed);
    close(earthworkAlbedo(grass, attr(1, -1, SHOULDER_M[1]), FLAT), grass);
    // Only on made ground: the same place with no earthwork weight stays grass.
    close(earthworkAlbedo(grass, attr(-0.2, 0, SHOULDER_M[0] - 0.1), FLAT), grass);
    // Full from SHOULDER_FULL_M of potential, well before the earthwork weight.
    close(earthworkAlbedo(grass, attr(SHOULDER_FULL_M, -SHOULDER_FULL_M, SHOULDER_M[0] - 0.1), FLAT), bed);
    expect(earthworkWeightOf(encodeEarthworkPotential(SHOULDER_FULL_M))).toBeLessThan(0.5);
    // An embankment's formation stays grass (a fill growing outward across the shoulder drew a thin line).
    close(earthworkAlbedo(grass, attr(1, SHOULDER_FILL_M, SHOULDER_M[0] - 0.1), FLAT), grass);
  });

  it("re-reads the palette into its uniforms", () => {
    const u = createEarthworkUniforms();
    u.uEarthworkBed.value.set(0, 0, 0);
    u.uEarthworkGrass.value.set(0, 0, 0);
    syncEarthworkColors(u);
    expect(u.uEarthworkBed.value.getHex()).toBe(new Color(palette.earthworkBed).getHex());
    expect(u.uEarthworkGrass.value.getHex()).toBe(new Color(palette.grass).getHex());
  });
});
