import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { simToWorld } from "../coords";
import { chunkOf, headingYaw, planYaw } from "./placement";

describe("scenery placement", () => {
  it("turns model +X onto every lattice heading's world direction", () => {
    for (let h = 0; h < 12; h++) {
      const a = (h * Math.PI) / 6;
      const expected = simToWorld(Math.cos(a), Math.sin(a), 0);
      const forward = new Vector3(1, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), headingYaw(h));
      expect(forward.distanceTo(expected)).toBeLessThan(1e-12);
    }
  });

  it("points east at yaw 0 and north a quarter turn counter-clockwise from above", () => {
    expect(planYaw(1, 0)).toBeCloseTo(0, 12);
    // Sim north is world −Z; a positive yaw about +Y turns +X toward −Z.
    expect(planYaw(0, 1)).toBeCloseTo(Math.PI / 2, 12);
  });

  it("accepts unnormalised directions such as per-mille pole directions", () => {
    expect(planYaw(866, 500)).toBeCloseTo(planYaw(0.866, 0.5), 12);
  });

  it("buckets positions into chunks, flooring negatives", () => {
    expect(chunkOf(255.9, 0, 256)).toEqual({ cx: 0, cy: 0 });
    expect(chunkOf(256, 512, 256)).toEqual({ cx: 1, cy: 2 });
    expect(chunkOf(-0.1, 10, 256)).toEqual({ cx: -1, cy: 0 });
  });
});
