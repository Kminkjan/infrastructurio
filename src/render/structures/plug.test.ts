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

  it("draws nothing on a deep portal, whose drawn hill already stands over the face (no bowl to fill since the cutting stops at the portal plane)", () => {
    const { terrain, shading, frame } = site(400);
    const plug = new HillPlug(terrain, shading, frame, { left: 12, right: 12 }, 40, 30);
    expect(plug.data.triangleCount).toBe(0);
    expect(plug.heightAt(100 + 10, 90)).toBeCloseTo(40 + PLUG_LIFT_M, 9);
  });

  it("meets the drawn ground along its whole outline, within the lift: no tear (D4 feel-check fixes)", () => {
    const { terrain, shading, frame } = site(200);
    // The drawn ground: the natural 20 m, cut by a neighbour's 6 m-deep cutting across the plug (8–14 m right of the bore).
    const drawn = (x: number, y: number) => {
      const u = 90 - y;
      return u > 8 && u < 14 ? 14 : 20;
    };
    for (const [depth, half] of [
      [30, 20],
      [12, 9],
    ] as const) {
      const plug = new HillPlug(terrain, shading, frame, { left: 6, right: 6 }, depth, half, drawn);
      const d = plug.data;
      expect(d.triangleCount).toBeGreaterThan(50);
      // Edges used once are the plug's outline: every vertex there lies at the drawn ground plus the lift.
      const key = (v: number) => `${(d.positions[3 * v] ?? 0).toFixed(4)},${(d.positions[3 * v + 2] ?? 0).toFixed(4)}`;
      const uses = new Map<string, number>();
      const edge = (a: number, b: number) => [key(a), key(b)].sort().join("|");
      for (let t = 0; t < d.triangleCount; t++) for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as const) uses.set(edge(3 * t + a, 3 * t + b), (uses.get(edge(3 * t + a, 3 * t + b)) ?? 0) + 1);
      let outline = 0;
      let worst = 0;
      for (let t = 0; t < d.triangleCount; t++) {
        for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as const) {
          if (uses.get(edge(3 * t + a, 3 * t + b)) !== 1) continue;
          for (const v of [3 * t + a, 3 * t + b]) {
            const x = d.positions[3 * v] ?? 0;
            const y = -(d.positions[3 * v + 2] ?? 0);
            // In front of the face the plug is closed by the face and the wings; elsewhere it must meet the ground.
            if (x - frame.x <= PLUG_START_M + 1e-3 && Math.abs(y - frame.y) <= PORTAL_HALF_WIDTH_M + 6 + 1e-3) continue;
            outline += 1;
            worst = Math.max(worst, Math.abs((d.positions[3 * v + 1] ?? 0) - PLUG_LIFT_M - drawn(x, y)));
          }
        }
      }
      expect(outline).toBeGreaterThan(20);
      expect(worst, `plug ${depth} × ${half}`).toBeLessThan(0.01 + 1e-6);
    }
  });

  it("never refills a neighbour's cutting: over it the plug is the drawn ground or the mound, never the natural hill", () => {
    const { terrain, shading, frame } = site(200);
    const drawn = (x: number, y: number) => (90 - y > 8 && 90 - y < 14 ? 14 : 20);
    const plug = new HillPlug(terrain, shading, frame, { left: 6, right: 6 }, 30, 20, drawn);
    let checked = 0;
    for (let s = 1; s < 29; s += 0.5) {
      for (let u = 8.5; u < 13.5; u += 0.5) {
        const h = plug.heightAt(100 + s, 90 - u) - PLUG_LIFT_M;
        // At most the higher of the cutting's floor and the mound (plus the smooth maximum's k/4), so wherever the
        // mound is lower than the natural 20 m the cutting stays cut; the D4 render's plug put the natural hill back.
        const m = plug.mound(s, u);
        expect(h).toBeLessThanOrEqual(Math.max(14, m) + 0.15 + 1e-9);
        if (m < 18) {
          checked += 1;
          expect(h).toBeLessThan(19);
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it("stays under another track's cut envelope, as any fill does: the mound never covers a neighbour's formation", () => {
    const { terrain, shading, frame } = site(200);
    // A neighbour 11 m right of the bore in a cutting at 14 m: its formation to 3 m, then 1 : 1.5 up to the ground.
    const cut = (x: number, y: number) => {
      const d = Math.abs(90 - y - 11);
      return 14 + Math.max(0, d - 3) / 1.5;
    };
    const drawn = (x: number, y: number) => Math.min(20, cut(x, y));
    const plug = new HillPlug(terrain, shading, frame, { left: 6, right: 6 }, 30, 20, drawn, cut);
    let over = 0;
    for (let s = 1; s < 29; s += 0.25) {
      for (let u = -19; u < 19; u += 0.25) {
        const h = plug.heightAt(100 + s, 90 - u) - PLUG_LIFT_M;
        over = Math.max(over, h - cut(100 + s, 90 - u));
      }
    }
    expect(over).toBeLessThanOrEqual(1e-9);
    // On the neighbour's formation the plug is the formation itself.
    expect(plug.heightAt(100 + 2, 90 - 11) - PLUG_LIFT_M).toBeCloseTo(14, 9);
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
    // Another track's formation 8 m right of the bore (from 4.5 m out): that wing stops short of it, the other runs on.
    const blocked = portalWings(terrain, frame, "bridge", undefined, (x, y) => 90 - y > 4.5 && 90 - y < 11.5);
    expect(blocked.right).toBeLessThanOrEqual(4.5 - PORTAL_HALF_WIDTH_M);
    expect(blocked.left).toBeCloseTo(open.left, 9);
    // A neighbour's cutting that lowers the ground in front never draws a wing out beyond the portal's own section.
    const lowered = portalWings(terrain, frame, "ground", () => 10);
    expect(lowered.left).toBeCloseTo(cut.left, 9);
  });
});
