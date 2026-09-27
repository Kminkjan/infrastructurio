import { describe, expect, it } from "vitest";
import { DIORAMA_SEED, generateDiorama } from "../../core/scenarios/baltic-diorama";
import { DEFAULT_TERRAIN_SIZE, generateTerrain } from "../../core/terrain";
import { worldToSim } from "../coords";
import { LANDMARK_LABEL_MIN_PPM, TOWN_LABEL_MIN_PPM } from "./LabelLayer";
import { dioramaLabels } from "./placeLabels";

const terrain = generateTerrain({ seed: DIORAMA_SEED, ...DEFAULT_TERRAIN_SIZE });
const scenery = generateDiorama(terrain);
const labels = dioramaLabels(scenery, terrain);

describe("diorama labels", () => {
  it("names every town, the largest with top priority, hidden below 0.9 ppm", () => {
    const towns = labels.filter((l) => l.kind === "town");
    expect(towns.map((l) => l.text)).toEqual(scenery.towns.map((t) => t.name));
    expect(towns[0]?.priority).toBeGreaterThan(towns[1]?.priority ?? 0);
    for (const l of towns) expect(l.minPpm).toBe(TOWN_LABEL_MIN_PPM);
    expect(TOWN_LABEL_MIN_PPM).toBe(0.9);
  });

  it("names the church and the windmill after their towns, below the towns in priority", () => {
    const landmarks = labels.filter((l) => l.kind === "landmark");
    const townNames = scenery.towns.map((t) => t.name);
    const texts = landmarks.map((l) => l.text);
    expect(texts.filter((t) => t.endsWith(" Church"))).toHaveLength(1);
    expect(texts.filter((t) => t.endsWith(" Mill"))).toHaveLength(1);
    for (const text of texts) expect(townNames).toContain(text.replace(/ (Church|Mill)$/, ""));
    for (const l of landmarks) {
      expect(l.minPpm).toBe(LANDMARK_LABEL_MIN_PPM);
      expect(l.priority).toBeLessThan(2);
    }
  });

  it("anchors each town name a little above its square", () => {
    for (const [i, town] of scenery.towns.entries()) {
      const p = worldToSim(labels[i]!.world);
      expect(p.x).toBeCloseTo(town.centre.xMm / 1000, 6);
      expect(p.y).toBeCloseTo(town.centre.yMm / 1000, 6);
      expect(p.z).toBeGreaterThan(terrain.waterLevelDm / 10 + 5);
    }
  });
});
