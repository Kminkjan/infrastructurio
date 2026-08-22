// @vitest-environment node

import { describe, expect, it } from "vitest";
import { generateMillfordValley } from "../scenarios";
import {
  getSelectableMapFeatures,
  getSelectableRoadFeatures,
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
        description: "50 map units · player-built road",
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
      geography.externalMarketConnection.position,
      ...geography.settlementSeeds.map(({ position }) => position),
      fertileCenter,
    ]);
  });
});
