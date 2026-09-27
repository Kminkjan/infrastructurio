import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { equals, nearestNode, toWorld } from "../../core/lattice";
import { nodeOfOffset } from "../../core/terrain";
import { createPrng } from "../../core/util/prng";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { ISO_PITCH_RAD, cameraBasis } from "../camera/isoMath";
import { simToWorld, worldToSim } from "../coords";
import { type PieceSpec, resolvePiece } from "../../core/sim/api";
import { conformTerrain } from "./earthworks";
import { intersectTerrain, raycastTerrain, sampleTerrainHeightM } from "./heightfieldRay";
import { forEachLatticeTriangle } from "./offsetGrid";

/** Two-sided Möller–Trumbore: ray parameter of the hit, or undefined. */
function rayTriangle(o: Vector3, d: Vector3, a: Vector3, b: Vector3, c: Vector3): number | undefined {
  const e1 = new Vector3().subVectors(b, a);
  const e2 = new Vector3().subVectors(c, a);
  const p = new Vector3().crossVectors(d, e2);
  const det = e1.dot(p);
  if (Math.abs(det) < 1e-12) return undefined;
  const s = new Vector3().subVectors(o, a);
  const u = s.dot(p) / det;
  if (u < 0 || u > 1) return undefined;
  const q = new Vector3().crossVectors(s, e1);
  const v = d.dot(q) / det;
  if (v < 0 || u + v > 1) return undefined;
  const t = e2.dot(q) / det;
  return t >= 0 ? t : undefined;
}

describe("heightfield ray", () => {
  it("interpolates node heights exactly at nodes and linearly inside a triangle", () => {
    const t = makeTerrain(6, 5, (q, r) => 200 + 10 * q + 4 * r);
    for (let row = 0; row < t.rows; row++) {
      for (let col = 0; col < t.columns; col++) {
        const w = toWorld(nodeOfOffset(col, row));
        expect(sampleTerrainHeightM(t, w.x, w.y)).toBeCloseTo((t.heightsDm[row * t.columns + col] ?? 0) / 10, 9);
      }
    }
    // Centroid of the lattice triangle (0,0), (1,0), (0,1): mean of its corners.
    const a = toWorld(nodeOfOffset(0, 0));
    const b = toWorld(nodeOfOffset(1, 0));
    const c = toWorld(nodeOfOffset(0, 1));
    const mean = ((t.heightsDm[0] ?? 0) + (t.heightsDm[1] ?? 0) + (t.heightsDm[t.columns] ?? 0)) / 30;
    expect(sampleTerrainHeightM(t, (a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3)).toBeCloseTo(mean, 9);
    expect(sampleTerrainHeightM(t, -1, 1)).toBeUndefined();
    expect(sampleTerrainHeightM(t, 10, 1000)).toBeUndefined();
  });

  it("hits flat terrain where the analytic ray–plane answer says", () => {
    const t = makeTerrain(40, 40, () => 200);
    const origin = new Vector3(60, 200, -40);
    const dir = new Vector3(0.3, -1, -0.2).normalize();
    const hit = intersectTerrain(t, origin, dir);
    expect(hit).toBeDefined();
    const s = (20 - origin.y) / dir.y;
    const expected = origin.clone().addScaledVector(dir, s);
    expect(hit?.point.distanceTo(expected)).toBeLessThan(1e-6);
    const sim = worldToSim(expected);
    expect(hit && equals(hit.node, nearestNode({ x: sim.x, y: sim.y }))).toBe(true);
    expect(hit?.nodeHeightDm).toBe(200);
  });

  it("misses rays that point away from or past the map", () => {
    const t = makeTerrain(10, 10, () => 150);
    const out = new Vector3();
    expect(raycastTerrain(t, new Vector3(20, 100, -20), new Vector3(0, 1, 0), out)).toBe(false);
    expect(raycastTerrain(t, new Vector3(500, 100, -20), new Vector3(1, -0.1, 0), out)).toBe(false);
    expect(raycastTerrain(t, new Vector3(20, 100, -20), new Vector3(0, 0, 0), out)).toBe(false);
    expect(intersectTerrain(t, new Vector3(-50, 100, 50), new Vector3(0, -1, 0))).toBeUndefined();
  });

  it("agrees with a brute-force triangle raycast within 1 cm over 1,000 iso rays", () => {
    // Heights 0–2.5 m keep every slope under the iso ray's 35° descent (see raycastTerrain).
    const prng = createPrng("heightfield-ray-test");
    const t = makeTerrain(24, 24, () => prng.nextInt(26));
    const tris: [Vector3, Vector3, Vector3][] = [];
    const vertex = (col: number, row: number): Vector3 => {
      const w = toWorld(nodeOfOffset(col, row));
      return simToWorld(w.x, w.y, (t.heightsDm[row * t.columns + col] ?? 0) / 10);
    };
    forEachLatticeTriangle(0, t.columns - 1, 0, t.rows - 1, (ai, aj, bi, bj, ci, cj) => {
      tris.push([vertex(ai, aj), vertex(bi, bj), vertex(ci, cj)]);
    });

    let worst = 0;
    let nodeMismatches = 0;
    for (let i = 0; i < 1000; i++) {
      const yaw = (prng.nextInt(3600) / 3600) * 2 * Math.PI;
      const back = cameraBasis(yaw, ISO_PITCH_RAD).back;
      // Aim at an interior point so the ray enters through the top of the map's box.
      const aim = simToWorld(10 + prng.nextInt(9000) / 100, 10 + prng.nextInt(7000) / 100, 0);
      const origin = aim.clone().add(new Vector3(back.x, back.y, back.z).multiplyScalar(150));
      const dir = new Vector3(-back.x, -back.y, -back.z);

      let best: number | undefined;
      for (const [a, b, c] of tris) {
        const s = rayTriangle(origin, dir, a, b, c);
        if (s !== undefined && (best === undefined || s < best)) best = s;
      }
      const hit = intersectTerrain(t, origin, dir);
      expect(best).toBeDefined();
      expect(hit).toBeDefined();
      if (best === undefined || hit === undefined) continue;
      const expected = origin.clone().addScaledVector(dir, best);
      worst = Math.max(worst, hit.point.distanceTo(expected));
      const sim = worldToSim(expected);
      if (!equals(hit.node, nearestNode({ x: sim.x, y: sim.y }))) nodeMismatches++;
    }
    expect(worst).toBeLessThan(0.01);
    expect(nodeMismatches).toBe(0);
  });

  it("marches the drawn (earthworks) surface when given one, so the cursor lands on a cutting's floor", () => {
    // Flat ground at 20 m, a run along row 20 at 17 m: a 3 m cutting with a 6 m floor.
    const t = makeTerrain(60, 40, () => 200);
    const pieces = Array.from({ length: 12 }, (_, i) => {
      const res = resolvePiece({ kind: "straight", from: { q: 5 + i, r: 20, zMm: 17_000 }, heading: 0, z1Mm: 17_000 } as PieceSpec);
      if (!res.ok) throw new Error(res.failure.message);
      return { key: res.piece.key, prims: res.piece.prims, z0Mm: 17_000, z1Mm: 17_000 };
    });
    const field = conformTerrain(t, { pieces });
    const aim = { x: 5 * (11 + 10), y: 20 * 2.5 * Math.sqrt(3) + 1 };
    for (let k = 0; k < 6; k++) {
      const back = cameraBasis((k * Math.PI) / 3, ISO_PITCH_RAD).back;
      const target = simToWorld(aim.x, aim.y, 17);
      const origin = target.clone().add(new Vector3(back.x, back.y, back.z).multiplyScalar(120));
      const dir = new Vector3(-back.x, -back.y, -back.z);
      const out = new Vector3();
      expect(raycastTerrain(t, origin, dir, out, field)).toBe(true);
      expect(out.distanceTo(target)).toBeLessThan(0.01);
      // The sim's own heights put the same ray on the natural ground, metres away on the plan.
      expect(raycastTerrain(t, origin, dir, out)).toBe(true);
      const sim = worldToSim(out);
      expect(sim.z).toBeCloseTo(20, 6);
      expect(Math.hypot(sim.x - aim.x, sim.y - aim.y)).toBeGreaterThan(3);
    }
  });
});
