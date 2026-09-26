import { describe, expect, it } from "vitest";
import { MeshBuilder } from "../scenery/meshBuilder";
import { AssetRegistry, buildingVariant, unpackBuildingVariant } from "./AssetRegistry";

function boxAsset() {
  const b = new MeshBuilder();
  b.box({ x: 0, z: 0, y0: 0, y1: 1, sx: 1, sz: 1 });
  return {
    slots: { walls: b.build() },
    anchors: { door: [{ x: 0.6, y: 0, z: 0 }] },
    footprint: [
      [0.5, 0.5],
      [0.5, -0.5],
      [-0.5, -0.5],
      [-0.5, 0.5],
    ] as const,
    triangleBudget: 20,
  };
}

describe("asset registry", () => {
  it("returns geometry per slot, anchors, a footprint and a budget for (kind, variant, lod)", () => {
    const registry = new AssetRegistry();
    registry.register("crate", () => boxAsset());
    const asset = registry.get("crate", 0, 0);
    expect(asset.kind).toBe("crate");
    expect(asset.slots.walls).toBeDefined();
    expect(asset.anchors.door).toEqual([{ x: 0.6, y: 0, z: 0 }]);
    expect(asset.footprint).toHaveLength(4);
    expect(asset.triangles).toBe(10);
    expect(asset.triangles).toBeLessThanOrEqual(asset.triangleBudget);
  });

  it("caches shared kinds per key and builds one-off kinds fresh", () => {
    const registry = new AssetRegistry();
    let calls = 0;
    registry.register("shared", () => (calls++, boxAsset()));
    registry.register("lot", () => boxAsset(), { cache: false });
    expect(registry.get("shared", 1, 0)).toBe(registry.get("shared", 1, 0));
    expect(registry.get("shared", 1, 1)).not.toBe(registry.get("shared", 1, 0));
    expect(calls).toBe(2);
    expect(registry.get("lot", 1, 0)).not.toBe(registry.get("lot", 1, 0));
    registry.dispose();
  });

  it("refuses unknown kinds, duplicate registrations and bad variants", () => {
    const registry = new AssetRegistry();
    registry.register("crate", () => boxAsset());
    expect(() => registry.register("crate", () => boxAsset())).toThrow(/already/);
    expect(() => registry.get("barrel", 0, 0)).toThrow(/no asset provider/);
    expect(() => registry.get("crate", -1, 0)).toThrow(RangeError);
    expect(() => registry.get("crate", 1.5, 0)).toThrow(RangeError);
    expect(registry.kinds).toEqual(["crate"]);
  });

  it("packs a lot's footprint and seed into a variant and back", () => {
    const v = buildingVariant(12, 9, 0xdeadbeef);
    expect(Number.isInteger(v) && v >= 0).toBe(true);
    expect(unpackBuildingVariant(v)).toEqual({ lengthM: 12, widthM: 9, seed: 0xdeadbeef & 0xfffff });
    expect(unpackBuildingVariant(buildingVariant(63, 63, 1))).toEqual({ lengthM: 63, widthM: 63, seed: 1 });
    expect(() => buildingVariant(0, 5, 1)).toThrow(RangeError);
    expect(() => buildingVariant(64, 5, 1)).toThrow(RangeError);
    expect(() => buildingVariant(10.5, 5, 1)).toThrow(RangeError);
  });
});
