import type { Point, ScenarioGeography } from "../../shared";
import type { AccessibilityModel } from "./accessibility";

const ACCESSIBILITY_DECAY_COST = 500;

function polygonCenter(boundary: readonly Point[]): Point {
  const total = boundary.reduce(
    (sum, position) => ({ x: sum.x + position.x, y: sum.y + position.y }),
    { x: 0, y: 0 },
  );
  return Object.freeze({
    x: total.x / boundary.length,
    y: total.y / boundary.length,
  });
}

export function createMillfordAccessibilityModel(
  geography: ScenarioGeography,
): AccessibilityModel {
  const [millford, eastbank] = geography.settlementSeeds;
  if (!millford || !eastbank) {
    throw new RangeError("Millford accessibility requires two settlement seeds");
  }

  return Object.freeze({
    candidates: Object.freeze(
      geography.settlementSeeds.map((settlement) =>
        Object.freeze({
          id: settlement.id,
          name: settlement.name,
          position: settlement.position,
        }),
      ),
    ),
    opportunities: Object.freeze([
      Object.freeze({
        id: geography.externalMarketConnection.id,
        factor: "market" as const,
        position: geography.externalMarketConnection.position,
        weight: 100,
      }),
      Object.freeze({
        id: `${millford.id}:labor`,
        factor: "labor" as const,
        position: millford.position,
        weight: 60,
      }),
      Object.freeze({
        id: `${eastbank.id}:labor`,
        factor: "labor" as const,
        position: eastbank.position,
        weight: 40,
      }),
      Object.freeze({
        id: geography.quarry.id,
        factor: "resource" as const,
        position: geography.quarry.position,
        weight: 55,
      }),
      Object.freeze({
        id: geography.fertileLand.id,
        factor: "resource" as const,
        position: polygonCenter(geography.fertileLand.boundary),
        weight: 45,
      }),
      Object.freeze({
        id: `${millford.id}:services`,
        factor: "service" as const,
        position: millford.position,
        weight: 70,
      }),
      Object.freeze({
        id: `${eastbank.id}:services`,
        factor: "service" as const,
        position: eastbank.position,
        weight: 30,
      }),
    ]),
    decayCost: ACCESSIBILITY_DECAY_COST,
  });
}
