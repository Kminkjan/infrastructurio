import { describe, expect, it } from "vitest";
import { Color, MeshLambertMaterial, ShaderLib } from "three";
import { palette } from "../palette";
import { ALBEDO_ANCHOR, type ShaderSource, installChunks } from "./chunk";
import { EARTHWORK_BED_NORMAL_Y, EARTHWORK_FACE_NORMAL_Y, createEarthworkChunk, createEarthworkUniforms, earthworkAlbedo, syncEarthworkColors } from "./earthwork";
import { createSplatChunk, createSplatUniforms } from "./splat";

const rgb = (hex: number): [number, number, number] => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};

describe("terrain earthwork chunk", () => {
  it("runs after the splat, before the albedo anchor, reading the attribute and the palette uniforms", () => {
    const material = new MeshLambertMaterial({ vertexColors: true });
    const u = createEarthworkUniforms();
    installChunks(material, [createSplatChunk(createSplatUniforms()), createEarthworkChunk(u)]);
    expect(material.customProgramCacheKey()).toBe("terrain-splat-v2+terrain-earthwork-v1");
    const shader: ShaderSource = { uniforms: {}, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain("attribute float earthwork;");
    expect(shader.vertexShader).toContain("vEarthwork = earthwork;");
    const splat = shader.fragmentShader.indexOf("uAoStrength * texture");
    const earthwork = shader.fragmentShader.indexOf("clamp( vEarthwork, 0.0, 1.0 )");
    const anchor = shader.fragmentShader.indexOf(ALBEDO_ANCHOR);
    expect(splat).toBeGreaterThan(0);
    expect(earthwork).toBeGreaterThan(splat);
    expect(anchor).toBeGreaterThan(earthwork);
    expect(shader.uniforms.uEarthworkBed).toBe(u.uEarthworkBed);
    expect(shader.uniforms.uEarthworkFace).toBe(u.uEarthworkFace);
    material.dispose();
  });

  it("leaves natural ground alone, paints bed on the flat and face on slopes, clamped per fragment", () => {
    const grass = rgb(palette.grass);
    expect(earthworkAlbedo(grass, 0, 1)).toEqual(grass);
    expect(earthworkAlbedo(grass, -0.4, 0.8)).toEqual(grass);
    const bed = earthworkAlbedo(grass, 1, 1);
    const face = earthworkAlbedo(grass, 3, 0.83);
    bed.forEach((v, i) => expect(v).toBeCloseTo(rgb(palette.earthworkBed)[i]!, 9));
    face.forEach((v, i) => expect(v).toBeCloseTo(rgb(palette.earthworkFace)[i]!, 9));
    // Between the thresholds the colour blends; halfway along the ramp it is halfway to the earth.
    expect(EARTHWORK_FACE_NORMAL_Y).toBeLessThan(EARTHWORK_BED_NORMAL_Y);
    const half = earthworkAlbedo(grass, 0.5, 1);
    half.forEach((v, i) => expect(v).toBeCloseTo((grass[i]! + rgb(palette.earthworkBed)[i]!) / 2, 9));
  });

  it("re-reads the palette into its uniforms", () => {
    const u = createEarthworkUniforms();
    u.uEarthworkBed.value.set(0, 0, 0);
    syncEarthworkColors(u);
    expect(u.uEarthworkBed.value.getHex()).toBe(new Color(palette.earthworkBed).getHex());
  });
});
