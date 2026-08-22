// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { AggregateFreightSnapshot, RoadNetwork } from "../shared";
import {
  createRepresentativeFreightTrafficPlan,
  sampleRepresentativeFreightVehicles,
  TONS_PER_REPRESENTATIVE_VEHICLE,
} from "./representative-freight";

const roadNetwork: RoadNetwork = {
  segments: [],
  nodes: [
    { id: "quarry", position: { x: 0, y: 0 } },
    { id: "corner", position: { x: 100, y: 0 } },
    { id: "market", position: { x: 100, y: 100 } },
    { id: "alternate", position: { x: 0, y: 100 } },
  ],
  links: [
    {
      id: "first",
      roadSegmentId: "road-1",
      startNodeId: "quarry",
      endNodeId: "corner",
      length: 100,
    },
    {
      id: "second",
      roadSegmentId: "road-2",
      startNodeId: "corner",
      endNodeId: "market",
      length: 100,
    },
    {
      id: "alternate-first",
      roadSegmentId: "road-3",
      startNodeId: "quarry",
      endNodeId: "alternate",
      length: 100,
    },
    {
      id: "alternate-second",
      roadSegmentId: "road-4",
      startNodeId: "alternate",
      endNodeId: "market",
      length: 100,
    },
  ],
};

function freight(
  shippedTonsPerDay: number,
  route: AggregateFreightSnapshot["route"] = {
    nodeIds: ["quarry", "corner", "market"],
    linkIds: ["first", "second"],
    length: 200,
  },
): AggregateFreightSnapshot {
  return {
    commodity: "granite",
    producerId: "quarry",
    marketId: "market",
    productionTonsPerDay: 120,
    demandTonsPerDay: 100,
    shippedTonsPerDay,
    route,
    routeCost: route?.length ?? null,
    limitingFactor: route ? "demand" : "no-route",
    limitingReason: "Test fixture",
  };
}

describe("representative freight traffic", () => {
  it("samples visible vehicle density from assigned aggregate flow", () => {
    const fullFlow = createRepresentativeFreightTrafficPlan(
      freight(100),
      roadNetwork,
    );
    const reducedFlow = createRepresentativeFreightTrafficPlan(
      freight(40),
      roadNetwork,
    );

    expect(TONS_PER_REPRESENTATIVE_VEHICLE).toBe(20);
    expect(fullFlow?.vehicleCount).toBe(5);
    expect(reducedFlow?.vehicleCount).toBe(2);
    expect(
      sampleRepresentativeFreightVehicles(fullFlow!, 0),
    ).toHaveLength(5);
  });

  it("moves samples along every leg of the selected route", () => {
    const plan = createRepresentativeFreightTrafficPlan(
      freight(TONS_PER_REPRESENTATIVE_VEHICLE),
      roadNetwork,
    );
    expect(plan).toBeDefined();

    const [vehicle] = sampleRepresentativeFreightVehicles(
      plan!,
      plan!.travelDurationSeconds * 0.75,
    );

    expect(vehicle?.position.x).toBeCloseTo(100);
    expect(vehicle?.position.y).toBeCloseTo(50);
    expect(vehicle?.rotation).toBeCloseTo(Math.PI / 2);
  });

  it("retires a sample at the destination before starting a new trip", () => {
    const plan = createRepresentativeFreightTrafficPlan(
      freight(TONS_PER_REPRESENTATIVE_VEHICLE),
      roadNetwork,
    );
    expect(plan).toBeDefined();

    const [arriving] = sampleRepresentativeFreightVehicles(
      plan!,
      plan!.travelDurationSeconds - 0.001,
    );
    const [departing] = sampleRepresentativeFreightVehicles(
      plan!,
      plan!.travelDurationSeconds,
    );

    expect(arriving?.position.x).toBeCloseTo(100);
    expect(arriving?.position.y).toBeGreaterThan(99);
    expect(departing).toMatchObject({
      position: { x: 0, y: 0 },
      progress: 0,
    });
    expect(departing?.id).not.toBe(arriving?.id);
  });

  it("replaces changed routes and clears disconnected traffic", () => {
    const initial = createRepresentativeFreightTrafficPlan(
      freight(100),
      roadNetwork,
    );
    const changed = createRepresentativeFreightTrafficPlan(
      freight(100, {
        nodeIds: ["quarry", "alternate", "market"],
        linkIds: ["alternate-first", "alternate-second"],
        length: 200,
      }),
      roadNetwork,
    );

    expect(changed?.key).not.toBe(initial?.key);
    expect(
      createRepresentativeFreightTrafficPlan(freight(0, null), roadNetwork),
    ).toBeUndefined();
  });

  it("does not render a route that is inconsistent with the road snapshot", () => {
    expect(
      createRepresentativeFreightTrafficPlan(
        freight(100, {
          nodeIds: ["quarry", "market"],
          linkIds: ["missing-link"],
          length: 200,
        }),
        roadNetwork,
      ),
    ).toBeUndefined();
  });
});
