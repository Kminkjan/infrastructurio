// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createSimulation } from "../simulation";
import { TRAFFIC_ASSIGNMENT_INTERVAL_TICKS } from "./road-traffic";

function buildInitialBridge() {
  const simulation = createSimulation("millford-valley-foundation");
  const geography = simulation.getSnapshot().geography;
  simulation.dispatch({
    type: "build-road",
    start: geography.quarry.position,
    end: geography.stoneworks.position,
  });
  simulation.dispatch({
    type: "build-road",
    start: geography.stoneworks.position,
    end: geography.externalMarketConnection.position,
  });
  const snapshot = simulation.dispatch({ type: "advance", ticks: 24 });
  return { simulation, geography, snapshot };
}

describe("Millford bridge bottleneck diagnosis and interventions", () => {
  it("reports demand, capacity, route choice, and affected freight from authoritative values", () => {
    const { snapshot } = buildInitialBridge();
    const bottleneck = snapshot.bottlenecks.roadBottlenecks.find(
      ({ isMillfordBridge }) => isMillfordBridge,
    );

    expect(bottleneck).toMatchObject({
      name: "Overloaded Millford bridge",
      roadSegmentId: "road-segment-2",
      roadClass: "arterial",
      demand: {
        assignedUnitsPerDay: 100,
        excessUnitsPerDay: 20,
      },
      capacity: {
        practicalUnitsPerDay: 80,
        volumeCapacityRatio: 1.25,
      },
      routeChoice: {
        routeLinkCount: 1,
        lastAssignmentTick: 24,
        nextAssignmentTick: 24 + TRAFFIC_ASSIGNMENT_INTERVAL_TICKS,
      },
      affectedFlows: [
        {
          id: "stone-supply-outbound",
          commodity: "finished-stone",
          originName: "Millford Stoneworks",
          destinationName: "Eastern External Market",
          demandUnitsPerDay: 100,
          assignedUnitsPerDay: 100,
        },
      ],
    });
    expect(bottleneck?.congestionDelayHours).toBeGreaterThan(0);
    expect(snapshot.bottlenecks.affectedRouteLinkIds).toEqual([
      "road-segment-1:link-1",
      "road-segment-2:link-1",
    ]);
  });

  it("removes the overload by upgrading the existing crossing while preserving its route", () => {
    const { simulation, snapshot } = buildInitialBridge();
    const routeBefore = snapshot.stoneSupplyChain.outboundFreight.route?.linkIds;
    const upgraded = simulation.dispatch({
      type: "upgrade-road",
      roadSegmentId: "road-segment-2",
    });

    expect(upgraded.roadNetwork.segments[1]?.roadClass).toBe("highway");
    expect(upgraded.stoneSupplyChain.outboundFreight.route?.linkIds).toEqual(routeBefore);
    expect(upgraded.bottlenecks.roadBottlenecks.some(({ isMillfordBridge }) => isMillfordBridge)).toBe(false);
    expect(upgraded.roadNetwork.links.find(({ roadSegmentId }) => roadSegmentId === "road-segment-2")).toMatchObject({
      capacityUnitsPerDay: 160,
      assignedFlowUnitsPerDay: 100,
      congestionDelayHours: 0,
    });
  });

  it("keeps the bridge congested until the next assignment, then redirects flow to a highway bypass", () => {
    const { simulation, geography } = buildInitialBridge();
    const westBypass = { x: geography.stoneworks.position.x, y: 0 };
    const eastBypass = {
      x: geography.externalMarketConnection.position.x,
      y: 0,
    };
    simulation.dispatch({
      type: "build-road",
      start: geography.stoneworks.position,
      end: westBypass,
      roadClass: "highway",
    });
    simulation.dispatch({
      type: "build-road",
      start: westBypass,
      end: eastBypass,
      roadClass: "highway",
    });
    const immediatelyAfterBypass = simulation.dispatch({
      type: "build-road",
      start: eastBypass,
      end: geography.externalMarketConnection.position,
      roadClass: "highway",
    });

    expect(
      immediatelyAfterBypass.bottlenecks.roadBottlenecks.some(
        ({ isMillfordBridge }) => isMillfordBridge,
      ),
    ).toBe(true);
    expect(immediatelyAfterBypass.stoneSupplyChain.outboundFreight.route?.linkIds).toEqual([
      "road-segment-2:link-1",
    ]);

    const afterAssignment = simulation.dispatch({
      type: "advance",
      ticks: TRAFFIC_ASSIGNMENT_INTERVAL_TICKS,
    });
    expect(afterAssignment.bottlenecks.roadBottlenecks.some(({ isMillfordBridge }) => isMillfordBridge)).toBe(false);
    expect(afterAssignment.stoneSupplyChain.outboundFreight.route?.linkIds).toEqual([
      "road-segment-3:link-1",
      "road-segment-4:link-1",
      "road-segment-5:link-1",
    ]);
    expect(afterAssignment.tick).toBe(24 + TRAFFIC_ASSIGNMENT_INTERVAL_TICKS);
  });

  it("rejects upgrades for unknown roads and leaves highways unchanged", () => {
    const { simulation } = buildInitialBridge();
    expect(() =>
      simulation.dispatch({
        type: "upgrade-road",
        roadSegmentId: "missing",
      }),
    ).toThrow("road segment missing does not exist");

    const upgraded = simulation.dispatch({
      type: "upgrade-road",
      roadSegmentId: "road-segment-2",
    });
    expect(
      simulation.dispatch({
        type: "upgrade-road",
        roadSegmentId: "road-segment-2",
      }),
    ).toEqual(upgraded);
  });
});
