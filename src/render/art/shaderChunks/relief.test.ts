import { describe, expect, it } from "vitest";
import { MeshLambertMaterial, ShaderLib } from "three";
import { type ShaderSource, installChunks } from "./chunk";
import {
  CONTOUR_MAJOR_FACTOR,
  NEUTRAL_RELIEF,
  NORMAL_ANCHOR,
  applyReliefSettings,
  contourShade,
  createReliefChunk,
  createReliefUniforms,
  exaggerateNormal,
  facetNormal,
  facetWeight,
  reliefNormal,
  steepenSlope,
} from "./relief";

type V3 = [number, number, number];
const slopeTan = (n: readonly number[]) => Math.hypot(n[0] ?? 0, n[2] ?? 0) / (n[1] ?? 1);
const unit = (v: V3): V3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** The world normal of a plane y = gx·x + gz·z. */
const planeNormal = (gx: number, gz: number): V3 => unit([-gx, 1, -gz]);

function lambertSource(): ShaderSource {
  return { uniforms: {}, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader };
}

describe("relief: slope gain", () => {
  it("steepens gentle slopes about gain times and levels steep ones off below maxTan", () => {
    expect(steepenSlope(0, 5, 1)).toBe(0);
    expect(steepenSlope(1e-5, 5, 1) / 1e-5).toBeCloseTo(5, 3);
    let previous = 0;
    for (let t = 0.01; t < 3; t += 0.01) {
      const s = steepenSlope(t, 5, 1);
      expect(s).toBeGreaterThan(previous);
      expect(s).toBeLessThan(1);
      previous = s;
    }
    // The map's median slope (3.6°) is lit as about 13.5°, its steepest (32.6°) stays under 45°.
    expect((Math.atan(steepenSlope(Math.tan((3.6 * Math.PI) / 180), 5, 1)) * 180) / Math.PI).toBeCloseTo(13.5, 1);
    expect((Math.atan(steepenSlope(Math.tan((32.6 * Math.PI) / 180), 5, 1)) * 180) / Math.PI).toBeLessThan(45);
  });

  it("keeps flat ground's normal exactly and each slope's aspect, steepening only its tangent", () => {
    expect(exaggerateNormal([0, 1, 0], 5, 1)).toEqual([0, 1, 0]);
    for (const [gx, gz] of [[0.05, 0], [0, -0.1], [0.07, 0.03], [-0.2, 0.25]] as const) {
      const n = planeNormal(gx, gz);
      const e = exaggerateNormal(n, 5, 1);
      expect(Math.hypot(...e)).toBeCloseTo(1, 12);
      expect(Math.atan2(e[2], e[0])).toBeCloseTo(Math.atan2(n[2], n[0]), 12);
      expect(slopeTan(e)).toBeCloseTo(steepenSlope(Math.hypot(gx, gz), 5, 1), 12);
    }
  });

  it("is a plain height scale by the gain when maxTan is huge", () => {
    const n = planeNormal(0.04, -0.03);
    const e = exaggerateNormal(n, 3, 1e12);
    const scaled = planeNormal(0.12, -0.09);
    e.forEach((v, i) => expect(v).toBeCloseTo(scaled[i] ?? 0, 9));
    expect(exaggerateNormal(n, 1, 1e12).map((v, i) => v - (n[i] ?? 0)).every((d) => Math.abs(d) < 1e-9)).toBe(true);
  });
});

describe("relief: facets", () => {
  it("takes a triangle's upward plane normal whatever its winding", () => {
    const a: V3 = [0, 1, 0];
    const b: V3 = [5, 1.5, 0];
    const c: V3 = [2.5, 0.5, -4.33];
    const up = facetNormal(a, b, c);
    const down = facetNormal(a, c, b);
    expect(up[1]).toBeGreaterThan(0);
    up.forEach((v, i) => expect(v).toBeCloseTo(down[i] ?? 0, 12));
    // Perpendicular to both edges.
    const dot = (u: readonly number[], v: readonly number[]) => (u[0] ?? 0) * (v[0] ?? 0) + (u[1] ?? 0) * (v[1] ?? 0) + (u[2] ?? 0) * (v[2] ?? 0);
    expect(dot(up, [5, 0.5, 0])).toBeCloseTo(0, 12);
    expect(dot(up, [2.5, -0.5, -4.33])).toBeCloseTo(0, 12);
  });

  it("fades facets in between the two zooms", () => {
    expect(facetWeight(2.5, 1, [1.5, 2.5])).toBe(0);
    expect(facetWeight(2.5, 1.5, [1.5, 2.5])).toBe(0);
    expect(facetWeight(2.5, 2, [1.5, 2.5])).toBeCloseTo(1.25, 12);
    expect(facetWeight(2.5, 6, [1.5, 2.5])).toBe(2.5);
    expect(facetWeight(0, 6, [1.5, 2.5])).toBe(0);
    // Over an earthwork's lip the facets fade out, so the refined 1.25 m triangles never show as facets.
    expect(facetWeight(2.5, 6, [1.5, 2.5], 1)).toBe(0);
    expect(facetWeight(2.5, 6, [1.5, 2.5], 0.4)).toBeCloseTo(1.5, 12);
  });

  it("adds the facet's deviation from the smooth normal on top of the steepened smooth normal", () => {
    const smooth = planeNormal(0.05, 0.02);
    const steep = exaggerateNormal(smooth, 5, 1);
    expect(reliefNormal(smooth, smooth, 3, 5, 1)).toEqual(steep);
    reliefNormal(smooth, planeNormal(0.3, -0.1), 0, 5, 1).forEach((v, i) => expect(v).toBeCloseTo(steep[i] ?? 0, 12));
    // A facet tilted further east pulls the result east.
    const east = reliefNormal(smooth, planeNormal(0.15, 0.02), 1, 5, 1);
    expect(east[0]).toBeLessThan(steep[0]);
  });
});

describe("relief: contour hint", () => {
  const settings = { contour: 0.08, contourM: 2.5, contourMajor: 4, contourFadePx: 4 };
  it("does nothing when off", () => {
    for (const h of [10, 12.5, 13.1]) expect(contourShade(h, 0.1, { ...settings, contour: 0 })).toBe(1);
  });

  it("darkens on each 2.5 m line, a major one every 10 m, and leaves the ground between alone", () => {
    const perPx = 0.1; // 25 px between lines
    expect(contourShade(12.5, perPx, settings)).toBeCloseTo(1 - 0.08, 12);
    expect(contourShade(20, perPx, settings)).toBeCloseTo(1 - 0.08 * CONTOUR_MAJOR_FACTOR, 12);
    expect(contourShade(13.75, perPx, settings)).toBe(1);
    // About one pixel wide: gone a pixel away from the line.
    expect(contourShade(12.5 + perPx * 1.01, perPx, settings)).toBe(1);
  });

  it("fades out where lines would crowd closer than the fade spacing", () => {
    expect(contourShade(12.5, 2.5 / 3, settings)).toBe(1);
    expect(contourShade(12.5, 2.5 / 6, settings)).toBeGreaterThan(1 - 0.08);
    expect(contourShade(12.5, 2.5 / 6, settings)).toBeLessThan(1);
  });
});

describe("relief chunk", () => {
  it("patches three's Lambert normal after the normal maps, with facets only when asked", () => {
    const u = createReliefUniforms();
    for (const facets of [false, true]) {
      const material = new MeshLambertMaterial({ vertexColors: true });
      installChunks(material, [createReliefChunk(u, { facets })]);
      expect(material.customProgramCacheKey()).toBe(facets ? "terrain-relief-v2-facets" : "terrain-relief-v2");
      const shader = lambertSource();
      material.onBeforeCompile(shader as never, undefined as never);
      const normalAt = shader.fragmentShader.indexOf(NORMAL_ANCHOR);
      expect(shader.fragmentShader.indexOf("reliefScale", normalAt)).toBeGreaterThan(normalAt);
      expect(shader.fragmentShader.includes("#define RELIEF_FACETS")).toBe(facets);
      // Facets fade out over the earthwork lip when the terrain carries the attribute.
      expect(shader.fragmentShader).toContain("#ifdef TERRAIN_EARTHWORK\n  reliefFacetW *= 1.0 - earthworkLip();");
      expect(shader.fragmentShader).toContain("uReliefContour");
      expect(Object.keys(shader.uniforms)).toEqual(expect.arrayContaining(["uReliefGain", "uReliefMaxTan", "uReliefFacet", "uReliefPpm"]));
      material.dispose();
    }
  });

  it("starts neutral and takes a look's settings", () => {
    const u = createReliefUniforms();
    expect(u.uReliefGain.value).toBe(1);
    expect(u.uReliefFacet.value).toBe(0);
    expect(u.uReliefContour.value).toBe(0);
    applyReliefSettings(u, { ...NEUTRAL_RELIEF, gain: 5, maxTan: 1, facet: 2.5, facetPpm: [1.5, 2.5], contour: 0.08 });
    expect([u.uReliefGain.value, u.uReliefMaxTan.value, u.uReliefFacet.value, u.uReliefContour.value]).toEqual([5, 1, 2.5, 0.08]);
    expect(u.uReliefFacetPpm.value.toArray()).toEqual([1.5, 2.5]);
  });
});
