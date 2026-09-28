import { describe, expect, it } from "vitest";
import { Box3 } from "three";
import { allFinite, inwardFacing, solidsFacingIn, triangleCount, windingMismatches } from "../../../tests/support/geometry";
import { AssetRegistry } from "../art/AssetRegistry";
import {
  ABUTMENT_KIND,
  ARCH_KIND,
  GIRDER_KIND,
  PIER_KIND,
  PORTAL_KIND,
  STRUCTURE_BUDGETS,
  TRUSS_KIND,
  abutmentVariant,
  archCurve,
  archVariant,
  buildAbutment,
  buildArchSpan,
  buildGirderSpan,
  buildPier,
  buildPortal,
  buildTrussSpan,
  pierVariant,
  portalSkylineV,
  portalVariant,
  registerStructureAssets,
  spanVariant,
  unpackArch,
  unpackPier,
  unpackPortal,
} from "./assets";
import { ARCH_CROWN_V, DECK_HALF_M, PARAPET_TOP_V, PIER_THICKNESS_M, PORTAL_TOP_V } from "./dimensions";
import { STRUCTURE_SLOTS, type StructureBuilder } from "./structureBuilder";

/** Every slot of a built part: winding agrees with normals, faces away from each part's inside point and from each solid's centroid. */
function checkWinding(sb: StructureBuilder): void {
  const slots = sb.build();
  for (const slot of STRUCTURE_SLOTS) {
    const g = slots[slot];
    if (!g) continue;
    expect(windingMismatches(g), `${slot} winding`).toBe(0);
    expect(inwardFacing(g, sb.builders[slot].parts), `${slot} inside points`).toBe(0);
    expect(solidsFacingIn(g, sb.solids.filter((s) => s.slot === slot)), `${slot} solids`).toBe(0);
    expect(allFinite(g), `${slot} finite`).toBe(true);
    g.dispose();
  }
}

function bounds(sb: StructureBuilder): Box3 {
  const box = new Box3();
  for (const g of Object.values(sb.build())) {
    g.computeBoundingBox();
    if (g.boundingBox) box.union(g.boundingBox);
    g.dispose();
  }
  return box;
}

describe("structure generators", () => {
  it("wind every arch span outward, semicircular, segmental and solid, within budget and the deck's box", () => {
    for (const [length, rise, depth] of [
      [12, 5.1, 0],
      [8, 3.1, 0],
      [16, 2, 0],
      [12, 0.8, 0],
      [12, 0, 4.5],
      [3, 0, 2],
      [26, 12, 0],
    ] as const) {
      const sb = buildArchSpan(length, rise, depth);
      checkWinding(sb);
      expect(sb.triangleCount, `${length}/${rise}`).toBeLessThanOrEqual(STRUCTURE_BUDGETS[ARCH_KIND]);
      const box = bounds(sb);
      expect(box.min.x).toBeGreaterThanOrEqual(-1e-9);
      expect(box.max.x).toBeLessThanOrEqual(length + 1e-9);
      expect(box.max.z).toBeLessThanOrEqual(DECK_HALF_M + 0.1 + 1e-9);
      expect(box.min.z).toBeGreaterThanOrEqual(-DECK_HALF_M - 0.1 - 1e-9);
      expect(box.max.y).toBeCloseTo(PARAPET_TOP_V + 0.12, 5);
    }
  });

  it("springs arches from the pier faces and crowns them at the crown level", () => {
    const { inner, springV } = archCurve(12, 5.1);
    expect(inner[0]?.x).toBeCloseTo(PIER_THICKNESS_M / 2, 9);
    expect(inner[inner.length - 1]?.x).toBeCloseTo(12 - PIER_THICKNESS_M / 2, 9);
    expect(inner[0]?.y).toBeCloseTo(springV, 9);
    // The keystone's chord spans the crown, so the highest sample lies just under it.
    const top = Math.max(...inner.map((p) => p.y));
    expect(top).toBeLessThanOrEqual(ARCH_CROWN_V + 1e-9);
    expect(top).toBeGreaterThan(ARCH_CROWN_V - 0.06);
    // An odd number of voussoirs, so a keystone sits on the crown.
    expect((inner.length - 1) % 2).toBe(1);
  });

  it("wind every steel span outward within budget", () => {
    for (const length of [10, 22, 30, 40, 64, 90]) {
      const truss = buildTrussSpan(length);
      checkWinding(truss);
      expect(truss.triangleCount, `truss ${length}`).toBeLessThanOrEqual(STRUCTURE_BUDGETS[TRUSS_KIND]);
      const girder = buildGirderSpan(Math.min(length, 30));
      checkWinding(girder);
      expect(girder.triangleCount, `girder ${length}`).toBeLessThanOrEqual(STRUCTURE_BUDGETS[GIRDER_KIND]);
      for (const box of [bounds(truss), bounds(girder)]) {
        // Only the bed blocks under the bearings reach past the supports' centres.
        expect(box.min.x).toBeGreaterThanOrEqual(-0.05 - 1e-6);
        expect(box.max.z).toBeLessThanOrEqual(DECK_HALF_M + 0.36);
      }
    }
  });

  it("wind piers (dry and in water), abutments and portals outward within budget", () => {
    for (const h of [0.6, 3, 9, 18, 40]) {
      for (const wet of [false, true]) {
        const pier = buildPier(h, wet);
        checkWinding(pier);
        expect(pier.triangleCount).toBeLessThanOrEqual(STRUCTURE_BUDGETS[PIER_KIND]);
        const box = bounds(pier);
        expect(box.min.y).toBeCloseTo(0, 5);
        expect(box.max.y).toBeCloseTo(Math.max(0.6, h), 5);
      }
      const abutment = buildAbutment(h);
      checkWinding(abutment);
      expect(abutment.triangleCount).toBeLessThanOrEqual(STRUCTURE_BUDGETS[ABUTMENT_KIND]);
    }
    for (const [l, r, d] of [
      [0, 0, 1.5],
      [6, 12.5, 2],
      [25.5, 25.5, 12],
    ] as const) {
      const portal = buildPortal(l, r, d);
      checkWinding(portal);
      expect(portal.triangleCount).toBeLessThanOrEqual(STRUCTURE_BUDGETS[PORTAL_KIND]);
      const box = bounds(portal);
      expect(box.max.y).toBeCloseTo(PORTAL_TOP_V + 0.6 + 0.12, 5);
    }
  });

  it("falls the portal's wings at 1 : 1.5 from the face top", () => {
    expect(portalSkylineV(0)).toBe(PORTAL_TOP_V);
    expect(portalSkylineV(-4.2)).toBe(PORTAL_TOP_V);
    expect(portalSkylineV(7.2)).toBeCloseTo(PORTAL_TOP_V - 2, 12);
  });
});

describe("structure variants and the registry", () => {
  it("packs and unpacks dimensions in decimetres", () => {
    expect(unpackArch(archVariant(12.34, 5.1, 0))).toEqual({ lengthM: 12.3, riseM: 5.1, solidDepthM: 0 });
    expect(unpackArch(archVariant(9, 0, 17.26))).toEqual({ lengthM: 9, riseM: 0, solidDepthM: 17.3 });
    expect(spanVariant(40.04)).toBe(400);
    expect(unpackPier(pierVariant(21.6, true))).toEqual({ heightM: 21.6, wet: true });
    expect(abutmentVariant(3.25)).toBe(33);
    expect(unpackPortal(portalVariant(4.5, 12, 2))).toEqual({ wingLeftM: 4.5, wingRightM: 12, depthM: 2 });
    for (const v of [archVariant(102, 12.7, 51.1), spanVariant(409), pierVariant(204, true), portalVariant(25.5, 25.5, 12.7)]) {
      expect(Number.isInteger(v) && v >= 0 && v < 2 ** 31).toBe(true);
    }
  });

  it("serves every kind by slot with a footprint and a budget, cached until disposed", () => {
    const registry = new AssetRegistry();
    registerStructureAssets(registry);
    expect(registry.kinds).toEqual([ABUTMENT_KIND, ARCH_KIND, GIRDER_KIND, PIER_KIND, TRUSS_KIND, PORTAL_KIND].sort());
    const arch = registry.get(ARCH_KIND, archVariant(12, 5.1, 0), 0);
    expect(Object.keys(arch.slots).sort()).toEqual(["trim", "walls"]);
    expect(arch.triangles).toBeLessThanOrEqual(arch.triangleBudget);
    expect(arch.footprint).toHaveLength(4);
    expect(registry.get(ARCH_KIND, archVariant(12, 5.1, 0), 0)).toBe(arch);
    const truss = registry.get(TRUSS_KIND, spanVariant(40), 0);
    expect(Object.keys(truss.slots).sort()).toEqual(["metal", "trim"]);
    const portal = registry.get(PORTAL_KIND, portalVariant(8, 8, 1.5), 0);
    expect(Object.keys(portal.slots).sort()).toEqual(["metal", "trim", "walls"]);
    expect(triangleCount(portal.slots.walls!)).toBeGreaterThan(0);
    registry.dispose();
  });
});
