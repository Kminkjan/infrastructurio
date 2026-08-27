// @vitest-environment node

import { describe, expect, it } from "vitest";
import { generateMillfordValley } from "../../scenarios";
import type { RoadSegment } from "../../shared";
import { createAccessibilityScorer } from "../growth/accessibility";
import { createRoadNetwork } from "./road-network";
import {
  createFreightRailTerminalState,
  createRailNetwork,
} from "./rail-network";
import {
  advanceFreightOperators,
  createFreightOperators,
  FREIGHT_ASSIGNMENT_INTERVAL_TICKS,
  freightServiceCandidates,
} from "./freight-operators";

const geography = generateMillfordValley("private-operator-responses");
const start = geography.quarry.position;
const end = geography.stoneworks.position;
const demand = [{
  id: "stone-supply-inbound",
  start,
  end,
  originRailTerminalId: "rail-terminal-quarry",
  destinationRailTerminalId: "rail-terminal-stoneworks",
  demandTonsPerDay: 120,
}] as const;

function emptyRail() {
  return createRailNetwork([], [], geography);
}

describe("private multimodal freight operators", () => {
  it("responds deterministically to an existing-crossing highway upgrade", () => {
    const oldCrossing: RoadSegment = {
      id: "old-crossing",
      roadClass: "local",
      start,
      end,
    };
    const before = createFreightOperators(
      createRoadNetwork([oldCrossing]),
      emptyRail(),
      0,
      demand,
    );
    const upgraded = createFreightOperators(
      createRoadNetwork([{ ...oldCrossing, roadClass: "highway" }]),
      emptyRail(),
      0,
      demand,
    );
    const beforeRoad = freightServiceCandidates(
      before.roadNetwork,
      before.railNetwork,
      before.state,
      demand[0].id,
    )[0]!;
    const upgradedRoad = freightServiceCandidates(
      upgraded.roadNetwork,
      upgraded.railNetwork,
      upgraded.state,
      demand[0].id,
    )[0]!;

    expect(before.state.flows[0]?.chosenMode).toBe("road");
    expect(upgraded.state.flows[0]?.chosenMode).toBe("road");
    expect(upgradedRoad.capacityTonsPerDay).toBe(160);
    expect(upgradedRoad.generalizedCostHours).toBeLessThan(
      beforeRoad.generalizedCostHours!,
    );
    expect(upgraded.roadNetwork.links[0]).toMatchObject({
      assignedFlowUnitsPerDay: 120,
      congestionDelayHours: 0,
    });
  });

  it("moves an overloaded crossing flow to a highway bypass on cadence", () => {
    const bend = { x: (start.x + end.x) / 2, y: start.y + 600 };
    const network = createRoadNetwork([
      { id: "old-crossing", roadClass: "local", start, end },
      { id: "bypass-west", roadClass: "highway", start, end: bend },
      { id: "bypass-east", roadClass: "highway", start: bend, end },
    ]);
    const first = createFreightOperators(network, emptyRail(), 0, demand);
    expect(first.state.flows[0]?.candidates[0]?.linkIds).toEqual([
      "old-crossing:link-1",
    ]);

    const reassigned = advanceFreightOperators(
      first.roadNetwork,
      first.railNetwork,
      first.state,
      FREIGHT_ASSIGNMENT_INTERVAL_TICKS,
      demand,
    );
    expect(reassigned.state.flows[0]?.candidates[0]?.linkIds).toEqual([
      "bypass-west:link-1",
      "bypass-east:link-1",
    ]);
    expect(reassigned.state.flows[0]?.chosenMode).toBe("road");
  });

  it("shifts road freight to connected rail and applies authoritative rail flow", () => {
    const road = createRoadNetwork([
      { id: "road", roadClass: "arterial", start, end },
    ]);
    const before = createFreightOperators(road, emptyRail(), 0, demand);
    expect(before.state.flows[0]?.chosenMode).toBe("road");
    const accessibility = createAccessibilityScorer(
      {
        candidates: [{ id: "origin", name: "Origin", position: start }],
        opportunities: [{ id: "jobs", factor: "labor", position: end, weight: 100 }],
        decayCost: 10,
      },
      before.roadNetwork,
    );
    const congestedRoadCost =
      accessibility.getSnapshot().locations[0]!.labor.nearestNetworkCost;

    const rail = createRailNetwork(
      [{ id: "track", start, end }],
      [
        createFreightRailTerminalState(geography, "quarry"),
        createFreightRailTerminalState(geography, "stoneworks"),
      ],
      geography,
    );
    const shifted = createFreightOperators(road, rail, 0, demand);

    expect(shifted.state.flows[0]?.chosenMode).toBe("rail");
    expect(shifted.roadNetwork.links[0]?.assignedFlowUnitsPerDay).toBe(0);
    expect(shifted.railNetwork.links[0]).toMatchObject({
      assignedFlowTonsPerDay: 120,
      congestionDelayHours: 0,
    });
    expect(
      shifted.railNetwork.terminals.map(({ assignedHandlingTonsPerDay }) =>
        assignedHandlingTonsPerDay),
    ).toEqual([120, 120]);
    expect(
      accessibility.updateNetwork(shifted.roadNetwork).locations[0]!.labor
        .nearestNetworkCost,
    ).toBeLessThan(congestedRoadCost!);
    const railCandidate = freightServiceCandidates(
      shifted.roadNetwork,
      shifted.railNetwork,
      shifted.state,
      demand[0].id,
    )[1]!;
    expect(railCandidate).toMatchObject({
      capacityTonsPerDay: 240,
      terminalHandlingTimeHours: 1.5,
      accessEgressTimeHours: 0,
    });
  });
});
