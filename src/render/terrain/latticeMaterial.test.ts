import { describe, expect, it } from "vitest";
import { ShaderLib } from "three";
import { HEADINGS, add, axial, isPrimary, stepOf, toWorld } from "../../core/lattice";
import {
  LATTICE_BUILD_FADE_MS,
  LATTICE_DOT_RADIUS_PX,
  LATTICE_LINE_WIDTH_PX,
  LatticeOverlay,
  latticeFamilyDistancesM,
} from "./latticeMaterial";

const NODES = [-4, -1, 0, 3, 7].flatMap((q) => [-5, 0, 2, 9].map((r) => axial(q, r)));

describe("lattice overlay maths", () => {
  it("puts every lattice node on all three line families", () => {
    for (const node of NODES) {
      const w = toWorld(node);
      for (const d of latticeFamilyDistancesM(w.x, w.y)) expect(d).toBeLessThan(1e-9);
    }
  });

  it("puts every primary edge midpoint on exactly one family, half a spacing from the others", () => {
    for (const node of NODES) {
      for (const h of HEADINGS.filter(isPrimary)) {
        const a = toWorld(node);
        const b = toWorld(add(node, stepOf(h)));
        const d = latticeFamilyDistancesM((a.x + b.x) / 2, (a.y + b.y) / 2);
        expect(d.filter((v) => v < 1e-9)).toHaveLength(1);
        expect(d.filter((v) => Math.abs(v - 4.330127018922193 / 2) < 1e-9)).toHaveLength(2);
      }
    }
  });

  it("keeps triangle centroids off every line", () => {
    const a = toWorld(axial(0, 0));
    const b = toWorld(axial(1, 0));
    const c = toWorld(axial(0, 1));
    const d = latticeFamilyDistancesM((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3);
    for (const v of d) expect(v).toBeGreaterThan(1);
  });
});

describe("lattice overlay material", () => {
  it("patches three's Lambert shader at its anchor chunks", () => {
    const overlay = new LatticeOverlay(() => false);
    const shader = {
      uniforms: {},
      vertexShader: ShaderLib.lambert.vertexShader,
      fragmentShader: ShaderLib.lambert.fragmentShader,
    };
    overlay.material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain("vLatticeWorld = (modelMatrix");
    expect(shader.fragmentShader).toContain("uniform float uBuildMode;");
    expect(shader.fragmentShader.indexOf("latticeLine(simXY.y)")).toBeLessThan(shader.fragmentShader.indexOf("#include <opaque_fragment>"));
    expect(Object.keys(shader.uniforms)).toContain("uCursor");
    expect(overlay.material.customProgramCacheKey()).toBe("lattice-overlay-v1");
    overlay.dispose();
  });

  it("scales line width and dot radius from CSS px to device px with the pixel ratio", () => {
    const overlay = new LatticeOverlay(() => false);
    expect(overlay.uniforms.uLineWidthPx.value).toBe(LATTICE_LINE_WIDTH_PX);
    expect(overlay.uniforms.uDotRadiusPx.value).toBe(LATTICE_DOT_RADIUS_PX);
    overlay.setPixelRatio(2);
    expect(overlay.uniforms.uLineWidthPx.value).toBe(2 * LATTICE_LINE_WIDTH_PX);
    expect(overlay.uniforms.uDotRadiusPx.value).toBe(2 * LATTICE_DOT_RADIUS_PX);
    overlay.setPixelRatio(1);
    expect(overlay.uniforms.uLineWidthPx.value).toBe(LATTICE_LINE_WIDTH_PX);
    expect(overlay.uniforms.uDotRadiusPx.value).toBe(LATTICE_DOT_RADIUS_PX);
    overlay.dispose();
  });

  it("fades build mode in over 150 ms, instantly under reduced motion", () => {
    const overlay = new LatticeOverlay(() => false);
    expect(overlay.update(0, 15)).toBe(false);
    overlay.setBuildMode(true);
    expect(overlay.update(1000, 15)).toBe(true);
    expect(overlay.uniforms.uBuildMode.value).toBe(0);
    expect(overlay.update(1000 + LATTICE_BUILD_FADE_MS / 2, 15)).toBe(true);
    expect(overlay.uniforms.uBuildMode.value).toBeCloseTo(0.5, 9);
    expect(overlay.update(1000 + LATTICE_BUILD_FADE_MS, 15)).toBe(false);
    expect(overlay.uniforms.uBuildMode.value).toBe(1);
    expect(overlay.uniforms.uLinePx.value).toBe(15);

    const reduced = new LatticeOverlay(() => true);
    reduced.setBuildMode(true);
    expect(reduced.uniforms.uBuildMode.value).toBe(1);
    expect(reduced.update(0, 15)).toBe(false);
    expect(reduced.toggleBuildMode()).toBe(false);
    expect(reduced.uniforms.uBuildMode.value).toBe(0);
  });
});
