import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { SQRT3 } from "../../core/lattice";
import { DEFAULT_TERRAIN_SIZE, generateTerrain } from "../../core/terrain";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { simToWorld } from "../coords";
import {
  D11A_TERRAIN_COLOURS,
  WATER_DISTANCE_FAR,
  computeNodeColors,
  computeNodeNormals,
  computeTerrainShading,
  computeWaterDistance,
  localMeanHeights,
  smoothHeightsDm,
} from "./terrainShading";
import { TERRAIN_LOOKS } from "./terrainLook";

describe("terrain shading", () => {
  it("counts lattice rings to the nearest water node", () => {
    // One water node in the middle of a 9 × 9 map.
    const t = makeTerrain(9, 9, (_q, _r, col, row) => (col === 4 && row === 4 ? 90 : 120));
    const d = computeWaterDistance(t, 3);
    expect(d[4 * 9 + 4]).toBe(0);
    expect(d[4 * 9 + 5]).toBe(1);
    expect(d[4 * 9 + 7]).toBe(3);
    expect(d[4 * 9 + 8]).toBe(WATER_DISTANCE_FAR);
    // Row 5 is odd, so its neighbours of (4, 4) are columns 3 and 4.
    expect(d[5 * 9 + 3]).toBe(1);
    expect(d[5 * 9 + 4]).toBe(1);
    expect(d[5 * 9 + 5]).toBe(2);
    expect([...d].filter((v) => v === 1)).toHaveLength(6);
  });

  it("gives the exact analytic normal on a tilted plane, edges included", () => {
    // h = 3q + 7r dm is a plane: q and r are linear in x and y.
    const t = makeTerrain(12, 10, (q, r) => 300 + 3 * q + 7 * r);
    const normals = computeNodeNormals(t);
    // ∂h/∂x and ∂h/∂y in m/m, from q = x/5 − y/(5√3) and r = 2y/(5√3).
    const gx = 3 / 50;
    const gy = (-3 + 2 * 7) / (5 * SQRT3) / 10;
    const expected = simToWorld(-gx, -gy, 1).normalize();
    for (let i = 0; i < t.columns * t.rows; i++) {
      const n = new Vector3(normals[3 * i], normals[3 * i + 1], normals[3 * i + 2]);
      expect(n.distanceTo(expected)).toBeLessThan(1e-6);
    }
  });

  it("averages heights over a clamped window", () => {
    const flat = makeTerrain(7, 5, () => 150);
    expect([...localMeanHeights(flat, 3)].every((v) => v === 150)).toBe(true);
    // A spike at col 0 with radius 2: col 0 averages cols 0–2, col 2 cols 0–4, col 4 cols 2–4.
    const spike = makeTerrain(5, 1, (_q, _r, col) => (col === 0 ? 900 : 0));
    const mean = localMeanHeights(spike, 2);
    expect(mean[0]).toBeCloseTo(300, 6);
    expect(mean[2]).toBeCloseTo(180, 6);
    expect(mean[4]).toBeCloseTo(0, 6);
  });

  it("bakes finite colours in [0, 1], darker over deeper water, the same every run", () => {
    const t = generateTerrain({ seed: "baltic-diorama", ...DEFAULT_TERRAIN_SIZE });
    const a = computeTerrainShading(t);
    const b = computeTerrainShading(t);
    expect(a.colors).toEqual(b.colors);
    expect(a.normals).toEqual(b.normals);
    expect(a.colors.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
    expect(a.normals.every((v) => Number.isFinite(v))).toBe(true);
    expect(a.normals.filter((_, i) => i % 3 === 1).every((y) => y > 0)).toBe(true);
    const shallow = makeTerrain(3, 1, (_q, _r, col) => [98, 80, 70][col] ?? 0);
    const colors = computeTerrainShading(shallow).colors;
    const luminance = (i: number) => (colors[3 * i] ?? 0) + (colors[3 * i + 1] ?? 0) + (colors[3 * i + 2] ?? 0);
    expect(luminance(0)).toBeGreaterThan(luminance(1));
    expect(luminance(1)).toBeGreaterThan(luminance(2));
  });

  it("smooths heights with a six-neighbour binomial filter that keeps planes and flattens spikes", () => {
    const plane = makeTerrain(14, 12, (q, r) => 300 + 3 * q + 7 * r);
    const smoothed = smoothHeightsDm(plane, 2);
    // Two passes reach two rings; inside that margin a plane is exact.
    for (let row = 2; row < plane.rows - 2; row++) {
      for (let col = 2; col < plane.columns - 2; col++) expect(smoothed[row * plane.columns + col]).toBeCloseTo(plane.heightsDm[row * plane.columns + col] ?? 0, 9);
    }
    const spike = makeTerrain(9, 9, (_q, _r, col, row) => (col === 4 && row === 4 ? 180 : 100));
    const one = smoothHeightsDm(spike, 1);
    expect(one[4 * 9 + 4]).toBeCloseTo(100 + (2 * 80) / 8, 9);
    expect(one[4 * 9 + 5]).toBeCloseTo(100 + 80 / 8, 9);
    expect([...smoothHeightsDm(spike, 0)]).toEqual([...spike.heightsDm]);
  });

  it("keeps D11a's shading by default and gives the variants smoothed normals and a calmer bake", () => {
    const t = generateTerrain({ seed: "baltic-diorama", ...DEFAULT_TERRAIN_SIZE });
    const d11a = computeTerrainShading(t);
    const explicit = computeTerrainShading(t, D11A_TERRAIN_COLOURS);
    expect(explicit.colors).toEqual(d11a.colors);
    expect(explicit.normals).toEqual(d11a.normals);
    expect(computeNodeColors(t, d11a.waterDistance)).toEqual(d11a.colors);

    const calm = computeTerrainShading(t, TERRAIN_LOOKS.a.colours);
    expect(calm.colors.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
    expect(calm.normals.filter((_, i) => i % 3 === 1).every((y) => y > 0)).toBe(true);
    // Neighbouring normals differ less once the 1 dm height steps are smoothed away.
    const roughness = (n: Float32Array) => {
      let sum = 0;
      for (let row = 1; row < t.rows - 1; row++) {
        for (let col = 1; col < t.columns - 1; col++) {
          const i = 3 * (row * t.columns + col);
          sum += Math.hypot((n[i] ?? 0) - (n[i + 3] ?? 0), (n[i + 2] ?? 0) - (n[i + 5] ?? 0));
        }
      }
      return sum;
    };
    expect(roughness(calm.normals)).toBeLessThan(0.8 * roughness(d11a.normals));
    // The calmer bake spreads grass tones less than D11a's 70 m patches.
    const spread = (c: Float32Array) => {
      const g: number[] = [];
      for (let i = 0; i < t.water.length; i++) if (!t.water[i]) g.push(c[3 * i + 1] ?? 0);
      g.sort((a, b) => a - b);
      return (g[Math.floor(0.95 * g.length)] ?? 0) - (g[Math.floor(0.05 * g.length)] ?? 0);
    };
    expect(spread(calm.colors)).toBeLessThan(0.75 * spread(d11a.colors));
    // Smoothed normals on a plane stay exact in the interior.
    const plane = makeTerrain(16, 14, (q, r) => 300 + 3 * q + 7 * r);
    const exact = computeNodeNormals(plane);
    const fromSmoothed = computeNodeNormals(plane, smoothHeightsDm(plane, 2));
    const i = 3 * (7 * plane.columns + 8);
    for (let k = 0; k < 3; k++) expect(fromSmoothed[i + k]).toBeCloseTo(exact[i + k] ?? 0, 6);
  });
});
