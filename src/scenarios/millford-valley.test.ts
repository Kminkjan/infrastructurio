// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createSimulation } from "../simulation";
import { generateMillfordValley } from ".";

describe("Millford Valley scenario", () => {
  it("generates the complete minimal valley geography", () => {
    expect(generateMillfordValley("millford-valley")).toEqual({
      scenarioId: "millford-valley",
      seed: "millford-valley",
      bounds: { width: 960, height: 620 },
      river: {
        id: "river-mill",
        name: "Mill River",
        width: 54,
        path: [
          { x: 0, y: 347 },
          { x: 230, y: 294 },
          { x: 420, y: 332 },
          { x: 600, y: 389 },
          { x: 960, y: 296 },
        ],
      },
      crossingArea: {
        id: "crossing-millford",
        name: "Millford Crossing",
        center: { x: 510, y: 360.5 },
        width: 84,
        height: 106,
      },
      quarry: {
        id: "quarry-granite-ridge",
        name: "Granite Ridge Quarry",
        position: { x: 154, y: 508 },
      },
      fertileLand: {
        id: "fertile-land-eastbank",
        name: "Eastbank Fields",
        boundary: [
          { x: 570, y: 105 },
          { x: 845, y: 120 },
          { x: 805, y: 275 },
          { x: 590, y: 260 },
        ],
      },
      settlementSeeds: [
        {
          id: "settlement-millford",
          name: "Millford",
          position: { x: 405, y: 442.5 },
        },
        {
          id: "settlement-eastbank",
          name: "Eastbank",
          position: { x: 635, y: 228.5 },
        },
      ],
      externalMarketConnection: {
        id: "market-connection-east",
        name: "Eastern External Market",
        position: { x: 960, y: 188 },
        mapEdge: "east",
      },
    });
  });

  it("produces identical geography for the same seed", () => {
    const first = generateMillfordValley("repeatable-seed");
    const second = generateMillfordValley("repeatable-seed");

    expect(first).toEqual(second);
    expect(generateMillfordValley("different-seed")).not.toEqual(first);
  });

  it("loads generated geography into authoritative simulation state", () => {
    const simulation = createSimulation("loaded-scenario");

    expect(simulation.getSnapshot().geography).toEqual(
      generateMillfordValley("loaded-scenario"),
    );
  });

  it("places the crossing on the river and the market on the map edge", () => {
    const geography = generateMillfordValley("geography-constraints");
    const crossing = geography.crossingArea.center;
    const westernCrossingPoint = geography.river.path[2];
    const easternCrossingPoint = geography.river.path[3];

    expect(crossing).toEqual({
      x: (westernCrossingPoint.x + easternCrossingPoint.x) / 2,
      y: (westernCrossingPoint.y + easternCrossingPoint.y) / 2,
    });
    expect(geography.externalMarketConnection).toMatchObject({
      mapEdge: "east",
      position: { x: geography.bounds.width },
    });
    expect(geography.settlementSeeds.map(({ name }) => name)).toEqual([
      "Millford",
      "Eastbank",
    ]);
  });
});
