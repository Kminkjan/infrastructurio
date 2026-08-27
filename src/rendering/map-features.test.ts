// @vitest-environment node

import { describe, expect, it } from "vitest";
import { generateMillfordValley } from "../scenarios";
import {
  getSelectableMapFeatures,
  getSelectableRoadFeatures,
  getSelectableRailFeatures,
  getRailSnapAnchors,
  getRoadSnapAnchors,
  toMapSelection,
} from "./map-features";

describe("selectable map features", () => {
  it("maps infrastructure, resources, and settlements from scenario data", () => {
    const geography = generateMillfordValley("selection-test");
    const features = getSelectableMapFeatures(geography);

    expect(features.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "fertile-land-eastbank", kind: "resource" },
      { id: "crossing-millford", kind: "infrastructure" },
      { id: "market-connection-east", kind: "infrastructure" },
      { id: "stoneworks-millford", kind: "infrastructure" },
      { id: "quarry-granite-ridge", kind: "resource" },
      { id: "settlement-millford", kind: "settlement" },
      { id: "settlement-eastbank", kind: "settlement" },
    ]);
    expect(new Set(features.map(({ id }) => id)).size).toBe(features.length);
  });

  it("exposes presentation-safe inspector data without hit geometry", () => {
    const feature = getSelectableMapFeatures(
      generateMillfordValley("selection-test"),
    )[1];

    expect(feature && toMapSelection(feature)).toEqual({
      id: "crossing-millford",
      name: "Millford Crossing",
      kind: "infrastructure",
      description: "Constrained river crossing",
    });
  });

  it("maps authoritative road segments to selectable presentation features", () => {
    const features = getSelectableRoadFeatures({
      segments: [
        {
          id: "road-segment-1",
          roadClass: "arterial",
          start: { x: 10, y: 20 },
          end: { x: 40, y: 60 },
        },
      ],
      nodes: [],
      links: [],
    });

    expect(features).toEqual([
      {
        id: "road-segment-1",
        name: "Road segment",
        kind: "infrastructure",
        description: "50 map units · arterial road",
        geometry: {
          type: "line",
          start: { x: 10, y: 20 },
          end: { x: 40, y: 60 },
        },
      },
    ]);
  });

  it("snaps road construction to every development access anchor", () => {
    const geography = generateMillfordValley("selection-test");
    const fertileCenter = geography.fertileLand.boundary.reduce(
      (center, position, _index, boundary) => ({
        x: center.x + position.x / boundary.length,
        y: center.y + position.y / boundary.length,
      }),
      { x: 0, y: 0 },
    );

    expect(getRoadSnapAnchors(geography)).toEqual([
      geography.quarry.position,
      geography.stoneworks.position,
      geography.externalMarketConnection.position,
      ...geography.settlementSeeds.map(({ position }) => position),
      fertileCenter,
    ]);
  });

  it("maps rail track and terminals separately and exposes rail snap anchors", () => {
    const geography = generateMillfordValley("rail-selection-test");
    const railNetwork = {
      tracks: [{
        id: "rail-track-1",
        start: { x: 10, y: 20 },
        end: { x: 40, y: 60 },
        length: 50,
        capacityTonsPerDay: 320,
        freeFlowTravelTimeHours: 0.5,
        constructionCost: 1_400,
        maintenanceCostPerDay: 7,
      }],
      terminals: [{
        id: "rail-terminal-quarry",
        site: "quarry" as const,
        siteId: geography.quarry.id,
        name: "Quarry freight terminal",
        position: geography.quarry.position,
        capacityTonsPerDay: 240,
        freeFlowTransferTimeHours: 0.75,
        constructionCost: 5_000,
        maintenanceCostPerDay: 35,
        assignedHandlingTonsPerDay: 0,
      }],
      nodes: [{ id: "rail-node-1", position: { x: 10, y: 20 } }],
      links: [],
    };

    expect(getSelectableRailFeatures(railNetwork)).toEqual([
      {
        id: "rail-track-1",
        name: "Rail track",
        kind: "infrastructure",
        description: "50 map units · 320 t/day rail corridor",
        geometry: {
          type: "line",
          start: { x: 10, y: 20 },
          end: { x: 40, y: 60 },
        },
      },
      {
        id: "rail-terminal-quarry",
        name: "Quarry freight terminal",
        kind: "infrastructure",
        description: "240 t/day freight rail terminal",
        geometry: {
          type: "point",
          position: geography.quarry.position,
          radius: 25,
        },
      },
    ]);
    expect(getRailSnapAnchors(geography, railNetwork)).toEqual([
      geography.quarry.position,
      geography.stoneworks.position,
      geography.externalMarketConnection.position,
      { x: 10, y: 20 },
    ]);
  });
});
