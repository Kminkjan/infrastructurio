import { describe, expect, it } from "vitest";
import { convexInwardFacing, downFacing, inwardFacing, sameGeometry, triangleCount, windingMismatches } from "../../../../tests/support/geometry";
import type { LotKind } from "../../../core/scenarios/baltic-diorama";
import { AssetRegistry, buildingVariant } from "../../art/AssetRegistry";
import { BUILDING_BUDGET, BUILDING_KINDS, HERO_BUDGET, buildBuilding, registerBuildingAssets } from "./grammar";

/** Footprints the scenario uses per kind (whole metres: length along the front, width across). */
const FOOTPRINTS: Readonly<Record<LotKind, readonly [number, number][]>> = {
  townhouse: [[10, 8], [12, 12], [11, 10]],
  "wooden-house": [[7, 8], [9, 10]],
  warehouse: [[12, 16], [14, 20]],
  church: [[30, 15]],
  station: [[16, 28]],
  "engine-shed": [[36, 13]],
  "water-tower": [[8, 8]],
  windmill: [[12, 12]],
  farmstead: [[22, 16]],
};
const SEEDS = [0, 1, 2, 3, 7, 42, 1234567, 0xffffffff];

function cases(): { kind: LotKind; lengthM: number; widthM: number; seed: number }[] {
  const out: { kind: LotKind; lengthM: number; widthM: number; seed: number }[] = [];
  for (const kind of BUILDING_KINDS) for (const [lengthM, widthM] of FOOTPRINTS[kind]) for (const seed of SEEDS) out.push({ kind, lengthM, widthM, seed });
  return out;
}

describe("building grammar", () => {
  it("keeps every kind within its triangle budget: 600, or 1,500 for the hero church", () => {
    for (const spec of cases()) {
      for (const lod of [0, 1] as const) {
        const parts = buildBuilding(spec, lod);
        const total = Object.values(parts.slots).reduce((n, b) => n + (b?.triangleCount ?? 0), 0);
        expect(parts.budget).toBe(spec.kind === "church" ? HERO_BUDGET : BUILDING_BUDGET);
        expect(total, `${spec.kind} ${spec.lengthM}×${spec.widthM} seed ${spec.seed} lod${lod}`).toBeLessThanOrEqual(parts.budget);
        expect(total).toBeGreaterThan(lod === 0 ? 40 : 8);
      }
    }
  });

  it("winds every triangle outward, agreeing with its normals", () => {
    for (const spec of cases()) {
      for (const builder of Object.values(buildBuilding(spec, 0).slots)) {
        if (!builder) continue;
        const g = builder.build();
        expect(windingMismatches(g), spec.kind).toBe(0);
        expect(inwardFacing(g, builder.parts), spec.kind).toBe(0);
      }
    }
  });

  it("faces convex parts away from their own centre and roof planes up, without trusting the recorded inside points", () => {
    for (const spec of cases()) {
      for (const lod of [0, 1] as const) {
        for (const [slot, builder] of Object.entries(buildBuilding(spec, lod).slots)) {
          if (!builder) continue;
          const g = builder.build();
          const label = `${spec.kind} ${slot} seed ${spec.seed} lod${lod}`;
          expect(convexInwardFacing(g, builder.parts), label).toBe(0);
          // Only a cone's or prism's recorded bottom cap (the water tower's roof soffit) may face down.
          if (slot === "roof") expect(downFacing(g, builder.parts), label).toBe(0);
        }
      }
    }
  });

  it("builds the same building from the same spec, and varies it with the seed", () => {
    for (const kind of BUILDING_KINDS) {
      const [lengthM, widthM] = FOOTPRINTS[kind][0]!;
      const a = buildBuilding({ kind, lengthM, widthM, seed: 99 }, 0);
      const b = buildBuilding({ kind, lengthM, widthM, seed: 99 }, 0);
      for (const slot of Object.keys(a.slots) as (keyof typeof a.slots)[]) {
        expect(sameGeometry(a.slots[slot]!.build(), b.slots[slot]!.build())).toBe(true);
      }
    }
    const looks = new Set(SEEDS.map((seed) => JSON.stringify(buildBuilding({ kind: "townhouse", lengthM: 11, widthM: 10, seed }, 0).slots.walls!.build().getAttribute("color").array.slice(0, 3))));
    expect(looks.size).toBeGreaterThan(2);
  });

  it("covers the grammar: one to three floors and all four roof shapes", () => {
    const floors = new Set<number>();
    const roofs = new Set<string>();
    for (const spec of cases()) {
      const parts = buildBuilding(spec, 0);
      floors.add(parts.floors);
      roofs.add(parts.roof);
    }
    expect([...floors].sort()).toEqual([1, 2, 3]);
    expect([...roofs].sort()).toEqual(["gable", "hip", "mansard", "tower"]);
  });

  it("anchors smoke on chimneys, doors at entrances and the windmill's sail hub", () => {
    for (const spec of cases()) {
      const { anchors, slots } = buildBuilding(spec, 0);
      if (["townhouse", "wooden-house", "station", "engine-shed", "farmstead"].includes(spec.kind)) expect(anchors.smoke?.length).toBeGreaterThan(0);
      expect(anchors.door?.length ?? 0).toBeGreaterThan(0);
      if (spec.kind === "windmill") {
        expect(anchors.sail_hub).toHaveLength(1);
        expect(slots.sails).toBeDefined();
      } else {
        expect(slots.sails).toBeUndefined();
      }
      for (const list of Object.values(anchors)) for (const p of list ?? []) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    }
  });

  it("stays within its footprint, apart from small overhangs", () => {
    for (const spec of cases()) {
      for (const builder of Object.values(buildBuilding(spec, 0).slots)) {
        const box = builder!.build().boundingBox!;
        expect(box.max.x).toBeLessThanOrEqual(spec.lengthM / 2 + 1.2);
        expect(box.min.x).toBeGreaterThanOrEqual(-spec.lengthM / 2 - 1.2);
        expect(box.max.z).toBeLessThanOrEqual(spec.widthM / 2 + 1.2);
        expect(box.min.z).toBeGreaterThanOrEqual(-spec.widthM / 2 - 1.2);
      }
    }
  });

  it("registers every kind, resolving a lot's variant to its footprint", () => {
    const registry = new AssetRegistry();
    registerBuildingAssets(registry);
    expect(registry.kinds).toEqual([...BUILDING_KINDS].sort());
    const asset = registry.get("townhouse", buildingVariant(11, 9, 5), 0);
    expect(asset.footprint).toContainEqual([5.5, 4.5]);
    expect(asset.triangles).toBeLessThanOrEqual(asset.triangleBudget);
    for (const g of Object.values(asset.slots)) g?.dispose();
  });
});
