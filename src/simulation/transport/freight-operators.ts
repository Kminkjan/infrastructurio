import type {
  FreightMode,
  FreightRoute,
  FreightServiceCandidateSnapshot,
  Point,
  RailNetwork,
  RoadNetwork,
} from "../../shared";
import { TICKS_PER_DAY } from "../../shared";
import {
  applyRoadLinkFlows,
  createRoadRouteFromIds,
  findRoadRoute,
} from "./road-network";
import {
  applyRailFlows,
  createRailRouteFromIds,
  findRailRoute,
} from "./rail-network";

export const FREIGHT_ASSIGNMENT_INTERVAL_TICKS = TICKS_PER_DAY / 3;

export interface FreightServicePricingState {
  readonly roadAdjustmentHours: number;
  readonly railAdjustmentHours: number;
}

export interface FreightOperatorDemand {
  readonly id: string;
  readonly start: Point;
  readonly end: Point;
  readonly originRailTerminalId: string;
  readonly destinationRailTerminalId: string;
  readonly demandTonsPerDay: number;
}

export interface FreightOperatorCandidateState {
  readonly mode: FreightMode;
  readonly nodeIds: readonly string[] | null;
  readonly linkIds: readonly string[] | null;
  readonly originRailTerminalId: string | null;
  readonly destinationRailTerminalId: string | null;
  readonly generalizedCostHours: number | null;
  readonly capacityTonsPerDay: number;
  readonly freeFlowTravelTimeHours: number | null;
  readonly congestionDelayHours: number;
  readonly terminalHandlingTimeHours: number;
  readonly accessEgressTimeHours: number;
  readonly priceAdjustmentHours: number;
}

export interface FreightOperatorFlowStateSnapshot {
  readonly id: string;
  readonly demandTonsPerDay: number;
  readonly assignedTonsPerDay: number;
  readonly chosenMode: FreightMode | null;
  readonly candidates: readonly FreightOperatorCandidateState[];
}

export interface FreightOperatorStateSnapshot {
  readonly lastAssignmentTick: number;
  readonly nextAssignmentTick: number;
  readonly pricing: FreightServicePricingState;
  readonly flows: readonly FreightOperatorFlowStateSnapshot[];
}

export interface FreightOperatorUpdate {
  readonly roadNetwork: RoadNetwork;
  readonly railNetwork: RailNetwork;
  readonly state: FreightOperatorStateSnapshot;
}

function validateTick(tick: number): void {
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError("freight assignment tick must be a non-negative safe integer");
  }
}

export function createFreightServicePricingState(): FreightServicePricingState {
  return Object.freeze({ roadAdjustmentHours: 0, railAdjustmentHours: 0 });
}

export function setFreightServicePrice(
  pricing: FreightServicePricingState,
  mode: FreightMode,
  adjustmentHours: number,
): FreightServicePricingState {
  if (!Number.isFinite(adjustmentHours) || adjustmentHours < 0) {
    throw new RangeError("freight service price adjustment must be non-negative and finite");
  }
  return Object.freeze({
    ...pricing,
    [mode === "road" ? "roadAdjustmentHours" : "railAdjustmentHours"]:
      adjustmentHours,
  });
}

function roadCapacity(network: RoadNetwork, linkIds: readonly string[]): number {
  return Math.min(
    ...linkIds.map((id) =>
      network.links.find((link) => link.id === id)!.capacityUnitsPerDay,
    ),
  );
}

function candidatesFor(
  roadNetwork: RoadNetwork,
  railNetwork: RailNetwork,
  demand: FreightOperatorDemand,
  pricing: FreightServicePricingState,
): readonly FreightOperatorCandidateState[] {
  const road = findRoadRoute(roadNetwork, demand.start, demand.end);
  const rail = findRailRoute(
    railNetwork,
    demand.originRailTerminalId,
    demand.destinationRailTerminalId,
  );
  return Object.freeze([
    Object.freeze({
      mode: "road" as const,
      nodeIds: road ? Object.freeze([...road.nodeIds]) : null,
      linkIds: road ? Object.freeze([...road.linkIds]) : null,
      originRailTerminalId: null,
      destinationRailTerminalId: null,
      generalizedCostHours: road
        ? road.generalizedCostHours + pricing.roadAdjustmentHours
        : null,
      capacityTonsPerDay: road ? roadCapacity(roadNetwork, road.linkIds) : 0,
      freeFlowTravelTimeHours: road?.freeFlowTravelTimeHours ?? null,
      congestionDelayHours: road?.congestionDelayHours ?? 0,
      terminalHandlingTimeHours: 0,
      accessEgressTimeHours: 0,
      priceAdjustmentHours: pricing.roadAdjustmentHours,
    }),
    Object.freeze({
      mode: "rail" as const,
      nodeIds: rail ? Object.freeze([...rail.nodeIds]) : null,
      linkIds: rail ? Object.freeze([...rail.linkIds]) : null,
      originRailTerminalId: rail?.originTerminalId ?? null,
      destinationRailTerminalId: rail?.destinationTerminalId ?? null,
      generalizedCostHours: rail
        ? rail.generalizedCostHours + pricing.railAdjustmentHours
        : null,
      capacityTonsPerDay: rail?.capacityTonsPerDay ?? 0,
      freeFlowTravelTimeHours: rail?.freeFlowTravelTimeHours ?? null,
      congestionDelayHours: rail?.congestionDelayHours ?? 0,
      terminalHandlingTimeHours: rail?.terminalTransferTimeHours ?? 0,
      // M3 terminals are anchored at their industry/market sites.
      accessEgressTimeHours: 0,
      priceAdjustmentHours: pricing.railAdjustmentHours,
    }),
  ]);
}

function chosenCandidate(
  candidates: readonly FreightOperatorCandidateState[],
): FreightOperatorCandidateState | undefined {
  return candidates
    .filter((candidate) => candidate.generalizedCostHours !== null)
    .sort((first, second) =>
      first.generalizedCostHours! - second.generalizedCostHours! ||
      first.mode.localeCompare(second.mode),
    )[0];
}

function applyFlows(
  roadNetwork: RoadNetwork,
  railNetwork: RailNetwork,
  flows: readonly FreightOperatorFlowStateSnapshot[],
): Pick<FreightOperatorUpdate, "roadNetwork" | "railNetwork"> {
  const roadFlows = new Map<string, number>();
  const railFlows = new Map<string, number>();
  const terminalHandling = new Map<string, number>();
  for (const flow of flows) {
    const chosen = flow.candidates.find(({ mode }) => mode === flow.chosenMode);
    if (!chosen) continue;
    const linkFlows = chosen.mode === "road" ? roadFlows : railFlows;
    for (const linkId of chosen.linkIds ?? []) {
      linkFlows.set(linkId, (linkFlows.get(linkId) ?? 0) + flow.assignedTonsPerDay);
    }
    if (chosen.mode === "rail") {
      for (const terminalId of [
        chosen.originRailTerminalId,
        chosen.destinationRailTerminalId,
      ]) {
        if (terminalId) {
          terminalHandling.set(
            terminalId,
            (terminalHandling.get(terminalId) ?? 0) + flow.assignedTonsPerDay,
          );
        }
      }
    }
  }
  return {
    roadNetwork: applyRoadLinkFlows(roadNetwork, roadFlows),
    railNetwork: applyRailFlows(railNetwork, railFlows, terminalHandling),
  };
}

function assignAtTick(
  roadNetwork: RoadNetwork,
  railNetwork: RailNetwork,
  tick: number,
  demands: readonly FreightOperatorDemand[],
  pricing: FreightServicePricingState,
): FreightOperatorUpdate {
  validateTick(tick);
  const ids = new Set<string>();
  const flows = Object.freeze(demands.map((demand) => {
    if (ids.has(demand.id) || !Number.isFinite(demand.demandTonsPerDay) ||
        demand.demandTonsPerDay < 0) {
      throw new RangeError("freight demands require unique ids and non-negative volume");
    }
    ids.add(demand.id);
    const candidates = candidatesFor(roadNetwork, railNetwork, demand, pricing);
    const chosen = chosenCandidate(candidates);
    return Object.freeze({
      id: demand.id,
      demandTonsPerDay: demand.demandTonsPerDay,
      assignedTonsPerDay: chosen ? demand.demandTonsPerDay : 0,
      chosenMode: chosen?.mode ?? null,
      candidates,
    });
  }));
  const networks = applyFlows(roadNetwork, railNetwork, flows);
  return Object.freeze({
    ...networks,
    state: Object.freeze({
      lastAssignmentTick: tick,
      nextAssignmentTick: tick + FREIGHT_ASSIGNMENT_INTERVAL_TICKS,
      pricing,
      flows,
    }),
  });
}

export function createFreightOperators(
  roadNetwork: RoadNetwork,
  railNetwork: RailNetwork,
  tick: number,
  demands: readonly FreightOperatorDemand[],
  pricing = createFreightServicePricingState(),
): FreightOperatorUpdate {
  return assignAtTick(roadNetwork, railNetwork, tick, demands, pricing);
}

export function advanceFreightOperators(
  roadNetwork: RoadNetwork,
  railNetwork: RailNetwork,
  state: FreightOperatorStateSnapshot,
  targetTick: number,
  demands: readonly FreightOperatorDemand[],
): FreightOperatorUpdate {
  validateTick(targetTick);
  let update: FreightOperatorUpdate = { roadNetwork, railNetwork, state };
  while (update.state.nextAssignmentTick <= targetTick) {
    update = assignAtTick(
      update.roadNetwork,
      update.railNetwork,
      update.state.nextAssignmentTick,
      demands,
      update.state.pricing,
    );
  }
  return Object.freeze(update);
}

export function restoreFreightOperators(
  roadNetwork: RoadNetwork,
  railNetwork: RailNetwork,
  state: FreightOperatorStateSnapshot,
  simulationTick: number,
  demands: readonly FreightOperatorDemand[],
): FreightOperatorUpdate {
  validateTick(simulationTick);
  if (state.lastAssignmentTick > simulationTick || state.nextAssignmentTick <= simulationTick ||
      state.nextAssignmentTick - state.lastAssignmentTick !== FREIGHT_ASSIGNMENT_INTERVAL_TICKS) {
    throw new RangeError("saved freight assignment cadence is inconsistent");
  }
  const expectedIds = demands.map(({ id }) => id);
  if (state.flows.map(({ id }) => id).join("|") !== expectedIds.join("|")) {
    throw new RangeError("saved freight assignment flows are inconsistent");
  }
  for (let index = 0; index < state.flows.length; index += 1) {
    const flow = state.flows[index]!;
    const demand = demands[index]!;
    const modes = flow.candidates.map(({ mode }) => mode).sort().join("|");
    if (flow.demandTonsPerDay !== demand.demandTonsPerDay || modes !== "rail|road") {
      throw new RangeError("saved freight assignment demand is inconsistent");
    }
    const chosen = flow.candidates.find(({ mode }) => mode === flow.chosenMode);
    if (flow.assignedTonsPerDay !== (chosen ? flow.demandTonsPerDay : 0)) {
      throw new RangeError("saved freight assigned volume is inconsistent");
    }
    for (const candidate of flow.candidates) {
      if (candidate.generalizedCostHours === null) {
        if (candidate.nodeIds !== null || candidate.linkIds !== null) {
          throw new RangeError("saved unavailable freight service has a route");
        }
        continue;
      }
      const route = candidate.mode === "road"
        ? createRoadRouteFromIds(
            roadNetwork,
            candidate.nodeIds ?? [],
            candidate.linkIds ?? [],
          )
        : createRailRouteFromIds(
            railNetwork,
            candidate.originRailTerminalId ?? "",
            candidate.destinationRailTerminalId ?? "",
            candidate.nodeIds ?? [],
            candidate.linkIds ?? [],
          );
      if (!route) {
        throw new RangeError("saved freight route does not match its network");
      }
    }
  }
  const networks = applyFlows(roadNetwork, railNetwork, state.flows);
  return Object.freeze({ ...networks, state: Object.freeze(state) });
}

export function assignedFreightRoute(
  roadNetwork: RoadNetwork,
  railNetwork: RailNetwork,
  state: FreightOperatorStateSnapshot,
  flowId: string,
): FreightRoute | undefined {
  const flow = state.flows.find(({ id }) => id === flowId);
  const candidate = flow?.candidates.find(({ mode }) => mode === flow.chosenMode);
  if (!candidate || !candidate.nodeIds || !candidate.linkIds) return undefined;
  if (candidate.mode === "road") {
    const route = createRoadRouteFromIds(roadNetwork, candidate.nodeIds, candidate.linkIds);
    return route ? Object.freeze({
      ...route,
      congestionDelayHours: candidate.congestionDelayHours,
      generalizedCostHours: candidate.generalizedCostHours!,
      mode: "road" as const,
    }) : undefined;
  }
  const route = createRailRouteFromIds(
    railNetwork,
    candidate.originRailTerminalId ?? "",
    candidate.destinationRailTerminalId ?? "",
    candidate.nodeIds,
    candidate.linkIds,
  );
  return route ? Object.freeze({
    ...route,
    congestionDelayHours: candidate.congestionDelayHours,
    generalizedCostHours: candidate.generalizedCostHours!,
    mode: "rail" as const,
  }) : undefined;
}

export function freightServiceCandidates(
  roadNetwork: RoadNetwork,
  railNetwork: RailNetwork,
  state: FreightOperatorStateSnapshot,
  flowId: string,
): readonly FreightServiceCandidateSnapshot[] {
  const flow = state.flows.find(({ id }) => id === flowId);
  if (!flow) return Object.freeze([]);
  return Object.freeze(flow.candidates.map((candidate) => {
    const route = candidate.nodeIds && candidate.linkIds
      ? candidate.mode === "road"
        ? createRoadRouteFromIds(roadNetwork, candidate.nodeIds, candidate.linkIds)
        : createRailRouteFromIds(
            railNetwork,
            candidate.originRailTerminalId ?? "",
            candidate.destinationRailTerminalId ?? "",
            candidate.nodeIds,
            candidate.linkIds,
          )
      : undefined;
    const freightRoute = route
      ? Object.freeze({ ...route, mode: candidate.mode } as FreightRoute)
      : null;
    const chosen = flow.chosenMode === candidate.mode;
    const alternative = flow.candidates.find(({ mode }) => mode !== candidate.mode);
    const reason = candidate.generalizedCostHours === null
      ? candidate.mode === "road"
        ? "No connected road route is available."
        : "Both co-located freight terminals and connected track are required."
      : chosen
        ? !alternative || alternative.generalizedCostHours === null
          ? `Chosen as the only viable ${candidate.mode} service.`
          : `Chosen at ${candidate.generalizedCostHours.toFixed(1)} generalized hours, ${(alternative.generalizedCostHours! - candidate.generalizedCostHours).toFixed(1)} hours below ${alternative!.mode}.`
        : `Available at ${candidate.generalizedCostHours.toFixed(1)} generalized hours.`;
    return Object.freeze({
      mode: candidate.mode,
      viable: candidate.generalizedCostHours !== null,
      assignedTonsPerDay: chosen ? flow.assignedTonsPerDay : 0,
      generalizedCostHours: candidate.generalizedCostHours,
      capacityTonsPerDay: candidate.capacityTonsPerDay,
      freeFlowTravelTimeHours: candidate.freeFlowTravelTimeHours,
      congestionDelayHours: candidate.congestionDelayHours,
      terminalHandlingTimeHours: candidate.terminalHandlingTimeHours,
      accessEgressTimeHours: candidate.accessEgressTimeHours,
      priceAdjustmentHours: candidate.priceAdjustmentHours,
      route: freightRoute,
      reason,
    });
  }));
}
