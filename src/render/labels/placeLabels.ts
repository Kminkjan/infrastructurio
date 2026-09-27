import { Vector3 } from "three";
import type { DioramaScenery, Terrain } from "../../core/sim/api";
import { simToWorld } from "../coords";
import { sampleTerrainHeightM } from "../terrain/heightfieldRay";
import { LANDMARK_LABEL_MIN_PPM, type PlaceLabel, TOWN_LABEL_MIN_PPM } from "./LabelLayer";

/**
 * The static diorama's labels: every town by name (the largest first in
 * priority), and its landmarks in smaller type, named after their town
 * ("Vējkalni Church") or, for the windmill, the nearest town ("… Mill").
 * Anchors lift a little above the ground: a lift in metres grows on screen
 * with zoom, and at Close (12 ppm) 24 m already pushed a town's name off the
 * top of the view. Town names sit over their square; landmark names at about
 * roof or tower height.
 */

const TOWN_LIFT_M = 8;
const CHURCH_LIFT_M = 22;
const WINDMILL_LIFT_M = 12;

export function dioramaLabels(s: DioramaScenery, t: Terrain): PlaceLabel[] {
  const at = (xMm: number, yMm: number, lift: number): Vector3 => {
    const x = xMm / 1000;
    const y = yMm / 1000;
    return simToWorld(x, y, (sampleTerrainHeightM(t, x, y) ?? t.waterLevelDm / 10) + lift, new Vector3());
  };
  const labels: PlaceLabel[] = s.towns.map((town, i) => ({
    text: town.name,
    kind: "town",
    world: at(town.centre.xMm, town.centre.yMm, TOWN_LIFT_M),
    priority: i === 0 ? 3 : 2,
    minPpm: TOWN_LABEL_MIN_PPM,
  }));
  const nearestTownName = (xMm: number, yMm: number): string | undefined => {
    let best: { name: string; d: number } | undefined;
    for (const town of s.towns) {
      const d = (town.centre.xMm - xMm) ** 2 + (town.centre.yMm - yMm) ** 2;
      if (!best || d < best.d) best = { name: town.name, d };
    }
    return best?.name;
  };
  for (const landmark of s.landmarks) {
    const lot = s.lots[landmark.lot];
    if (!lot) continue;
    const townName = s.towns[landmark.town]?.name ?? nearestTownName(lot.xMm, lot.yMm);
    const noun = landmark.kind === "church" ? "Church" : "Mill";
    labels.push({
      text: townName ? `${townName} ${noun}` : noun,
      kind: "landmark",
      world: at(lot.xMm, lot.yMm, landmark.kind === "church" ? CHURCH_LIFT_M : WINDMILL_LIFT_M),
      priority: landmark.kind === "church" ? 1.5 : 1,
      minPpm: LANDMARK_LABEL_MIN_PPM,
    });
  }
  return labels;
}
