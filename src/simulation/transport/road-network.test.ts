// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { RoadClass, RoadSegment } from "../../shared";
import {
  applyRoadLinkFlows,
  createRoadNetwork,
  findRoadRoute,
  ROAD_CLASS_PROFILES,
} from "./road-network";

function segment(
  id: string,
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
  roadClass: RoadClass = "arterial",
): RoadSegment {
  return { id, roadClass, start, end };
}

describe("road network", () => {
  it("creates a shared node and splits both links at an intersection", () => {
    const network = createRoadNetwork([
      segment("east-west", { x: 0, y: 0 }, { x: 10, y: 0 }),
      segment("north-south", { x: 5, y: -5 }, { x: 5, y: 5 }),
    ]);

    expect(network.nodes).toHaveLength(5);
    expect(network.links).toHaveLength(4);
    expect(
      network.nodes.filter(
        ({ position }) => position.x === 5 && position.y === 0,
      ),
    ).toHaveLength(1);
    expect(
      network.links.map(({ id, roadSegmentId, length }) => ({
        id,
        roadSegmentId,
        length,
      })),
    ).toEqual([
      { id: "east-west:link-1", roadSegmentId: "east-west", length: 5 },
      { id: "east-west:link-2", roadSegmentId: "east-west", length: 5 },
      { id: "north-south:link-1", roadSegmentId: "north-south", length: 5 },
      { id: "north-south:link-2", roadSegmentId: "north-south", length: 5 },
    ]);
  });

  it("routes through connected links using deterministic shortest distance", () => {
    const network = createRoadNetwork([
      segment("east-west", { x: 0, y: 0 }, { x: 10, y: 0 }),
      segment("north-south", { x: 5, y: -5 }, { x: 5, y: 5 }),
    ]);

    expect(findRoadRoute(network, { x: 0, y: 0 }, { x: 5, y: 5 })).toEqual({
      nodeIds: ["road-node-1", "road-node-2", "road-node-5"],
      linkIds: ["east-west:link-1", "north-south:link-2"],
      length: 10,
      freeFlowTravelTimeHours: 10 / 60,
      congestionDelayHours: 0,
      generalizedCostHours: 10 / 60,
    });
    expect(
      findRoadRoute(network, { x: 0, y: 0 }, { x: 99, y: 99 }),
    ).toBeUndefined();
  });

  it("derives practical capacity and free-flow time from road class", () => {
    const network = createRoadNetwork([
      segment("local", { x: 0, y: 0 }, { x: 70, y: 0 }, "local"),
      segment("highway", { x: 0, y: 20 }, { x: 90, y: 20 }, "highway"),
    ]);

    expect(network.links[0]).toMatchObject({
      roadClass: "local",
      capacityUnitsPerDay:
        ROAD_CLASS_PROFILES.local.practicalCapacityUnitsPerDay,
      freeFlowTravelTimeHours: 2,
      generalizedCostHours: 2,
    });
    expect(network.links[1]).toMatchObject({
      roadClass: "highway",
      capacityUnitsPerDay:
        ROAD_CLASS_PROFILES.highway.practicalCapacityUnitsPerDay,
      freeFlowTravelTimeHours: 1,
      generalizedCostHours: 1,
    });
  });

  it("raises generalized cost only when assigned flow exceeds practical capacity", () => {
    const network = createRoadNetwork([
      segment("bridge", { x: 0, y: 0 }, { x: 70, y: 0 }, "local"),
    ]);
    const link = network.links[0]!;
    const atCapacity = applyRoadLinkFlows(
      network,
      new Map([[link.id, link.capacityUnitsPerDay]]),
    ).links[0]!;
    const overloaded = applyRoadLinkFlows(
      network,
      new Map([[link.id, link.capacityUnitsPerDay + 1]]),
    ).links[0]!;

    expect(atCapacity.congestionDelayHours).toBe(0);
    expect(atCapacity.generalizedCostHours).toBe(
      atCapacity.freeFlowTravelTimeHours,
    );
    expect(overloaded.congestionDelayHours).toBeGreaterThan(0);
    expect(overloaded.generalizedCostHours).toBeGreaterThan(
      overloaded.freeFlowTravelTimeHours,
    );
  });

  it("joins an endpoint to the interior of an existing segment", () => {
    const network = createRoadNetwork([
      segment("main", { x: 0, y: 0 }, { x: 10, y: 0 }),
      segment("branch", { x: 5, y: 0 }, { x: 5, y: 5 }),
    ]);

    expect(network.nodes).toHaveLength(4);
    expect(network.links).toHaveLength(3);
    expect(
      findRoadRoute(network, { x: 0, y: 0 }, { x: 5, y: 5 })?.length,
    ).toBe(10);
  });

  it("produces identical graph and route results for identical input order", () => {
    const segments = [
      segment("first", { x: 10, y: 10 }, { x: 90, y: 10 }),
      segment("second", { x: 50, y: 0 }, { x: 50, y: 60 }),
      segment("third", { x: 50, y: 60 }, { x: 90, y: 60 }),
    ];

    const first = createRoadNetwork(segments);
    const second = createRoadNetwork(segments);

    expect(first).toEqual(second);
    expect(findRoadRoute(first, { x: 10, y: 10 }, { x: 90, y: 60 })).toEqual(
      findRoadRoute(second, { x: 10, y: 10 }, { x: 90, y: 60 }),
    );
  });

  it("rejects ambiguous collinear overlap", () => {
    expect(() =>
      createRoadNetwork([
        segment("first", { x: 0, y: 0 }, { x: 10, y: 0 }),
        segment("overlap", { x: 5, y: 0 }, { x: 15, y: 0 }),
      ]),
    ).toThrow("road segments may not overlap");
  });

  it("rejects invalid graph inputs deterministically", () => {
    expect(() =>
      createRoadNetwork([
        segment("duplicate", { x: 0, y: 0 }, { x: 10, y: 0 }),
        segment("duplicate", { x: 0, y: 10 }, { x: 10, y: 10 }),
      ]),
    ).toThrow("road segment ids must be non-empty and unique");
    expect(() =>
      createRoadNetwork([
        segment("point", { x: 1, y: 1 }, { x: 1, y: 1 }),
      ]),
    ).toThrow("road segments require two finite, distinct endpoints");
  });
});
