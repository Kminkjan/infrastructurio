import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { SIM_TO_WORLD, simToWorld, worldToSim } from "./coords";

describe("sim ↔ world coordinates", () => {
  it("is a proper rotation (determinant +1), never a mirror", () => {
    expect(SIM_TO_WORLD.determinant()).toBe(1);
  });

  it("keeps the frame right-handed: mapped east × mapped north = up", () => {
    const east = simToWorld(1, 0, 0);
    const north = simToWorld(0, 1, 0);
    const up = new Vector3().crossVectors(east, north);
    expect(up.toArray().map((v) => v + 0)).toEqual([0, 1, 0]);
    expect(simToWorld(0, 0, 1).toArray().map((v) => v + 0)).toEqual([0, 1, 0]);
  });

  it("matches the matrix and round-trips", () => {
    const p = { x: 12.5, y: -3.25, z: 4 };
    const viaMatrix = new Vector3(p.x, p.y, p.z).applyMatrix4(SIM_TO_WORLD);
    const direct = simToWorld(p.x, p.y, p.z);
    expect(viaMatrix.distanceTo(direct)).toBeLessThan(1e-12);
    expect(worldToSim(direct)).toEqual(p);
  });
});
