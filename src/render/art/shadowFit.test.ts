import { describe, expect, it } from "vitest";
import { DirectionalLight, Vector3 } from "three";
import { ISO_PITCH_RAD, type IsoView, NAMED_ZOOMS, cameraBasis, screenToWorldAtHeight, worldToScreen, yawForStep } from "../camera/isoMath";
import { SUN_ELEVATION_RAD, type WorldBox, fitShadowFrustum, lightBasis, quantizeExtent, sunDirection } from "./shadowFit";

const MAP: WorldBox = { minX: 0, maxX: 1997.5, minY: 7.5, maxY: 40.2, minZ: -1494, maxZ: 0 };
const HEIGHTS = { minM: MAP.minY, maxM: MAP.maxY };
const SIZE = 2048;

function view(k: number, ppm: number, target = { x: 1000, z: -750 }): IsoView {
  return { target, ppm, yaw: yawForStep(k), pitch: ISO_PITCH_RAD, cssWidth: 1440, cssHeight: 900 };
}

/** The eight footprint corners: viewport corners on the lowest and highest terrain planes. */
function footprint(v: IsoView): Vector3[] {
  const points: Vector3[] = [];
  for (const h of [HEIGHTS.minM, HEIGHTS.maxM]) {
    for (const [x, y] of [[0, 0], [v.cssWidth, 0], [0, v.cssHeight], [v.cssWidth, v.cssHeight]] as const) {
      const p = screenToWorldAtHeight(v, x, y, h);
      points.push(new Vector3(p.x, p.y, p.z));
    }
  }
  return points;
}

/** A three light configured from the fit, to check the conventions against the real shadow camera. */
function shadowLight(fit: ReturnType<typeof fitShadowFrustum>): DirectionalLight {
  const light = new DirectionalLight();
  light.position.set(fit.position.x, fit.position.y, fit.position.z);
  light.target.position.set(fit.target.x, fit.target.y, fit.target.z);
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();
  const cam = light.shadow.camera;
  Object.assign(cam, { left: fit.left, right: fit.right, top: fit.top, bottom: fit.bottom, near: fit.near, far: fit.far });
  cam.updateProjectionMatrix();
  light.shadow.updateMatrices(light);
  return light;
}

function insideNdc(p: Vector3, light: DirectionalLight): boolean {
  const ndc = p.clone().project(light.shadow.camera);
  return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && Math.abs(ndc.z) <= 1;
}

describe("sun direction", () => {
  it("sits at exactly 42° elevation as a unit vector", () => {
    for (let k = 0; k < 6; k++) {
      const s = sunDirection(yawForStep(k));
      expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 12);
      expect(Math.asin(s.y)).toBeCloseTo(SUN_ELEVATION_RAD, 12);
    }
  });

  it("keeps the smoke scene's direction at yaw 0", () => {
    const s = sunDirection(0);
    const h = Math.hypot(-0.55, 0.45);
    expect(s.x).toBeCloseTo((-0.55 / h) * Math.cos(SUN_ELEVATION_RAD), 12);
    expect(s.z).toBeCloseTo((0.45 / h) * Math.cos(SUN_ELEVATION_RAD), 12);
  });

  it("lights from the same upper-left screen direction at every yaw", () => {
    const s0 = sunDirection(0);
    const b0 = cameraBasis(0);
    const screen0 = [s0.x * b0.right.x + s0.z * b0.right.z, s0.x * b0.up.x + s0.y * b0.up.y + s0.z * b0.up.z];
    expect(screen0[0]).toBeLessThan(0);
    expect(screen0[1]).toBeGreaterThan(0);
    for (let k = 1; k < 6; k++) {
      const s = sunDirection(yawForStep(k));
      const b = cameraBasis(yawForStep(k));
      expect(s.x * b.right.x + s.z * b.right.z).toBeCloseTo(screen0[0] ?? 0, 12);
      expect(s.x * b.up.x + s.y * b.up.y + s.z * b.up.z).toBeCloseTo(screen0[1] ?? 0, 12);
    }
  });
});

describe("shadow frustum fit", () => {
  it("builds the same light basis as three's shadow camera", () => {
    const s = sunDirection(yawForStep(2));
    const basis = lightBasis(s);
    const light = new DirectionalLight();
    light.position.set(s.x * 100, s.y * 100, s.z * 100);
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
    light.shadow.updateMatrices(light);
    const m = light.shadow.camera.matrixWorld;
    for (const [col, axis] of [[0, basis.x], [1, basis.y], [2, basis.z]] as const) {
      const v = new Vector3().setFromMatrixColumn(m, col);
      expect(v.distanceTo(new Vector3(axis.x, axis.y, axis.z))).toBeLessThan(1e-9);
    }
  });

  it("quantises the extent to powers of 1.25", () => {
    expect(quantizeExtent(1)).toBe(1);
    expect(quantizeExtent(1.25)).toBeCloseTo(1.25, 12);
    expect(quantizeExtent(1.3)).toBeCloseTo(1.5625, 12);
    const e = quantizeExtent(777);
    expect(e).toBeGreaterThanOrEqual(777);
    expect(e / 1.25).toBeLessThan(777);
  });

  it("contains the view footprint for every yaw and zoom", () => {
    for (let k = 0; k < 6; k++) {
      for (const ppm of Object.values(NAMED_ZOOMS)) {
        const v = view(k, ppm);
        const fit = fitShadowFrustum(v, HEIGHTS, sunDirection(v.yaw), SIZE);
        const light = shadowLight(fit);
        for (const p of footprint(v)) expect(insideNdc(p, light)).toBe(true);
      }
    }
  });

  it("still covers every visible map point when clipped to the map", () => {
    for (let k = 0; k < 6; k++) {
      for (const ppm of [0.9, 2.5, 6]) {
        const v = view(k, ppm, { x: 300, z: -200 });
        const fit = fitShadowFrustum(v, HEIGHTS, sunDirection(v.yaw), SIZE, MAP);
        const light = shadowLight(fit);
        for (let x = MAP.minX; x <= MAP.maxX; x += 50) {
          for (let z = MAP.minZ; z <= MAP.maxZ; z += 50) {
            for (const y of [HEIGHTS.minM, HEIGHTS.maxM]) {
              const s = worldToScreen(v, { x, y, z });
              if (s.x < 0 || s.x > v.cssWidth || s.y < 0 || s.y > v.cssHeight) continue;
              expect(insideNdc(new Vector3(x, y, z), light)).toBe(true);
            }
          }
        }
        // At Far the whole map fits in view, and clipping shrinks the map below the unclipped one.
        if (ppm === 0.9) {
          const unclipped = fitShadowFrustum(v, HEIGHTS, sunDirection(v.yaw), SIZE);
          expect(fit.extent).toBeLessThanOrEqual(unclipped.extent);
        }
      }
    }
  });

  it("snaps the origin to whole texels and keeps the texel size across small pans", () => {
    let seed = 99;
    const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    for (let k = 0; k < 6; k++) {
      const base = fitShadowFrustum(view(k, 6), HEIGHTS, sunDirection(yawForStep(k)), SIZE);
      for (let i = 0; i < 25; i++) {
        const v = view(k, 6, { x: 1000 + (next() - 0.5) * 40, z: -750 + (next() - 0.5) * 40 });
        const fit = fitShadowFrustum(v, HEIGHTS, sunDirection(v.yaw), SIZE);
        expect(fit.texel).toBe(base.texel);
        const originX = (fit.centreX + fit.left) / fit.texel;
        const originY = (fit.centreY + fit.bottom) / fit.texel;
        expect(Math.abs(originX - Math.round(originX))).toBeLessThan(1e-6);
        expect(Math.abs(originY - Math.round(originY))).toBeLessThan(1e-6);
      }
    }
  });
});
