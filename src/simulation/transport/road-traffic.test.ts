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
} from "./road-traffic";

const start = { x: 0, y: 0 };
const end = { x: 100, y: 0 };

function overloadedBridgeNetwork() {
  const segments: readonly RoadSegment[] = [
    {
      id: "old-bridge",
      roadClass: "local",
      start,
      end,
    },
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
    const first = createRoadTraffic(
      overloadedBridgeNetwork(),
      0,
      start,
      end,
      100,
    );
    const replay = createRoadTraffic(
      overloadedBridgeNetwork(),
      0,
      start,
      end,
      100,
    );
    expect(first).toEqual(replay);
    expect(
      assignedRoadTrafficRoute(first.network, first.state)?.linkIds,
    ).toEqual(["old-bridge:link-1"]);
    expect(
      first.network.links.find(({ id }) => id === "old-bridge:link-1"),
    ).toMatchObject({
      assignedFlowUnitsPerDay: 100,
    });
    expect(
      first.network.links.find(({ id }) => id === "old-bridge:link-1")
        ?.congestionDelayHours,
    ).toBeGreaterThan(0);

    const beforeCadence = advanceRoadTraffic(
      first.network,
      first.state,
      TRAFFIC_ASSIGNMENT_INTERVAL_TICKS - 1,
      start,
      end,
      100,
    );
    expect(beforeCadence.network).toBe(first.network);
    expect(beforeCadence.state).toBe(first.state);

    const reassigned = advanceRoadTraffic(
      first.network,
      first.state,
      TRAFFIC_ASSIGNMENT_INTERVAL_TICKS,
      start,
      end,
      100,
    );
    expect(
      assignedRoadTrafficRoute(reassigned.network, reassigned.state)?.linkIds,
    ).toEqual([
      "bypass-west:link-1",
      "bypass:link-1",
      "bypass-east:link-1",
    ]);
    expect(reassigned.state.lastAssignmentTick).toBe(
      TRAFFIC_ASSIGNMENT_INTERVAL_TICKS,
    );
  });

  it("feeds changed congestion cost into accessibility decisions", () => {
    const initial = createRoadTraffic(
      overloadedBridgeNetwork(),
      0,
      start,
      end,
      100,
    );
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
      start,
      end,
      100,
    );
    const after = scorer.updateNetwork(reassigned.network);

    expect(after.lastNetworkUpdateInvalidatedLocationIds).toEqual(["site"]);
    expect(after.locations[0]!.market.nearestNetworkCost).not.toBe(bridgeCost);
  });
});
