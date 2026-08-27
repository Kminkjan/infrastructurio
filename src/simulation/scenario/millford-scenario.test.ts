// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createSimulation, restoreSimulation } from "..";
import { OLD_MILLFORD_BRIDGE_ROAD_ID } from "../../scenarios";
import { STARTING_TREASURY_BALANCE } from "../economy/infrastructure-finance";

function inspectStartingSites(simulation: ReturnType<typeof createSimulation>): void {
  const geography = simulation.getSnapshot().geography;
  for (const entityId of [
    geography.quarry.id,
    geography.stoneworks.id,
    geography.externalMarketConnection.id,
  ]) {
    simulation.dispatch({ type: "inspect-entity", entityId });
  }
}

function activateRoadSupplyChain(
  simulation: ReturnType<typeof createSimulation>,
): void {
  const geography = simulation.getSnapshot().geography;
  const eastbank = geography.settlementSeeds.find(
    ({ id }) => id === "settlement-eastbank",
  )!;
  simulation.dispatch({
    type: "build-road",
    start: geography.quarry.position,
    end: geography.stoneworks.position,
  });
  simulation.dispatch({
    type: "build-road",
    start: eastbank.position,
    end: geography.externalMarketConnection.position,
  });
}

function reachFirstStableDay(
  simulation: ReturnType<typeof createSimulation>,
): void {
  inspectStartingSites(simulation);
  activateRoadSupplyChain(simulation);
  const pressured = simulation.dispatch({ type: "advance", ticks: 24 });
  expect(
    pressured.bottlenecks.roadBottlenecks.some(
      ({ roadSegmentId }) => roadSegmentId === OLD_MILLFORD_BRIDGE_ROAD_ID,
    ),
  ).toBe(true);
  simulation.dispatch({
    type: "upgrade-road",
    roadSegmentId: OLD_MILLFORD_BRIDGE_ROAD_ID,
  });
  simulation.dispatch({ type: "advance", ticks: 24 * 13 });
}

describe("guided Millford Valley scenario", () => {
  it("starts with the authored old bridge, incomplete chain, dormant industry, and tuned funds", () => {
    const simulation = createSimulation("guided-start");
    const initial = simulation.getSnapshot();

    expect(initial.geography.settlementSeeds).toHaveLength(2);
    expect(initial.roadNetwork.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: OLD_MILLFORD_BRIDGE_ROAD_ID,
          roadClass: "local",
        }),
      ]),
    );
    expect(
      simulation.findRoute(
        initial.geography.quarry.position,
        initial.geography.stoneworks.position,
      ),
    ).toBeUndefined();
    expect(
      simulation.findRoute(
        initial.geography.stoneworks.position,
        initial.geography.externalMarketConnection.position,
      ),
    ).toBeUndefined();
    expect(initial.stoneSupplyChain.stoneworks.active).toBe(false);
    expect(initial.finances.balance).toBe(STARTING_TREASURY_BALANCE);
  });

  it("advances the authoritative objective state machine from inspection through intervention", () => {
    const simulation = createSimulation("objective-state-machine");
    const geography = simulation.getSnapshot().geography;

    expect(simulation.getSnapshot().scenarioProgress.activeObjectiveId).toBe(
      "inspect-network",
    );
    for (const entityId of [
      geography.quarry.id,
      geography.stoneworks.id,
      geography.externalMarketConnection.id,
    ]) {
      simulation.dispatch({ type: "inspect-entity", entityId });
    }
    expect(simulation.getSnapshot().scenarioProgress.activeObjectiveId).toBe(
      "activate-supply-chain",
    );

    activateRoadSupplyChain(simulation);
    const pressured = simulation.dispatch({ type: "advance", ticks: 24 });
    expect(pressured.scenarioProgress.objectives).toMatchObject([
      { id: "inspect-network", complete: true },
      { id: "activate-supply-chain", complete: true },
      { id: "observe-pressure", complete: true },
      { id: "intervene", complete: false },
      { id: "stabilize", complete: false },
    ]);

    const relieved = simulation.dispatch({
      type: "upgrade-road",
      roadSegmentId: OLD_MILLFORD_BRIDGE_ROAD_ID,
    });
    expect(relieved.scenarioProgress.activeObjectiveId).toBe("stabilize");
    expect(
      relieved.scenarioProgress.successConditions
        .bridgeRelievedOrFreightShifted,
    ).toBe(true);
  });

  it("requires three consecutive fully stable daily boundaries", () => {
    const simulation = createSimulation("success-hold");
    reachFirstStableDay(simulation);

    expect(simulation.getSnapshot().scenarioProgress).toMatchObject({
      successfulDays: 1,
      success: false,
      successConditions: {
        bothLegsServed: true,
        bridgeRelievedOrFreightShifted: true,
        infrastructureGrowthCompleted: true,
        financesMaintainable: true,
      },
    });
    expect(
      simulation.dispatch({ type: "advance", ticks: 24 }).scenarioProgress,
    ).toMatchObject({ successfulDays: 2, success: false });
    const completed = simulation.dispatch({ type: "advance", ticks: 24 });
    expect(completed.scenarioProgress).toMatchObject({
      successfulDays: 3,
      success: true,
      ending: {
        intervention: "bridge-upgrade",
        bridgeStatus: "relieved",
      },
    });
    expect(completed.scenarioProgress.ending?.accessibilityChanges).toHaveLength(2);
  });

  it("preserves the success hold across restore and resets every recovery consequence", () => {
    const simulation = createSimulation("progress-continuation");
    reachFirstStableDay(simulation);
    const savedState = simulation.getState();
    const restored = restoreSimulation(savedState);

    expect(restored.getSnapshot().scenarioProgress.successfulDays).toBe(1);
    expect(
      restored.dispatch({ type: "advance", ticks: 48 }).scenarioProgress.success,
    ).toBe(true);

    const recovery = createSimulation("recovery-reset");
    recovery.dispatch({
      type: "build-road",
      start: { x: 0, y: 0 },
      end: { x: 960, y: 0 },
      roadClass: "highway",
    });
    recovery.dispatch({
      type: "build-road",
      start: { x: 0, y: 20 },
      end: { x: 960, y: 20 },
      roadClass: "arterial",
    });
    const bonded = recovery.dispatch({ type: "issue-emergency-bond" });
    expect(bonded.finances.emergencyFinance).toMatchObject({
      bondsIssued: 1,
      dailyPenalty: 150,
    });
    expect(recovery.dispatch({ type: "reset" })).toEqual(
      createSimulation("recovery-reset").getSnapshot(),
    );
  });

  it("exposes deterministic traffic, economy, maintenance, and development cadence", () => {
    const simulation = createSimulation("time-cadence");
    expect(simulation.getSnapshot().time).toMatchObject({
      trafficUpdateIntervalTicks: 8,
      economyUpdateIntervalTicks: 24,
      developmentUpdateIntervalTicks: 168,
      nextTrafficUpdateTick: 8,
      nextEconomyUpdateTick: 24,
      nextMaintenanceUpdateTick: 24,
      nextDevelopmentUpdateTick: 168,
    });
    expect(simulation.dispatch({ type: "advance", ticks: 8 }).time).toMatchObject({
      nextTrafficUpdateTick: 16,
      nextEconomyUpdateTick: 24,
    });
  });
});
