import { describe, expect, it } from "vitest";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { computeTerrainShading } from "../terrain/terrainShading";
import { EARTHWORK_WEIGHT_FROM_X } from "../terrain/earthworks";
import { portalSkylineV } from "./assets";
import { PORTAL_HALF_WIDTH_M, PORTAL_TOP_V } from "./dimensions";
import { HillPlug, MOUND_FLAT_M, PLUG_LIFT_M, PLUG_START_M, PLUG_UNDER_COPING_M, portalWings } from "./plug";

function site(groundDm: number) {
  const terrain = makeTerrain(60, 50, () => groundDm);
  const shading = computeTerrainShading(terrain);
  // A portal facing west at plan (100, 90), its tunnel running east (+x) at 16 m.
  const frame = { x: 100, y: 90, z: 16, tx: 1, ty: 0 };
  return { terrain, shading, frame };
}

/** World-space face normal y of triangle t (non-indexed positions). */
function faceUp(p: Float32Array, t: number): number {
  const i = 9 * t;
  const ux = (p[i + 3] ?? 0) - (p[i] ?? 0);
  const uy = (p[i + 4] ?? 0) - (p[i + 1] ?? 0);
  const uz = (p[i + 5] ?? 0) - (p[i + 2] ?? 0);
  const vx = (p[i + 6] ?? 0) - (p[i] ?? 0);
  const vy = (p[i + 7] ?? 0) - (p[i + 1] ?? 0);
  const vz = (p[i + 8] ?? 0) - (p[i + 2] ?? 0);
  return uz * vx - ux * vz === 0 && uy === 0 && vy === 0 ? 0 : uz * vx - ux * vz;
}

describe("hill plug", () => {
  it("raises a mound over a shallow bore: the face top at the face, the ground again well behind it", () => {
    const { terrain, shading, frame } = site(200);
    const plug = new HillPlug(terrain, shading, frame, { left: 6, right: 6 }, 30, 20);
    const top = frame.z + PORTAL_TOP_V + PLUG_UNDER_COPING_M + PLUG_LIFT_M;
    expect(plug.heightAt(100 + PLUG_START_M + 0.1, 90)).toBeCloseTo(top, 9);
    // Flat over the bore, then falling toward the natural ground.
    expect(plug.heightAt(100 + MOUND_FLAT_M, 90)).toBeCloseTo(top, 9);
    expect(plug.heightAt(100 + MOUND_FLAT_M + 3, 90)).toBeCloseTo(top - 1, 9);
    expect(plug.heightAt(100 + 29, 90)).toBeCloseTo(20 + PLUG_LIFT_M, 9);
    // Along the face its line follows the wings' skyline.
    expect(plug.heightAt(100 + PLUG_START_M + 0.1, 90 - (PORTAL_HALF_WIDTH_M + 3))).toBeCloseTo(frame.z + portalSkylineV(PORTAL_HALF_WIDTH_M + 3) + PLUG_UNDER_COPING_M + PLUG_LIFT_M, 9);
    // Nothing in front of the face.
    expect(Number.isNaN(plug.heightAt(100, 90))).toBe(true);
    expect(Number.isNaN(plug.heightAt(100 - 2, 90))).toBe(true);
  });

  it("fills a deep cutting's end up to a 1 : 1.5 slope from the face top, meeting the hill where it does", () => {
    const { terrain, shading, frame } = site(400);
    const plug = new HillPlug(terrain, shading, frame, { left: 12, right: 12 }, 40, 30);
    const face = frame.z + PORTAL_TOP_V + PLUG_UNDER_COPING_M;
    expect(plug.heightAt(100 + 1, 90)).toBeCloseTo(face + PLUG_LIFT_M, 9);
    expect(plug.heightAt(100 + 10, 90)).toBeCloseTo(face + 9 / 1.5 + PLUG_LIFT_M, 9);
    expect(plug.heightAt(100 + 35, 90)).toBeCloseTo(40 + PLUG_LIFT_M, 9);
  });

  it("faces every triangle up, starts at the face line, and marks made ground for the terrain shader", () => {
    const { terrain, shading, frame } = site(200);
    const plug = new HillPlug(terrain, shading, frame, { left: 6, right: 6 }, 30, 20);
    const d = plug.data;
    expect(d.triangleCount).toBeGreaterThan(100);
    for (let t = 0; t < d.triangleCount; t++) expect(faceUp(d.positions, t)).toBeGreaterThan(0);
    for (let v = 0; v < d.triangleCount * 3; v++) {
      expect(d.positions[3 * v] ?? 0).toBeGreaterThanOrEqual(100 + PLUG_START_M - 1e-4);
      expect(d.normals[3 * v + 1] ?? 0).toBeGreaterThan(0);
      const lip = d.earthwork[3 * v] ?? 0;
      expect(lip).toBeGreaterThanOrEqual(0);
      expect(lip).toBeLessThanOrEqual(EARTHWORK_WEIGHT_FROM_X + 1e-9);
    }
    // Made ground (the mound) carries the full lip weight; far natural ground none.
    const lips = Array.from({ length: d.triangleCount * 3 }, (_, v) => d.earthwork[3 * v] ?? 0);
    expect(Math.max(...lips)).toBeCloseTo(EARTHWORK_WEIGHT_FROM_X, 6);
    expect(Math.min(...lips)).toBe(0);
    expect(plug.maxZ).toBeCloseTo(frame.z + PORTAL_TOP_V + PLUG_UNDER_COPING_M + PLUG_LIFT_M, 6);
  });

  it("runs each wing out until its falling skyline meets the ground in front", () => {
    const { terrain, frame } = site(200);
    // Flat ground 4 m over the track: in a cutting the wing ends where the cut's side slope meets the skyline.
    const cut = portalWings(terrain, frame, "ground");
    expect(cut.left).toBeCloseTo(cut.right, 9);
    expect(cut.left).toBeGreaterThan(3);
    expect(cut.left).toBeLessThan(12);
    // Over open ground (a bridge in front) it runs until the skyline meets the natural ground: 4 m up at the face top − 3.4 m.
    const open = portalWings(terrain, frame, "bridge");
    expect(open.left).toBeCloseTo(1.5 * (PORTAL_TOP_V - 4), 0);
  });
});
