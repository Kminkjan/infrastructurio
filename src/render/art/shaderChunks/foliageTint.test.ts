import { describe, expect, it } from "vitest";
import { foliageColor } from "./foliageTint";

describe("foliage tint", () => {
  const trunk: [number, number, number] = [0.4, 0.3, 0.2];
  const tint: [number, number, number] = [0.2, 0.5, 0.25];

  it("leaves the trunk (mask 0) at its vertex colour", () => {
    expect(foliageColor(trunk, 0, tint)).toEqual(trunk);
  });

  it("multiplies the crown (mask 1) by the instance tint", () => {
    const crownAo: [number, number, number] = [0.9, 0.9, 0.9];
    const out = foliageColor(crownAo, 1, tint);
    out.forEach((v, i) => expect(v).toBeCloseTo(crownAo[i]! * tint[i]!, 12));
  });

  it("blends linearly for partial masks", () => {
    const half = foliageColor([1, 1, 1], 0.5, tint);
    half.forEach((v, i) => expect(v).toBeCloseTo((1 + tint[i]!) / 2, 12));
  });
});
