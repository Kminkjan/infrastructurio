import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { SQRT3 } from "../../core/lattice";
import { DEFAULT_TERRAIN_SIZE, generateTerrain } from "../../core/terrain";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { simToWorld } from "../coords";
import {
  WATER_DISTANCE_FAR,
  computeNodeNormals,
  computeTerrainShading,
  computeWaterDistance,
  localMeanHeights,
} from "./terrainShading";

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
});
