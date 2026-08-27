import type {
  AccessibilitySnapshot,
  BottleneckAnalysisSnapshot,
  DevelopmentSnapshot,
  FinanceSnapshot,
  RoadNetwork,
  ScenarioEndingSummary,
  ScenarioGeography,
  ScenarioInterventionChoice,
  ScenarioObjectiveSnapshot,
  ScenarioProgressSnapshot,
  ScenarioSuccessConditionsSnapshot,
  StoneSupplyChainSnapshot,
} from "../../shared";
import { TICKS_PER_DAY } from "../../shared";
import { OLD_MILLFORD_BRIDGE_ROAD_ID } from "../../scenarios";

export const REQUIRED_SUCCESSFUL_DAYS = 3;

const REQUIRED_INSPECTION_COUNT = 3;

export interface StrategicInterventionAccessibilityBaseline {
  readonly tick: number;
  readonly locations: readonly {
    readonly locationId: string;
    readonly accessibility: number;
  }[];
}

export interface ScenarioProgressStateSnapshot {
  readonly processedTick: number;
  readonly inspectedEntityIds: readonly string[];
  readonly supplyChainActivated: boolean;
  readonly bridgeOverloadObserved: boolean;
  readonly interventionCompleted: boolean;
  readonly successfulDays: number;
  readonly lastEvaluatedDayTick: number;
  readonly latestStrategicIntervention: StrategicInterventionAccessibilityBaseline | null;
  readonly ending: ScenarioEndingSummary | null;
}

export interface ScenarioProgressContext {
  readonly tick: number;
  readonly geography: ScenarioGeography;
  readonly roadNetwork: RoadNetwork;
  readonly supplyChain: StoneSupplyChainSnapshot;
  readonly finances: FinanceSnapshot;
  readonly bottlenecks: BottleneckAnalysisSnapshot;
  readonly accessibility: AccessibilitySnapshot;
  readonly development: DevelopmentSnapshot;
  readonly initialAccessibility: AccessibilitySnapshot;
}

function relevantInspectionIds(geography: ScenarioGeography): readonly string[] {
  return Object.freeze([
    geography.quarry.id,
    geography.stoneworks.id,
    geography.externalMarketConnection.id,
  ]);
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function accessibilityScore(
  snapshot: AccessibilitySnapshot,
  locationId: string,
): number {
  const location = snapshot.locations.find(
    (candidate) => candidate.locationId === locationId,
  );
  if (!location) return 0;
  return money(
    location.market.score +
      location.labor.score +
      location.resource.score +
      location.service.score,
  );
}

function bridgeValues(context: ScenarioProgressContext): {
  readonly present: boolean;
  readonly upgraded: boolean;
  readonly assigned: number;
  readonly capacity: number;
  readonly overloaded: boolean;
  readonly usedByOutbound: boolean;
} {
  const segment = context.roadNetwork.segments.find(
    ({ id }) => id === OLD_MILLFORD_BRIDGE_ROAD_ID,
  );
  const links = context.roadNetwork.links.filter(
    ({ roadSegmentId }) => roadSegmentId === OLD_MILLFORD_BRIDGE_ROAD_ID,
  );
  const assigned = Math.max(
    0,
    ...links.map((link) => link.assignedFlowUnitsPerDay),
  );
  const capacity = links.length === 0
    ? 0
    : Math.min(...links.map((link) => link.capacityUnitsPerDay));
  const outboundRoute = context.supplyChain.outboundFreight.route;
  return Object.freeze({
    present: segment !== undefined,
    upgraded: segment?.roadClass === "highway",
    assigned,
    capacity,
    overloaded:
      links.some(
        (link) => link.assignedFlowUnitsPerDay > link.capacityUnitsPerDay,
      ) ||
      context.bottlenecks.roadBottlenecks.some(
        ({ roadSegmentId }) => roadSegmentId === OLD_MILLFORD_BRIDGE_ROAD_ID,
      ),
    usedByOutbound:
      outboundRoute?.mode === "road" &&
      outboundRoute.linkIds.some((id) => links.some((link) => link.id === id)),
  });
}

function bothLegsServed(context: ScenarioProgressContext): boolean {
  return (
    context.supplyChain.inboundFreight.shippedTonsPerDay > 0 &&
    context.supplyChain.outboundFreight.shippedTonsPerDay > 0
  );
}

function currentInterventionResolved(
  state: ScenarioProgressStateSnapshot,
  context: ScenarioProgressContext,
): boolean {
  if (!state.bridgeOverloadObserved || !bothLegsServed(context)) return false;
  const bridge = bridgeValues(context);
  return (
    !bridge.overloaded &&
    (bridge.upgraded || !bridge.usedByOutbound || !bridge.present)
  );
}

function successConditions(
  state: ScenarioProgressStateSnapshot,
  context: ScenarioProgressContext,
): ScenarioSuccessConditionsSnapshot {
  return Object.freeze({
    bothLegsServed: bothLegsServed(context),
    bridgeRelievedOrFreightShifted: currentInterventionResolved(state, context),
    infrastructureGrowthCompleted:
      context.development.demand.completedGrowthPopulation > 0,
    financesMaintainable:
      context.finances.balance >=
      context.finances.dailyMaintenance +
        context.finances.emergencyFinance.dailyPenalty,
  });
}

function allConditionsMet(
  conditions: ScenarioSuccessConditionsSnapshot,
): boolean {
  return Object.values(conditions).every(Boolean);
}

function interventionChoice(
  context: ScenarioProgressContext,
): ScenarioInterventionChoice {
  const bridge = bridgeValues(context);
  const railShift = context.supplyChain.outboundFreight.chosenMode === "rail";
  const roadBypass =
    context.supplyChain.outboundFreight.chosenMode === "road" &&
    !bridge.usedByOutbound;
  const choices = [bridge.upgraded, roadBypass, railShift].filter(Boolean).length;
  if (choices > 1) return "combined";
  if (railShift) return "rail-shift";
  if (roadBypass) return "road-bypass";
  return "bridge-upgrade";
}

function endingSummary(
  context: ScenarioProgressContext,
): ScenarioEndingSummary {
  const bridge = bridgeValues(context);
  const freight = [
    context.supplyChain.inboundFreight,
    context.supplyChain.outboundFreight,
  ];
  const roadFreight = freight.reduce(
    (total, leg) =>
      total + (leg.chosenMode === "road" ? leg.shippedTonsPerDay : 0),
    0,
  );
  const railFreight = freight.reduce(
    (total, leg) =>
      total + (leg.chosenMode === "rail" ? leg.shippedTonsPerDay : 0),
    0,
  );
  const totalFreight = roadFreight + railFreight;
  return Object.freeze({
    completedTick: context.tick,
    intervention: interventionChoice(context),
    totalCapitalSpending: context.finances.totalCapitalSpending,
    totalMaintenancePaid: context.finances.totalMaintenancePaid,
    dailyMaintenance: context.finances.dailyMaintenance,
    roadFreightTonsPerDay: roadFreight,
    railFreightTonsPerDay: railFreight,
    roadFreightShare: totalFreight === 0 ? 0 : roadFreight / totalFreight,
    railFreightShare: totalFreight === 0 ? 0 : railFreight / totalFreight,
    bridgeStatus: !bridge.present
      ? "removed"
      : bridge.assigned === 0
        ? "unused"
        : "relieved",
    bridgeAssignedTonsPerDay: bridge.assigned,
    bridgeCapacityTonsPerDay: bridge.capacity,
    accessibilityChanges: Object.freeze(
      context.accessibility.locations.map((location) => {
        const initialScore = accessibilityScore(
          context.initialAccessibility,
          location.locationId,
        );
        const finalScore = accessibilityScore(
          context.accessibility,
          location.locationId,
        );
        return Object.freeze({
          locationId: location.locationId,
          name: location.name,
          initialScore,
          finalScore,
          change: money(finalScore - initialScore),
        });
      }),
    ),
  });
}

export function createScenarioProgressState(
  processedTick = 0,
): ScenarioProgressStateSnapshot {
  if (!Number.isSafeInteger(processedTick) || processedTick < 0) {
    throw new RangeError(
      "scenario progress tick must be a non-negative safe integer",
    );
  }
  return Object.freeze({
    processedTick,
    inspectedEntityIds: Object.freeze([]),
    supplyChainActivated: false,
    bridgeOverloadObserved: false,
    interventionCompleted: false,
    successfulDays: 0,
    lastEvaluatedDayTick:
      Math.floor(processedTick / TICKS_PER_DAY) * TICKS_PER_DAY,
    latestStrategicIntervention: null,
    ending: null,
  });
}

export function validateScenarioProgressState(
  input: ScenarioProgressStateSnapshot,
  simulationTick: number,
  geography: ScenarioGeography,
): ScenarioProgressStateSnapshot {
  if (input.processedTick !== simulationTick) {
    throw new RangeError("scenario progress state must match the simulation tick");
  }
  const relevant = new Set(relevantInspectionIds(geography));
  if (
    new Set(input.inspectedEntityIds).size !== input.inspectedEntityIds.length ||
    input.inspectedEntityIds.some((id) => !relevant.has(id))
  ) {
    throw new RangeError("scenario progress contains invalid inspected entities");
  }
  if (
    !Number.isSafeInteger(input.successfulDays) ||
    input.successfulDays < 0 ||
    input.successfulDays > REQUIRED_SUCCESSFUL_DAYS ||
    !Number.isSafeInteger(input.lastEvaluatedDayTick) ||
    input.lastEvaluatedDayTick < 0 ||
    input.lastEvaluatedDayTick > simulationTick ||
    input.lastEvaluatedDayTick % TICKS_PER_DAY !== 0
  ) {
    throw new RangeError("scenario progress cadence is invalid");
  }
  if (input.ending !== null && input.successfulDays !== REQUIRED_SUCCESSFUL_DAYS) {
    throw new RangeError("scenario ending requires the complete success hold");
  }
  const intervention = input.latestStrategicIntervention;
  const settlementIds = new Set(geography.settlementSeeds.map(({ id }) => id));
  if (
    intervention !== null &&
    (!Number.isSafeInteger(intervention.tick) ||
      intervention.tick < 0 ||
      intervention.tick > simulationTick ||
      intervention.locations.length !== settlementIds.size ||
      new Set(intervention.locations.map(({ locationId }) => locationId)).size !==
        intervention.locations.length ||
      intervention.locations.some(
        ({ locationId, accessibility }) =>
          !settlementIds.has(locationId) ||
          !Number.isFinite(accessibility) ||
          accessibility < 0,
      ))
  ) {
    throw new RangeError("strategic intervention accessibility baseline is invalid");
  }
  return Object.freeze({
    ...input,
    inspectedEntityIds: Object.freeze([...input.inspectedEntityIds]),
    latestStrategicIntervention:
      intervention === null
        ? null
        : Object.freeze({
            tick: intervention.tick,
            locations: Object.freeze(
              intervention.locations.map((location) => Object.freeze({ ...location })),
            ),
          }),
    ending: input.ending === null ? null : Object.freeze(input.ending),
  });
}

export function recordStrategicIntervention(
  state: ScenarioProgressStateSnapshot,
  accessibility: AccessibilitySnapshot,
): ScenarioProgressStateSnapshot {
  if (!state.bridgeOverloadObserved) return state;
  return Object.freeze({
    ...state,
    latestStrategicIntervention: Object.freeze({
      tick: state.processedTick,
      locations: Object.freeze(
        accessibility.locations.map((location) =>
          Object.freeze({
            locationId: location.locationId,
            accessibility: accessibilityScore(accessibility, location.locationId),
          }),
        ),
      ),
    }),
  });
}

export function recordScenarioInspection(
  state: ScenarioProgressStateSnapshot,
  geography: ScenarioGeography,
  entityId: string,
): ScenarioProgressStateSnapshot {
  if (
    !relevantInspectionIds(geography).includes(entityId) ||
    state.inspectedEntityIds.includes(entityId)
  ) {
    return state;
  }
  return Object.freeze({
    ...state,
    inspectedEntityIds: Object.freeze([...state.inspectedEntityIds, entityId]),
  });
}

export function updateScenarioProgress(
  state: ScenarioProgressStateSnapshot,
  context: ScenarioProgressContext,
  evaluateDailyBoundary: boolean,
): ScenarioProgressStateSnapshot {
  const activated = state.supplyChainActivated || bothLegsServed(context);
  const bridgeObserved =
    state.bridgeOverloadObserved || bridgeValues(context).overloaded;
  let next: ScenarioProgressStateSnapshot = Object.freeze({
    ...state,
    processedTick: context.tick,
    supplyChainActivated: activated,
    bridgeOverloadObserved: bridgeObserved,
  });
  next = Object.freeze({
    ...next,
    interventionCompleted:
      next.interventionCompleted || currentInterventionResolved(next, context),
  });

  if (
    evaluateDailyBoundary &&
    context.tick > next.lastEvaluatedDayTick &&
    context.tick % TICKS_PER_DAY === 0 &&
    next.ending === null
  ) {
    const conditions = successConditions(next, context);
    const successfulDays = allConditionsMet(conditions)
      ? Math.min(REQUIRED_SUCCESSFUL_DAYS, next.successfulDays + 1)
      : 0;
    next = Object.freeze({
      ...next,
      successfulDays,
      lastEvaluatedDayTick: context.tick,
      ending:
        successfulDays === REQUIRED_SUCCESSFUL_DAYS
          ? endingSummary(context)
          : null,
    });
  }
  return next;
}

export function createScenarioProgressSnapshot(
  state: ScenarioProgressStateSnapshot,
  context: ScenarioProgressContext,
): ScenarioProgressSnapshot {
  const inspectionIds = relevantInspectionIds(context.geography);
  const inspectionCount = inspectionIds.filter((id) =>
    state.inspectedEntityIds.includes(id),
  ).length;
  const conditions = successConditions(state, context);
  const objectives: readonly ScenarioObjectiveSnapshot[] = Object.freeze([
    Object.freeze({
      id: "inspect-network" as const,
      title: "Read the incomplete network",
      guidance: "Inspect the quarry, stoneworks, and Eastern External Market before committing capital.",
      complete: inspectionCount === REQUIRED_INSPECTION_COUNT,
      progressLabel: `${inspectionCount} of ${REQUIRED_INSPECTION_COUNT} sites inspected`,
    }),
    Object.freeze({
      id: "activate-supply-chain" as const,
      title: "Activate both supply-chain legs",
      guidance: "Connect quarry to stoneworks and stoneworks to market by any viable road or rail service.",
      complete: state.supplyChainActivated,
      progressLabel: state.supplyChainActivated
        ? "Inbound and outbound freight served"
        : "One or both freight legs remain dormant",
    }),
    Object.freeze({
      id: "observe-pressure" as const,
      title: "Observe and diagnose the pressure",
      guidance: "Advance time, watch private freight and growth, then inspect the overloaded old bridge.",
      complete: state.bridgeOverloadObserved,
      progressLabel: state.bridgeOverloadObserved
        ? "Old bridge overload observed"
        : "Waiting for successful freight to create pressure",
    }),
    Object.freeze({
      id: "intervene" as const,
      title: "Make a second strategic intervention",
      guidance: "Relieve the old bridge or shift its freight using an upgrade, bypass, or rail corridor.",
      complete: state.interventionCompleted,
      progressLabel: state.interventionCompleted
        ? "Freight pressure shifted or relieved"
        : "Bridge pressure still needs a strategic response",
    }),
    Object.freeze({
      id: "stabilize" as const,
      title: "Stabilize the valley",
      guidance: "Hold served freight, completed growth, bridge relief, and maintainable finances for three days.",
      complete: state.ending !== null,
      progressLabel: `${state.successfulDays} of ${REQUIRED_SUCCESSFUL_DAYS} consecutive days`,
    }),
  ]);
  return Object.freeze({
    objectives,
    activeObjectiveId: objectives.find(({ complete }) => !complete)?.id ?? null,
    inspectedEntityIds: state.inspectedEntityIds,
    successfulDays: state.successfulDays,
    requiredSuccessfulDays: REQUIRED_SUCCESSFUL_DAYS,
    successConditions: conditions,
    success: state.ending !== null,
    ending: state.ending,
  });
}
