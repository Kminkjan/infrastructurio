import { describe, expect, it } from "vitest";
import { convexInwardFacing, inwardFacing, triangleCount, windingMismatches } from "../../../tests/support/geometry";
import { DIORAMA_SEED, generateDiorama } from "../../core/scenarios/baltic-diorama";
import { DEFAULT_TERRAIN_SIZE, generateTerrain } from "../../core/terrain";
import { FENCE_PANEL_M, PROP_BUDGET, PROP_KINDS, buildProp, propPlacements } from "./props";

const scenery = generateDiorama(generateTerrain({ seed: DIORAMA_SEED, ...DEFAULT_TERRAIN_SIZE }));

describe("props", () => {
  it("stay small and wind outward", () => {
    for (const kind of PROP_KINDS) {
      const b = buildProp(kind);
      const g = b.build();
      expect(triangleCount(g), kind).toBeLessThanOrEqual(PROP_BUDGET);
      expect(windingMismatches(g), kind).toBe(0);
      expect(inwardFacing(g, b.parts), kind).toBe(0);
      expect(convexInwardFacing(g, b.parts), kind).toBe(0);
    }
  });

  it("place one pole per telegraph pole, one lamp per lamp and one stack per haystack", () => {
    const p = propPlacements(scenery);
    expect(p["telegraph-pole"]).toHaveLength(scenery.telegraphPoles.length);
    expect(p.lamp).toHaveLength(scenery.lamps.length);
    expect(p.haystack).toHaveLength(scenery.haystacks.length);
  });

  it("cuts every fence run into whole panels close to 2.5 m", () => {
    const panels = propPlacements(scenery)["fence-panel"];
    expect(panels.length).toBeGreaterThan(scenery.fences.length);
    for (const panel of panels) {
      expect(panel.stretch * FENCE_PANEL_M).toBeGreaterThan(1.2);
      expect(panel.stretch * FENCE_PANEL_M).toBeLessThan(3.8);
    }
  });

  it("spaces a run's panels evenly so the last one ends exactly at the far post", () => {
    const run = { from: { xMm: 100_000, yMm: 200_000 }, to: { xMm: 111_000, yMm: 205_500 } };
    const panels = propPlacements({ ...scenery, fences: [run], telegraphPoles: [], lamps: [], haystacks: [] })["fence-panel"];
    const length = Math.hypot(11, 5.5);
    expect(panels).toHaveLength(Math.round(length / FENCE_PANEL_M));
    const step = length / panels.length;
    panels.forEach((p, k) => {
      expect(p.stretch * FENCE_PANEL_M).toBeCloseTo(step, 9);
      expect(Math.hypot(p.xM - 100, p.yM - 200)).toBeCloseTo(k * step, 9);
    });
    expect(panels.length * step).toBeCloseTo(length, 9);
  });
});
