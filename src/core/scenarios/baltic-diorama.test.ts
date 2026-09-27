import { describe, expect, it } from "vitest";
import { DEFAULT_TERRAIN_SIZE, type Terrain, generateTerrain } from "../terrain";
import {
  DIORAMA_SEED,
  type DioramaScenery,
  TELEGRAPH_SPACING_MM,
  generateDiorama,
  sceneryHash,
} from "./baltic-diorama";
import { MAX_TREES, TREES_PER_FULL_CELL } from "./forest";
import { createGround, edgeDistanceMm, reliefAround, waterRingsNear } from "./ground";
import { LOT_MAX_RELIEF_DM, lotBox } from "./layout";
import { BALTIC_PLACE_NAMES } from "./placeNames";
import { type PointMm, distanceMm, obbCorners, obbOverlap, obbRadiusMm, polylineDistanceMm } from "./shapes";

/**
 * Recorded 2026-09-26 from diorama generator version 2 on terrain version 2
 * (`d2ee8189`). Version 2 removed the railway set pieces at the owner's
 * request (stations and depots are player-built, D6); the bookmark states did
 * not move. A change here can move the Look Gate A bookmarks' subject: bump
 * DIORAMA_GENERATOR_VERSION and re-record deliberately.
 */
const GOLDEN_SCENERY_HASH = "d4aeaa71";

const terrain = generateTerrain({ seed: DIORAMA_SEED, ...DEFAULT_TERRAIN_SIZE });
const golden = generateDiorama(terrain);
const otherTerrain = generateTerrain({ seed: "seed-2", ...DEFAULT_TERRAIN_SIZE });
const other = generateDiorama(otherTerrain, "seed-2");
const cases: [DioramaScenery, Terrain][] = [
  [golden, terrain],
  [other, otherTerrain],
];

/** Every point the layout puts on the ground, with a label for failures. */
function groundPoints(s: DioramaScenery): [string, PointMm][] {
  const out: [string, PointMm][] = [];
  s.lots.forEach((lot, i) => {
    out.push([`lot ${i} ${lot.kind}`, lot]);
    for (const c of obbCorners(lotBox(lot))) out.push([`lot ${i} corner`, c]);
  });
  s.fields.forEach((f, i) => {
    out.push([`field ${i}`, f]);
    for (const c of obbCorners({ ...f, halfLengthMm: f.lengthMm / 2, halfWidthMm: f.widthMm / 2 })) out.push([`field ${i} corner`, c]);
  });
  s.roads.forEach((r, i) => r.points.forEach((p) => out.push([`road ${i}`, p])));
  s.streets.forEach((r, i) => r.points.forEach((p) => out.push([`street ${i}`, p])));
  s.telegraphPoles.forEach((p, i) => out.push([`pole ${i}`, p]));
  s.lamps.forEach((p, i) => out.push([`lamp ${i}`, p]));
  s.haystacks.forEach((p, i) => out.push([`haystack ${i}`, p]));
  s.fences.forEach((f, i) => out.push([`fence ${i} from`, f.from], [`fence ${i} to`, f.to]));
  for (let i = 0; i < s.trees.count; i++) out.push([`tree ${i}`, { xMm: s.trees.xMm[i] ?? 0, yMm: s.trees.yMm[i] ?? 0 }]);
  return out;
}

describe("baltic diorama scenery", () => {
  it("reproduces the golden hash for the default seed and terrain", () => {
    expect(golden.terrainHash).toBe("d2ee8189");
    expect(sceneryHash(golden)).toBe(GOLDEN_SCENERY_HASH);
  });

  it("gives identical output for the same terrain and seed, and different output for another seed", () => {
    const again = generateDiorama(terrain, DIORAMA_SEED);
    expect(sceneryHash(again)).toBe(sceneryHash(golden));
    expect(again.trees.xMm).toEqual(golden.trees.xMm);
    expect(again.lots).toEqual(golden.lots);
    expect(sceneryHash(generateDiorama(terrain, "another-seed"))).not.toBe(sceneryHash(golden));
  });

  it("uses integers for every coordinate, size and seed", () => {
    for (const [label, p] of groundPoints(golden)) {
      if (!Number.isSafeInteger(p.xMm) || !Number.isSafeInteger(p.yMm)) expect.fail(`${label} is not integer mm`);
    }
    for (const lot of golden.lots) {
      expect(lot.lengthMm % 1000).toBe(0);
      expect(lot.widthMm % 1000).toBe(0);
      expect(Number.isInteger(lot.heading) && lot.heading >= 0 && lot.heading < 12).toBe(true);
      expect(Number.isSafeInteger(lot.seed) && lot.seed >= 0 && lot.seed < 2 ** 32).toBe(true);
    }
  });

  it("places nothing on water", () => {
    for (const [s, t] of cases) {
      const g = createGround(t);
      for (const [label, p] of groundPoints(s)) {
        if (waterRingsNear(g, p) === 0) expect.fail(`${label} at ${p.xMm}, ${p.yMm} stands on water`);
      }
    }
  });

  it("keeps every building off steep ground and clear of every other building", () => {
    for (const [s, t] of cases) {
      const g = createGround(t);
      for (const lot of s.lots) {
        const box = lotBox(lot);
        const relief = reliefAround(g, lot, obbRadiusMm(box));
        expect(relief.wet).toBe(false);
        expect(relief.maxDm - relief.minDm).toBeLessThanOrEqual(LOT_MAX_RELIEF_DM);
      }
      for (let i = 0; i < s.lots.length; i++) {
        for (let j = i + 1; j < s.lots.length; j++) {
          if (obbOverlap(lotBox(s.lots[i]!), lotBox(s.lots[j]!), 300)) expect.fail(`lots ${i} and ${j} overlap`);
        }
      }
    }
  });

  it("sites two or three named towns on dry, gentle ground away from the edges", () => {
    for (const [s, t] of cases) {
      const g = createGround(t);
      expect(s.towns.length).toBeGreaterThanOrEqual(2);
      expect(s.towns.length).toBeLessThanOrEqual(3);
      expect(new Set(s.towns.map((town) => town.name)).size).toBe(s.towns.length);
      s.towns.forEach((town, i) => {
        expect(BALTIC_PLACE_NAMES).toContain(town.name);
        expect(edgeDistanceMm(g, town.centre)).toBeGreaterThanOrEqual(260_000);
        expect(waterRingsNear(g, town.centre)).toBeGreaterThanOrEqual(12);
        const relief = reliefAround(g, town.centre, 70_000);
        expect(relief.maxDm - relief.minDm).toBeLessThanOrEqual(80);
        expect(s.lots.filter((lot) => lot.town === i).length).toBeGreaterThanOrEqual(8);
      });
      expect(s.towns[0]?.size).toBe("large");
    }
  });

  it("gives every town a cross-shaped cobbled square at its centre", () => {
    for (const town of golden.towns) {
      const arms = golden.streets.filter(
        (street) => street.surface === "cobble" && polylineDistanceMm(town.centre, street.points) === 0 && street.widthMm >= 14_000,
      );
      expect(arms.length).toBe(2);
      const [a, b] = arms.map((arm) => {
        const [p, q] = arm.points as [PointMm, PointMm];
        return [q.xMm - p.xMm, q.yMm - p.yMm];
      }) as [[number, number], [number, number]];
      // Perpendicular: the dot product is tiny against the arms' lengths.
      expect(Math.abs(a[0] * b[0] + a[1] * b[1])).toBeLessThan(0.01 * Math.hypot(...a) * Math.hypot(...b));
    }
  });

  it("puts one church in the largest town and one windmill on a rise", () => {
    for (const [s, t] of cases) {
      const g = createGround(t);
      const churches = s.lots.filter((lot) => lot.kind === "church");
      expect(churches.length).toBe(1);
      expect(churches[0]?.town).toBe(0);
      const windmills = s.landmarks.filter((l) => l.kind === "windmill");
      expect(windmills.length).toBe(1);
      const mill = s.lots[windmills[0]!.lot]!;
      expect(mill.kind).toBe("windmill");
      expect(reliefAround(g, mill, 8_000).meanDm).toBeGreaterThan(reliefAround(g, mill, 90_000).meanDm);
      for (const landmark of s.landmarks) expect(s.lots[landmark.lot]?.kind).toBe(landmark.kind);
    }
  });

  it("scatters a few farmsteads, each with strip fields beside it", () => {
    for (const [s] of cases) {
      const farms = s.lots.filter((lot) => lot.kind === "farmstead");
      expect(farms.length).toBeGreaterThanOrEqual(3);
      expect(farms.length).toBeLessThanOrEqual(6);
      for (const farm of farms) {
        expect(s.fields.some((f) => distanceMm(f, farm) < 90_000)).toBe(true);
      }
      for (const field of s.fields) {
        expect([0, 1, 2, 3]).toContain(field.crop);
        expect(field.heading).toBeGreaterThanOrEqual(0);
        expect(field.heading).toBeLessThan(12);
      }
    }
  });

  it("fills forests at about one tree per 30 m², capped at 20,000 trees", () => {
    for (const [s] of cases) {
      expect(s.trees.count).toBeGreaterThan(5_000);
      expect(s.trees.count).toBeLessThanOrEqual(MAX_TREES);
      const cellM2 = (s.forest.cellMm / 1000) ** 2;
      expect(cellM2 / TREES_PER_FULL_CELL).toBeGreaterThan(28);
      expect(cellM2 / TREES_PER_FULL_CELL).toBeLessThan(33);
      const species = new Set(s.trees.species);
      expect([...species].sort()).toEqual([0, 1, 2]);
    }
  });

  it("joins towns with dirt roads and runs telegraph poles every 50 m beside one of them", () => {
    for (const [s] of cases) {
      expect(s.roads.length).toBeGreaterThanOrEqual(1);
      for (const road of s.roads) expect(road.surface).toBe("dirt");
      expect(s.telegraphPoles.length).toBeGreaterThanOrEqual(4);
      const road = s.roads.find((r) => s.telegraphPoles.every((pole) => polylineDistanceMm(pole, r.points) <= 5_500));
      expect(road).toBeDefined();
      for (let i = 1; i < s.telegraphPoles.length; i++) {
        const gap = distanceMm(s.telegraphPoles[i - 1]!, s.telegraphPoles[i]!);
        // Spacing is 50 m of road arc (exact in the stationsAlong unit test). Measured
        // pole to pole, a chord on a bend with the 5 m side offset runs up to ~10 m
        // short or long, and a pole left out (water, a lot) doubles the gap.
        const multiple = Math.round(gap / TELEGRAPH_SPACING_MM);
        expect(multiple).toBeGreaterThanOrEqual(1);
        expect(Math.abs(gap - multiple * TELEGRAPH_SPACING_MM)).toBeLessThan(12_000);
      }
    }
  });

  it("generates the default map in under three seconds", () => {
    const start = performance.now();
    generateDiorama(terrain, "timing");
    expect(performance.now() - start).toBeLessThan(3_000);
  });
});
