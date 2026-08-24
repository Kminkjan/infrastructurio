// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { RoadSegment } from "../../shared";
import { createAccessibilityScorer } from "../growth/accessibility";
import { createRoadNetwork } from "./road-network";
import {
  advanceRoadTraffic,
  assignedRoadTrafficRoute,
  createRoadTraffic,
  TRAFFIC_ASSIGNMENT_INTERVAL_TICKS,
  type RoadTrafficDemand,
} from "./road-traffic";

const start = { x: 0, y: 0 };
const end = { x: 100, y: 0 };

function demand(
  id = "freight",
  assignedFlowUnitsPerDay = 100,
): RoadTrafficDemand {
  return { id, start, end, assignedFlowUnitsPerDay };
}

function overloadedBridgeNetwork() {
  const segments: readonly RoadSegment[] = [
    { id: "old-bridge", roadClass: "local", start, end },
    {
      id: "bypass-west",
      roadClass: "arterial",
      start,
      end: { x: 0, y: 50 },
    },
    {
      id: "bypass",
      roadClass: "arterial",
      start: { x: 0, y: 50 },
      end: { x: 100, y: 50 },
    },
    {
      id: "bypass-east",
      roadClass: "arterial",
      start: { x: 100, y: 50 },
      end,
    },
  ];
  return createRoadNetwork(segments);
}

describe("lower-frequency road traffic assignment", () => {
  it("deterministically reroutes persistent demand around an overloaded bridge", () => {
    const demands = [demand()];
    const first = createRoadTraffic(overloadedBridgeNetwork(), 0, demands);
    const replay = createRoadTraffic(overloadedBridgeNetwork(), 0, demands);
    expect(first).toEqual(replay);
    expect(
      assignedRoadTrafficRoute(first.network, first.state, "freight")?.linkIds,
    ).toEqual(["old-bridge:link-1"]);
    expect(
      first.network.links.find(({ id }) => id === "old-bridge:link-1"),
    ).toMatchObject({ assignedFlowUnitsPerDay: 100 });

    const beforeCadence = advanceRoadTraffic(
      first.network,
      first.state,
      TRAFFIC_ASSIGNMENT_INTERVAL_TICKS - 1,
      demands,
    );
    expect(beforeCadence.network).toBe(first.network);
    expect(beforeCadence.state).toBe(first.state);

    const reassigned = advanceRoadTraffic(
      first.network,
      first.state,
      TRAFFIC_ASSIGNMENT_INTERVAL_TICKS,
      demands,
    );
    expect(
      assignedRoadTrafficRoute(
        reassigned.network,
        reassigned.state,
        "freight",
      )?.linkIds,
    ).toEqual([
      "bypass-west:link-1",
      "bypass:link-1",
      "bypass-east:link-1",
    ]);
  });

  it("sums independently routed aggregate flows on shared links", () => {
    const assigned = createRoadTraffic(overloadedBridgeNetwork(), 0, [
      demand("inbound", 60),
      demand("outbound", 80),
    ]);

    expect(
      assigned.network.links.find(({ id }) => id === "old-bridge:link-1"),
    ).toMatchObject({ assignedFlowUnitsPerDay: 140 });
    expect(assigned.state.flows.map(({ id }) => id)).toEqual([
      "inbound",
      "outbound",
    ]);
  });

  it("feeds changed congestion cost into accessibility decisions", () => {
    const demands = [demand()];
    const initial = createRoadTraffic(overloadedBridgeNetwork(), 0, demands);
    const scorer = createAccessibilityScorer(
      {
        candidates: [{ id: "site", name: "Site", position: start }],
        opportunities: [
          { id: "market", factor: "market", position: end, weight: 100 },
        ],
        decayCost: 10,
      },
      initial.network,
    );
    const bridgeCost =
      scorer.getSnapshot().locations[0]!.market.nearestNetworkCost;
    const reassigned = advanceRoadTraffic(
      initial.network,
      initial.state,
      TRAFFIC_ASSIGNMENT_INTERVAL_TICKS,
      demands,
    );
    const after = scorer.updateNetwork(reassigned.network);

    expect(after.lastNetworkUpdateInvalidatedLocationIds).toEqual(["site"]);
    expect(after.locations[0]!.market.nearestNetworkCost).not.toBe(bridgeCost);
  });
});
