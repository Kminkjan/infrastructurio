import type { Point, RoadSegment, ScenarioGeography } from "../shared";

const MAP_WIDTH = 960;
const MAP_HEIGHT = 620;

export const OLD_MILLFORD_BRIDGE_ROAD_ID = "millford-old-bridge";

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function createRandom(seed: string): () => number {
  let state = hashSeed(seed);

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function randomInteger(
  random: () => number,
  minimum: number,
  maximum: number,
): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function point(x: number, y: number): Point {
  return Object.freeze({ x, y });
}

export function generateMillfordValley(seed: string): ScenarioGeography {
  const random = createRandom(seed);
  const riverPath = Object.freeze([
    point(0, 354 + randomInteger(random, -10, 10)),
    point(230, 292 + randomInteger(random, -12, 12)),
    point(420, 333 + randomInteger(random, -10, 10)),
    point(600, 389 + randomInteger(random, -10, 10)),
    point(MAP_WIDTH, 302 + randomInteger(random, -12, 12)),
  ]);
  const crossingCenter = point(
    (riverPath[2].x + riverPath[3].x) / 2,
    (riverPath[2].y + riverPath[3].y) / 2,
  );
  const quarryPosition = point(
    145 + randomInteger(random, -12, 12),
    500 + randomInteger(random, -10, 10),
  );
  const marketPosition = point(
    MAP_WIDTH,
    180 + randomInteger(random, -14, 14),
  );
  const millfordPosition = point(
    crossingCenter.x - 105,
    crossingCenter.y + 82,
  );

  return Object.freeze({
    scenarioId: "millford-valley",
    seed,
    bounds: Object.freeze({ width: MAP_WIDTH, height: MAP_HEIGHT }),
    river: Object.freeze({
      id: "river-mill",
      name: "Mill River",
      width: 54,
      path: riverPath,
    }),
    crossingArea: Object.freeze({
      id: "crossing-millford",
      name: "Millford Crossing",
      center: crossingCenter,
      width: 84,
      height: 106,
    }),
    quarry: Object.freeze({
      id: "quarry-granite-ridge",
      name: "Granite Ridge Quarry",
      position: quarryPosition,
    }),
    stoneworks: Object.freeze({
      id: "stoneworks-millford",
      name: "Millford Stoneworks",
      position: point(millfordPosition.x + 62, millfordPosition.y - 18),
    }),
    fertileLand: Object.freeze({
      id: "fertile-land-eastbank",
      name: "Eastbank Fields",
      boundary: Object.freeze([
        point(570, 105),
        point(845, 120),
        point(805, 275),
        point(590, 260),
      ]),
    }),
    settlementSeeds: Object.freeze([
      Object.freeze({
        id: "settlement-millford",
        name: "Millford",
        position: millfordPosition,
      }),
      Object.freeze({
        id: "settlement-eastbank",
        name: "Eastbank",
        position: point(crossingCenter.x + 125, crossingCenter.y - 132),
      }),
    ]),
    externalMarketConnection: Object.freeze({
      id: "market-connection-east",
      name: "Eastern External Market",
      position: marketPosition,
      mapEdge: "east",
    }),
  });
}

export function createMillfordStartingRoads(
  geography: ScenarioGeography,
): readonly RoadSegment[] {
  const [millford, eastbank] = geography.settlementSeeds;
  if (!millford || !eastbank) {
    throw new RangeError("Millford starting roads require two settlements");
  }
  const { center, width, height } = geography.crossingArea;
  const bridgeStart = point(center.x - width / 2, center.y + height / 2);
  const bridgeEnd = point(center.x + width / 2, center.y - height / 2);

  return Object.freeze([
    Object.freeze({
      id: "millford-west-approach",
      roadClass: "arterial" as const,
      start: millford.position,
      end: geography.stoneworks.position,
    }),
    Object.freeze({
      id: "millford-bridge-approach",
      roadClass: "highway" as const,
      start: geography.stoneworks.position,
      end: bridgeStart,
    }),
    Object.freeze({
      id: OLD_MILLFORD_BRIDGE_ROAD_ID,
      roadClass: "local" as const,
      start: bridgeStart,
      end: bridgeEnd,
    }),
    Object.freeze({
      id: "eastbank-bridge-approach",
      roadClass: "highway" as const,
      start: bridgeEnd,
      end: eastbank.position,
    }),
  ]);
}
