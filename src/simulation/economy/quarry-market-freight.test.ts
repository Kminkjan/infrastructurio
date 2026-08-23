// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { RoadRoute } from "../../shared";
import {
  FULL_VOLUME_ROUTE_COST,
  MAXIMUM_VIABLE_ROUTE_COST,
  assignAggregateFreight,
} from "./quarry-market-freight";

function route(length: number): RoadRoute {
  return {
    nodeIds: ["quarry", "market"],
    linkIds: ["road"],
    length,
    freeFlowTravelTimeHours: length,
    congestionDelayHours: 0,
    generalizedCostHours: length,
  };
}

function assignment(
  routeValue: RoadRoute | undefined,
  productionTonsPerDay = 120,
  demandTonsPerDay = 100,
) {
  return assignAggregateFreight({
    producerId: "quarry",
    marketId: "market",
    productionTonsPerDay,
    demandTonsPerDay,
    route: routeValue,
  });
}

describe("aggregate quarry-to-market freight", () => {
  it("does not generate freight without a road route", () => {
    expect(assignment(undefined)).toMatchObject({
      productionTonsPerDay: 120,
      demandTonsPerDay: 100,
      shippedTonsPerDay: 0,
      route: null,
      routeCost: null,
      limitingFactor: "no-route",
    });
  });

  it("bounds low-cost shipments by production and market demand", () => {
    expect(assignment(route(FULL_VOLUME_ROUTE_COST), 80, 100)).toMatchObject({
      shippedTonsPerDay: 80,
      limitingFactor: "production",
    });
    expect(assignment(route(FULL_VOLUME_ROUTE_COST), 120, 100)).toMatchObject({
      shippedTonsPerDay: 100,
      limitingFactor: "demand",
    });
  });

  it("reduces volume deterministically as route cost rises", () => {
    const lowCost = assignment(route(FULL_VOLUME_ROUTE_COST));
    const higherCost = assignment(
      route(
        FULL_VOLUME_ROUTE_COST +
          (MAXIMUM_VIABLE_ROUTE_COST - FULL_VOLUME_ROUTE_COST) / 2,
      ),
    );

    expect(lowCost.shippedTonsPerDay).toBe(100);
    expect(higherCost).toMatchObject({
      shippedTonsPerDay: 50,
      limitingFactor: "route-cost",
    });
  });

  it("makes freight unviable at the maximum route cost", () => {
    expect(assignment(route(MAXIMUM_VIABLE_ROUTE_COST))).toMatchObject({
      shippedTonsPerDay: 0,
      routeCost: MAXIMUM_VIABLE_ROUTE_COST,
      limitingFactor: "route-cost",
    });
  });

  it("rejects invalid economic inputs", () => {
    expect(() => assignment(route(10), -1)).toThrow(RangeError);
    expect(() => assignment(route(10), 10, Number.NaN)).toThrow(RangeError);
  });
});
