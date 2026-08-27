import type {
  AccessibilitySnapshot,
  AggregateFreightSnapshot,
  AuthoritativeValueExplanation,
  ConsequenceForecastEntry,
  DevelopmentSnapshot,
  FinanceSnapshot,
  FreightLegExplanation,
  RailNetwork,
  RoadNetwork,
  ScenarioGeography,
  ScenarioProgressSnapshot,
  SimulationExplanationsSnapshot,
  StoneSupplyChainSnapshot,
} from "../shared";
import {
  calculateDailyRailMaintenance,
  calculateDailyRoadMaintenance,
} from "./economy/infrastructure-finance";
import type { StrategicInterventionAccessibilityBaseline } from "./scenario/millford-scenario";

function value(
  label: string,
  amount: number,
  unit: AuthoritativeValueExplanation["unit"],
): AuthoritativeValueExplanation {
  return Object.freeze({ label, value: amount, unit });
}

function siteName(geography: ScenarioGeography, id: string): string {
  return [
    geography.quarry,
    geography.stoneworks,
    geography.externalMarketConnection,
    ...geography.settlementSeeds,
  ].find((site) => site.id === id)?.name ?? id;
}

function freightExplanation(
  freight: AggregateFreightSnapshot,
  geography: ScenarioGeography,
  nextAssignmentTick: number,
): FreightLegExplanation {
  const chosen = freight.serviceCandidates.find(
    ({ mode }) => mode === freight.chosenMode,
  );
  return Object.freeze({
    legId: freight.id,
    actorName: "Private freight operator",
    commodityName:
      freight.commodity === "raw-granite" ? "raw granite" : "finished stone",
    origin: Object.freeze({
      id: freight.originId,
      name: siteName(geography, freight.originId),
    }),
    destination: Object.freeze({
      id: freight.destinationId,
      name: siteName(geography, freight.destinationId),
    }),
    chosenMode: freight.chosenMode,
    routeLinkIds: Object.freeze([...(freight.route?.linkIds ?? [])]),
    routeGeneralizedCostHours: freight.routeCost,
    limitingFactor: freight.limitingFactor,
    limitingReason: freight.limitingReason,
    limitingValues: Object.freeze([
      value("Available supply", freight.availableTonsPerDay, "tons/day"),
      value("Requested capacity", freight.requestedTonsPerDay, "tons/day"),
      value("Operator demand", freight.demandTonsPerDay, "tons/day"),
      value("Assigned service", freight.assignedTonsPerDay, "tons/day"),
      value("Realized shipment", freight.shippedTonsPerDay, "tons/day"),
      ...(freight.routeCost === null
        ? []
        : [value("Chosen route cost", freight.routeCost, "hours")]),
    ]),
    services: Object.freeze(
      freight.serviceCandidates.map((candidate) =>
        Object.freeze({
          mode: candidate.mode,
          status: !candidate.viable
            ? ("unavailable" as const)
            : candidate.mode === freight.chosenMode
              ? ("chosen" as const)
              : ("alternative" as const),
          generalizedCostHours: candidate.generalizedCostHours,
          costDifferenceFromChosenHours:
            candidate.generalizedCostHours === null ||
            chosen?.generalizedCostHours === null ||
            chosen?.generalizedCostHours === undefined
              ? null
              : candidate.generalizedCostHours - chosen.generalizedCostHours,
          capacityTonsPerDay: candidate.capacityTonsPerDay,
          freeFlowTravelTimeHours: candidate.freeFlowTravelTimeHours,
          congestionDelayHours: candidate.congestionDelayHours,
          terminalHandlingTimeHours: candidate.terminalHandlingTimeHours,
          accessEgressTimeHours: candidate.accessEgressTimeHours,
          priceAdjustmentHours: candidate.priceAdjustmentHours,
          routeLinkIds: Object.freeze([...(candidate.route?.linkIds ?? [])]),
          reason: candidate.reason,
        }),
      ),
    ),
    nextAssignmentTick,
    choiceCanChangeBecause:
      `Road and rail costs are compared again at tick ${nextAssignmentTick}; ` +
      "a network, terminal, congestion, or service-price change reassigns immediately.",
  });
}

function accessibilityTotal(
  accessibility: AccessibilitySnapshot,
  locationId: string,
): number {
  const location = accessibility.locations.find(
    (candidate) => candidate.locationId === locationId,
  );
  if (!location) return 0;
  return (
    Math.round(
      (location.market.score +
        location.labor.score +
        location.resource.score +
        location.service.score +
        Number.EPSILON) *
        100,
    ) / 100
  );
}

export function createSimulationExplanations(
  geography: ScenarioGeography,
  supplyChain: StoneSupplyChainSnapshot,
  finances: FinanceSnapshot,
  roadNetwork: RoadNetwork,
  railNetwork: RailNetwork,
  accessibility: AccessibilitySnapshot,
  development: DevelopmentSnapshot,
  latestIntervention: StrategicInterventionAccessibilityBaseline | null,
  nextAssignmentTick: number,
  scenarioProgress: ScenarioProgressSnapshot,
  consequenceForecast: readonly ConsequenceForecastEntry[] = [],
): SimulationExplanationsSnapshot {
  const transaction = finances.lastInfrastructureTransaction;
  const roadMaintenance = calculateDailyRoadMaintenance(geography, roadNetwork);
  const railMaintenance = calculateDailyRailMaintenance(railNetwork);
  const stoneworks = supplyChain.stoneworks;
  return Object.freeze({
    freightLegs: Object.freeze([
      freightExplanation(supplyChain.inboundFreight, geography, nextAssignmentTick),
      freightExplanation(supplyChain.outboundFreight, geography, nextAssignmentTick),
    ]),
    production: Object.freeze({
      siteId: stoneworks.id,
      siteName: stoneworks.name,
      limitingFactor: stoneworks.limitingFactor,
      limitingReason: stoneworks.limitingReason,
      limitingValues: Object.freeze([
        value("Raw-granite inventory", stoneworks.inputInventoryTons, "tons"),
        value("Input storage capacity", stoneworks.inputStorageCapacityTons, "tons"),
        value("Realized processing", stoneworks.processedTonsPerDay, "tons/day"),
        value("Processing capacity", stoneworks.processingCapacityTonsPerDay, "tons/day"),
        value("Finished-stone inventory", stoneworks.finishedStoneInventoryTons, "tons"),
        value("Output storage capacity", stoneworks.outputStorageCapacityTons, "tons"),
      ]),
    }),
    finance: Object.freeze({
      balance: finances.balance,
      latestCapitalTransaction: transaction
        ? Object.freeze({
            tick: transaction.tick,
            kind: transaction.breakdown.transactionKind,
            baseConstruction: transaction.breakdown.baseCost,
            landAcquisition: transaction.breakdown.landAcquisitionCost,
            crossingWork: transaction.breakdown.crossingWorkCost,
            salvageCredit: transaction.breakdown.salvageCredit,
            netTreasuryEffect: -transaction.breakdown.netCost,
          })
        : null,
      roadAndCrossingMaintenancePerDay: roadMaintenance,
      railMaintenancePerDay: railMaintenance,
      totalMaintenancePerDay: finances.dailyMaintenance,
      lastOperatingRevenue: finances.lastDailyRevenue,
      totalOperatingRevenue: finances.totalOperatingRevenue,
      emergencyProceedsReceived:
        finances.emergencyFinance.bondsIssued *
        finances.emergencyFinance.bondProceeds,
      emergencyPenaltyPerDay: finances.emergencyFinance.dailyPenalty,
      totalEmergencyPenaltiesPaid:
        finances.emergencyFinance.totalPenaltiesPaid,
    }),
    developmentSinceIntervention: Object.freeze(
      accessibility.locations.map((location) => {
        const current = accessibilityTotal(accessibility, location.locationId);
        const baseline = latestIntervention?.locations.find(
          ({ locationId }) => locationId === location.locationId,
        )?.accessibility ?? current;
        const change = Math.round((current - baseline + Number.EPSILON) * 100) / 100;
        return Object.freeze({
          locationId: location.locationId,
          name: location.name,
          baselineTick: latestIntervention?.tick ?? null,
          baselineAccessibility: baseline,
          currentAccessibility: current,
          change,
          direction:
            change > 0 ? ("gain" as const) : change < 0 ? ("loss" as const) : ("unchanged" as const),
        });
      }),
    ),
    objectiveDecision: Object.freeze({
      conditions: scenarioProgress.successConditions,
      values: Object.freeze([
        value("Inbound freight served", supplyChain.inboundFreight.shippedTonsPerDay, "tons/day"),
        value("Outbound freight served", supplyChain.outboundFreight.shippedTonsPerDay, "tons/day"),
        value("Completed infrastructure growth", development.demand.completedGrowthPopulation, "residents"),
        value("Treasury balance", finances.balance, "currency"),
        value("Next daily maintenance and penalty", finances.dailyMaintenance + finances.emergencyFinance.dailyPenalty, "currency"),
      ]),
    }),
    consequenceForecast: Object.freeze([...consequenceForecast]),
  });
}
