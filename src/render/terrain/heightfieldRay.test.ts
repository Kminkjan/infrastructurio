import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { equals, nearestNode, toWorld } from "../../core/lattice";
import { DEFAULT_TERRAIN_SIZE, generateTerrain, nodeOfOffset } from "../../core/terrain";
import { createPrng } from "../../core/util/prng";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { ISO_PITCH_RAD, cameraBasis } from "../camera/isoMath";
import { simToWorld, worldToSim } from "../coords";
import { type PieceSpec, resolvePiece } from "../../core/sim/api";
import { DrawnHeightfield, conformTerrain } from "./earthworks";
import { intersectTerrain, raycastTerrain, sampleTerrainHeightM, visibleGroundM, waterPlane } from "./heightfieldRay";
import { forEachLatticeTriangle } from "./offsetGrid";
import { WATER_MESH_RINGS, buildWaterData } from "./terrainGeometry";
import { computeTerrainShading, computeWaterDistance } from "./terrainShading";

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

  it("reads the one natural interpolation: the sim-height sampler and the drawn heightfield agree bit for bit off earthworks", () => {
    // Review finding (PR #83): three copies of the lattice interpolation had to stay bit-identical (the undo e2e
    // compares drawn and natural heights with toBe). Now `naturalHeightM` is the only one; pin that they agree.
    const prng = createPrng("one-interpolation");
    const t = makeTerrain(50, 40, () => 100 + prng.nextInt(300));
    const lod0 = new DrawnHeightfield(t, 0);
    const lod1 = new DrawnHeightfield(t, 1);
    let defined = 0;
    for (let k = 0; k < 20_000; k++) {
      // Over the map and a little past its edges, with some points exactly on nodes and lattice rows.
      const x = k % 7 === 0 ? 5 * prng.nextInt(52) - 5 : prng.nextInt(26_000) / 100 - 5;
      const y = k % 5 === 0 ? 2.5 * Math.sqrt(3) * prng.nextInt(42) - 4 : prng.nextInt(18_000) / 100 - 5;
      const natural = lod0.naturalAtM(x, y);
      expect(Object.is(sampleTerrainHeightM(t, x, y) ?? Number.NaN, natural)).toBe(true);
      expect(Object.is(lod0.heightAtM(x, y), natural)).toBe(true);
      expect(Object.is(lod1.heightAtM(x, y), lod1.naturalAtM(x, y))).toBe(true);
      if (!Number.isNaN(natural)) defined += 1;
    }
    expect(defined).toBeGreaterThan(15_000);
  });

  it("gives the ghost the ground the player sees: a cutting's floor, not the natural hill; the water over a lower bed", () => {
    // Review finding (PR #83): the ghost's drop lines and end-height tags read the natural heights while picking read
    // the drawn ones, so over a cutting they pointed metres above its floor. Flat ground at 20 m with a lake bed at
    // 9 m west of column 10 (water at 10 m), and a run along row 20 at 17 m: a 3 m cutting with a 6 m floor.
    const t = makeTerrain(60, 40, (_q, _r, col) => (col < 10 ? 90 : 200));
    const pieces = Array.from({ length: 12 }, (_, i) => {
      const res = resolvePiece({ kind: "straight", from: { q: 15 + i, r: 20, zMm: 17_000 }, heading: 0, z1Mm: 17_000 } as PieceSpec);
      if (!res.ok) throw new Error(res.failure.message);
      return { key: res.piece.key, prims: res.piece.prims, z0Mm: 17_000, z1Mm: 17_000 };
    });
    const field = conformTerrain(t, { pieces });
    const water = waterPlane(t, computeWaterDistance(t));
    const y0 = 20 * 2.5 * Math.sqrt(3);
    // On the floor beside the track: the drawn 17 m, where the sim's heights say 20 m.
    expect(sampleTerrainHeightM(t, 5 * (21 + 10), y0 + 1)).toBeCloseTo(20, 9);
    expect(visibleGroundM(field, water, 5 * (21 + 10), y0 + 1)).toBeCloseTo(17, 5);
    // Away from the earthworks it is the natural ground, bit for bit; over the lake, the water plane; off the map, nothing.
    expect(visibleGroundM(field, water, 200, 40)).toBe(sampleTerrainHeightM(t, 200, 40));
    expect(visibleGroundM(field, water, 20, 40)).toBe(10);
    expect(visibleGroundM(field, water, -5, 40)).toBeUndefined();
  });

  it("reads the water plane only where its mesh is drawn: a dry cutting below the water level shows its floor", () => {
    // Re-review finding (PR #83): the ghost's ground took max(drawn, water level) everywhere, but the water mesh covers
    // only triangles within WATER_MESH_RINGS of water, so over a dry cutting deeper than the water level the tags and
    // drop lines measured from a water plane that is not there. A lake west of column 10 (bed 9 m, water at 10 m),
    // land at 11 m east of it, and two runs at 8.5 m: one far from the lake, one inside the mesh's rings.
    const t = makeTerrain(80, 40, (_q, _r, col) => (col < 10 ? 90 : 110));
    const run = (q0: number, r: number) =>
      Array.from({ length: 11 }, (_, i) => {
        const res = resolvePiece({ kind: "straight", from: { q: q0 + i, r, zMm: 8500 }, heading: 0, z1Mm: 8500 } as PieceSpec);
        if (!res.ok) throw new Error(res.failure.message);
        return { key: res.piece.key, prims: res.piece.prims, z0Mm: 8500, z1Mm: 8500 };
      });
    const distance = computeWaterDistance(t);
    const field = conformTerrain(t, { pieces: [...run(30, 20), ...run(-8, 30)] });
    const water = waterPlane(t, distance);
    // Far from the lake (columns 40–51 on row 20: 30 rings away) the cutting's floor is drawn at 8.5 m, 1.5 m under
    // the water level, and no water mesh covers it: the ghost measures the floor.
    const far = { x: 5 * (35 + 10), y: 20 * 2.5 * Math.sqrt(3) };
    expect(distance[20 * t.columns + 45]).toBeGreaterThan(WATER_MESH_RINGS);
    expect(field.heightAtM(far.x, far.y)).toBeCloseTo(8.5, 5);
    expect(water.covers(far.x, far.y)).toBe(false);
    expect(visibleGroundM(field, water, far.x, far.y)).toBeCloseTo(8.5, 5);
    // Beside the lake (column 12 on row 30: 2 rings away) the water mesh is drawn over the cutting, so the player
    // sees water there, and so does the ghost.
    const near = { x: 5 * 12, y: 30 * 2.5 * Math.sqrt(3) };
    expect(distance[30 * t.columns + 12]).toBeLessThanOrEqual(WATER_MESH_RINGS);
    expect(field.heightAtM(near.x, near.y)).toBeCloseTo(8.5, 5);
    expect(water.covers(near.x, near.y)).toBe(true);
    expect(visibleGroundM(field, water, near.x, near.y)).toBe(10);
    // The plane covers exactly the triangles `buildWaterData` draws.
    const shading = computeTerrainShading(t);
    const mesh = buildWaterData(t, shading, 0);
    const drawn = new Set<string>();
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const corners = [0, 1, 2].map((k) => mesh.nodeIndices[mesh.indices[i + k] ?? 0] ?? 0).sort((a, b) => a - b);
      drawn.add(corners.join(","));
    }
    let checked = 0;
    forEachLatticeTriangle(0, t.columns - 1, 0, t.rows - 1, (ai, aj, bi, bj, ci, cj) => {
      const corners = [aj * t.columns + ai, bj * t.columns + bi, cj * t.columns + ci];
      const c = corners.map((n) => toWorld(nodeOfOffset(n % t.columns, Math.floor(n / t.columns))));
      const cx = (c[0]!.x + c[1]!.x + c[2]!.x) / 3;
      const cy = (c[0]!.y + c[1]!.y + c[2]!.y) / 3;
      expect(water.covers(cx, cy), `triangle ${corners.join(",")}`).toBe(drawn.has(corners.sort((a, b) => a - b).join(",")));
      checked += 1;
    });
    expect(checked).toBeGreaterThan(5000);
  });

  it("reads the diorama's dry cutting floor, seven rings from water (the re-review's case)", () => {
    // Offset (41, 141) lies 7 rings from water on natural ground about 11.5 m high; an 11-piece straight there with its
    // bed at 8.5 m draws its floor at 8.5 m, and the ghost read the 10 m water level.
    const t = generateTerrain({ seed: "baltic-diorama", ...DEFAULT_TERRAIN_SIZE });
    const distance = computeWaterDistance(t);
    expect(distance[141 * t.columns + 41]).toBe(7);
    const node = nodeOfOffset(41, 141);
    const pieces = Array.from({ length: 11 }, (_, i) => {
      const res = resolvePiece({ kind: "straight", from: { q: node.q - 5 + i, r: node.r, zMm: 8500 }, heading: 0, z1Mm: 8500 } as PieceSpec);
      if (!res.ok) throw new Error(res.failure.message);
      return { key: res.piece.key, prims: res.piece.prims, z0Mm: 8500, z1Mm: 8500 };
    });
    const field = conformTerrain(t, { pieces });
    const at = toWorld(node);
    expect(field.naturalAtM(at.x, at.y)).toBeGreaterThan(t.waterLevelDm / 10 + 1);
    expect(field.heightAtM(at.x, at.y)).toBeCloseTo(8.5, 5);
    expect(visibleGroundM(field, waterPlane(t, distance), at.x, at.y)).toBeCloseTo(8.5, 5);
  });
});
