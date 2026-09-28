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
import { cameraBasis, yawForStep } from "../camera/isoMath";
import { ARCH_CROWN_V, DECK_HALF_M, PARAPET_TOP_V, PIER_THICKNESS_M, PORTAL_HALF_WIDTH_M, PORTAL_MAX_WING_M, PORTAL_TOP_V } from "./dimensions";
import { wallFootV, wingCopingV } from "./portalOutline";
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

  it("never draws a wing inside out: its wall feet stay 2.5 m under the coping, and no masonry stands above it, up to 25 m", () => {
    for (const depth of [1, 1.5, 12.7]) {
      for (let t = 0; t <= PORTAL_MAX_WING_M + 1; t += 0.1) {
        for (const steep of [false, true]) expect(wallFootV(wingCopingV(t, steep), depth)).toBeLessThanOrEqual(wingCopingV(t, steep) - 2.5 + 1e-9);
      }
      const portal = buildPortal(25.5, 25.5, depth, false, true);
      const g = portal.build().walls;
      const p = g?.getAttribute("position");
      expect(p?.count).toBeGreaterThan(0);
      for (let i = 0; i < (p?.count ?? 0); i++) {
        const z = Math.abs(p?.getZ(i) ?? 0);
        if (z <= PORTAL_HALF_WIDTH_M + 0.2) continue;
        // A wing vertex stands at most at its skyline (the back face lies 0.4 m further out, the end pier 0.5 m over it).
        expect(p?.getY(i) ?? 0, `depth ${depth} |z| ${z.toFixed(2)}`).toBeLessThanOrEqual(portalSkylineV(Math.max(PORTAL_HALF_WIDTH_M, z - 1.2)) + 0.5 + 1e-6);
      }
      g?.dispose();
    }
  });

  it("gives the face wall, its cornice and the wing walls back faces into the hill", () => {
    const portal = buildPortal(6, 6, 1.5);
    const walls = portal.build();
    // Triangles facing +X (into the hill) at the face wall's back and the cornice's back, and the wings' backs
    // facing (cos 30°, ±sin 30°) behind them.
    let faceBack = 0;
    let wingBacks = 0;
    for (const g of [walls.walls, walls.trim]) {
      const p = g?.getAttribute("position");
      const n = g?.getAttribute("normal");
      for (let i = 0; i < (p?.count ?? 0); i += 3) {
        const nx = n?.getX(i) ?? 0;
        const nz = n?.getZ(i) ?? 0;
        if (nx > 0.99 && Math.abs((p?.getX(i) ?? 0) - 1) < 1e-6) faceBack += 1;
        if (nx > 0.85 && nx < 0.88 && Math.abs(Math.abs(nz) - 0.5) < 0.01 && Math.abs(p?.getZ(i) ?? 0) > PORTAL_HALF_WIDTH_M) wingBacks += 1;
      }
      g?.dispose();
    }
    expect(faceBack).toBeGreaterThan(20);
    expect(wingBacks).toBeGreaterThan(10);
  });

  it("shows front masonry at 4 of the 6 yaws for a portal on a primary heading (splayed wings), where straight ones showed 2", () => {
    // Model space is the world frame of a portal whose tunnel runs east: +X east, +Z south (right of travel), +Y up.
    const shown = (withWings: boolean) => {
      const portal = buildPortal(5, 5, 1.5);
      const slots = portal.build();
      const areas = Array.from({ length: 6 }, (_, k) => {
        const back = cameraBasis(yawForStep(k)).back;
        let area = 0;
        for (const g of [slots.walls, slots.trim]) {
          const p = g?.getAttribute("position");
          const n = g?.getAttribute("normal");
          for (let i = 0; i + 2 < (p?.count ?? 0); i += 3) {
            const nx = n?.getX(i) ?? 0;
            const ny = n?.getY(i) ?? 0;
            const nz = n?.getZ(i) ?? 0;
            // Masonry facing the approach (the face, the wings' fronts), turned toward the camera.
            if (nx > -0.1 || (!withWings && Math.abs(nz) > 0.01)) continue;
            const facing = nx * back.x + ny * back.y + nz * back.z;
            if (facing <= 0) continue;
            const ax = (p?.getX(i + 1) ?? 0) - (p?.getX(i) ?? 0);
            const ay = (p?.getY(i + 1) ?? 0) - (p?.getY(i) ?? 0);
            const az = (p?.getZ(i + 1) ?? 0) - (p?.getZ(i) ?? 0);
            const bx = (p?.getX(i + 2) ?? 0) - (p?.getX(i) ?? 0);
            const by = (p?.getY(i + 2) ?? 0) - (p?.getY(i) ?? 0);
            const bz = (p?.getZ(i + 2) ?? 0) - (p?.getZ(i) ?? 0);
            area += (Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2) * facing;
          }
        }
        return area;
      });
      for (const g of Object.values(slots)) g?.dispose();
      const most = Math.max(...areas);
      return areas.filter((a) => a > 0.05 * most).length;
    };
    // The face alone (all a straight-winged portal showed) at 2 yaws; with the splayed wings' fronts at 4.
    expect(shown(false)).toBe(2);
    expect(shown(true)).toBe(4);
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
    expect(unpackPortal(portalVariant(4.5, 12, 2))).toEqual({ wingLeftM: 4.5, wingRightM: 12, depthM: 2, steepLeft: false, steepRight: false });
    expect(unpackPortal(portalVariant(4.5, 12, 2, false, true))).toEqual({ wingLeftM: 4.5, wingRightM: 12, depthM: 2, steepLeft: false, steepRight: true });
    for (const v of [archVariant(102, 12.7, 51.1), spanVariant(409), pierVariant(204, true), portalVariant(25.5, 25.5, 12.7, true, true)]) {
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
