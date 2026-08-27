// @vitest-environment node

import { describe, expect, it } from "vitest";
import { OLD_MILLFORD_BRIDGE_ROAD_ID } from "../scenarios";
import { createSimulation, restoreSimulation } from ".";

function connectRoadChain(simulation: ReturnType<typeof createSimulation>): void {
  const geography = simulation.getSnapshot().geography;
  simulation.dispatch({
    type: "build-road",
    start: geography.quarry.position,
    end: geography.stoneworks.position,
  });
  simulation.dispatch({
    type: "build-road",
    start: geography.settlementSeeds.find(
      ({ id }) => id === "settlement-eastbank",
    )!.position,
    end: geography.externalMarketConnection.position,
  });
}

function namedValue(
  values: readonly { readonly label: string; readonly value: number }[],
  label: string,
): number | undefined {
  return values.find((entry) => entry.label === label)?.value;
}

describe("cross-system simulation explanations", () => {
  it("uses assignment and supply-chain values for movement, choice, and limits", () => {
    const simulation = createSimulation("explanation-authority");
    connectRoadChain(simulation);
    const snapshot = simulation.dispatch({ type: "advance", ticks: 24 });
    const inbound = snapshot.stoneSupplyChain.inboundFreight;
    const explanation = snapshot.explanations.freightLegs[0]!;

    expect(explanation).toMatchObject({
      actorName: "Private freight operator",
      commodityName: "raw granite",
      origin: { id: inbound.originId, name: snapshot.geography.quarry.name },
      destination: {
        id: inbound.destinationId,
        name: snapshot.geography.stoneworks.name,
      },
      chosenMode: inbound.chosenMode,
      routeLinkIds: inbound.route?.linkIds,
      routeGeneralizedCostHours: inbound.routeCost,
      limitingFactor: inbound.limitingFactor,
      limitingReason: inbound.limitingReason,
      nextAssignmentTick: snapshot.time.nextTrafficUpdateTick,
    });
    expect(namedValue(explanation.limitingValues, "Available supply")).toBe(
      inbound.availableTonsPerDay,
    );
    expect(namedValue(explanation.limitingValues, "Requested capacity")).toBe(
      inbound.requestedTonsPerDay,
    );
    expect(namedValue(explanation.limitingValues, "Realized shipment")).toBe(
      inbound.shippedTonsPerDay,
    );
    expect(explanation.services).toEqual(
      inbound.serviceCandidates.map((candidate) =>
        expect.objectContaining({
          mode: candidate.mode,
          generalizedCostHours: candidate.generalizedCostHours,
          capacityTonsPerDay: candidate.capacityTonsPerDay,
          congestionDelayHours: candidate.congestionDelayHours,
          terminalHandlingTimeHours: candidate.terminalHandlingTimeHours,
          priceAdjustmentHours: candidate.priceAdjustmentHours,
          routeLinkIds: candidate.route?.linkIds ?? [],
        }),
      ),
    );
    expect(explanation.choiceCanChangeBecause).toContain(
      `tick ${snapshot.time.nextTrafficUpdateTick}`,
    );

    const production = snapshot.explanations.production;
    const stoneworks = snapshot.stoneSupplyChain.stoneworks;
    expect(production.limitingFactor).toBe(stoneworks.limitingFactor);
    expect(namedValue(production.limitingValues, "Realized processing")).toBe(
      stoneworks.processedTonsPerDay,
    );
    expect(namedValue(production.limitingValues, "Processing capacity")).toBe(
      stoneworks.processingCapacityTonsPerDay,
    );
    expect(snapshot.explanations.objectiveDecision.conditions).toBe(
      snapshot.scenarioProgress.successConditions,
    );
    expect(
      namedValue(
        snapshot.explanations.objectiveDecision.values,
        "Completed infrastructure growth",
      ),
    ).toBe(snapshot.development.demand.completedGrowthPopulation);
    expect(
      namedValue(
        snapshot.explanations.objectiveDecision.values,
        "Next daily maintenance and penalty",
      ),
    ).toBe(
      snapshot.finances.dailyMaintenance +
        snapshot.finances.emergencyFinance.dailyPenalty,
    );
  });

  it("separates finance effects using the committed transaction and charged totals", () => {
    const simulation = createSimulation("finance-explanation-authority");
    const geography = simulation.getSnapshot().geography;
    const snapshot = simulation.dispatch({
      type: "build-road",
      start: { x: 600, y: 180 },
      end: { x: 700, y: 180 },
      roadClass: "highway",
    });
    const transaction = snapshot.finances.lastInfrastructureTransaction!;
    const finance = snapshot.explanations.finance;

    expect(finance.latestCapitalTransaction).toEqual({
      tick: transaction.tick,
      kind: transaction.breakdown.transactionKind,
      baseConstruction: transaction.breakdown.baseCost,
      landAcquisition: transaction.breakdown.landAcquisitionCost,
      crossingWork: transaction.breakdown.crossingWorkCost,
      salvageCredit: transaction.breakdown.salvageCredit,
      netTreasuryEffect: -transaction.breakdown.netCost,
    });
    expect(finance.totalMaintenancePerDay).toBe(snapshot.finances.dailyMaintenance);
    expect(
      finance.roadAndCrossingMaintenancePerDay + finance.railMaintenancePerDay,
    ).toBe(snapshot.finances.dailyMaintenance);
    expect(finance.totalOperatingRevenue).toBe(
      snapshot.finances.totalOperatingRevenue,
    );
    expect(geography.fertileLand.id).toBe(
      transaction.breakdown.affectedLandIds[0],
    );
  });

  it("retains pre-intervention accessibility for both settlements", () => {
    const simulation = createSimulation("development-consequence-authority");
    connectRoadChain(simulation);
    const pressured = simulation.dispatch({ type: "advance", ticks: 24 });
    expect(pressured.scenarioProgress.objectives[2]?.complete).toBe(true);

    const before = pressured.accessibility.locations.map((location) => ({
      id: location.locationId,
      total:
        Math.round(
          (location.market.score + location.labor.score + location.resource.score + location.service.score) * 100,
        ) / 100,
    }));
    const intervened = simulation.dispatch({
      type: "upgrade-road",
      roadSegmentId: OLD_MILLFORD_BRIDGE_ROAD_ID,
    });

    expect(intervened.explanations.developmentSinceIntervention).toHaveLength(2);
    for (const consequence of intervened.explanations.developmentSinceIntervention) {
      expect(consequence.baselineTick).toBe(pressured.tick);
      expect(consequence.baselineAccessibility).toBe(
        before.find(({ id }) => id === consequence.locationId)?.total,
      );
      expect(consequence.change).toBeCloseTo(
        consequence.currentAccessibility - consequence.baselineAccessibility,
        2,
      );
    }
  });

  it("forecasts the exact next assignment, daily, and development reducer results", () => {
    const simulation = createSimulation("deterministic-consequence-forecast");
    connectRoadChain(simulation);
    const state = simulation.getState();
    const forecast = simulation.getSnapshot().explanations.consequenceForecast;

    expect(forecast.map(({ kind }) => kind)).toEqual([
      "traffic-assignment",
      "economy-and-finance",
      "development",
    ]);
    for (const entry of forecast) {
      const actual = restoreSimulation(state).dispatch({
        type: "advance",
        ticks: entry.tick - state.tick,
      });
      if (entry.kind === "traffic-assignment") {
        expect(namedValue(entry.values, "Inbound assigned")).toBe(
          actual.stoneSupplyChain.inboundFreight.assignedTonsPerDay,
        );
        expect(namedValue(entry.values, "Outbound assigned")).toBe(
          actual.stoneSupplyChain.outboundFreight.assignedTonsPerDay,
        );
      } else if (entry.kind === "economy-and-finance") {
        expect(namedValue(entry.values, "Stone processed")).toBe(
          actual.stoneSupplyChain.stoneworks.processedTonsPerDay,
        );
        expect(namedValue(entry.values, "Treasury after update")).toBe(
          actual.finances.balance,
        );
      } else {
        for (const location of actual.development.locations) {
          expect(namedValue(entry.values, `${location.name} pressure`)).toBe(
            location.pressure,
          );
        }
        expect(namedValue(entry.values, "Committed regional growth")).toBe(
          actual.development.demand.committedGrowthPopulation,
        );
      }
    }
  });
});
