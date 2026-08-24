import {
  TICKS_PER_DAY,
  type Point,
  type RoadNetwork,
  type RoadRoute,
} from "../../shared";
import {
  applyRoadLinkFlows,
  createRoadRouteFromIds,
  findRoadRoute,
} from "./road-network";

export const TRAFFIC_ASSIGNMENT_INTERVAL_TICKS = TICKS_PER_DAY / 3;

export interface RoadTrafficDemand {
  readonly id: string;
  readonly start: Point;
  readonly end: Point;
  readonly assignedFlowUnitsPerDay: number;
}

export interface RoadTrafficFlowStateSnapshot {
  readonly id: string;
  readonly assignedFlowUnitsPerDay: number;
  readonly routeNodeIds: readonly string[] | null;
  readonly routeLinkIds: readonly string[] | null;
}

export interface RoadTrafficStateSnapshot {
  readonly lastAssignmentTick: number;
  readonly nextAssignmentTick: number;
  readonly flows: readonly RoadTrafficFlowStateSnapshot[];
}

export interface RoadTrafficUpdate {
  readonly network: RoadNetwork;
  readonly state: RoadTrafficStateSnapshot;
}

function safeTick(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function validateDemands(
  demands: readonly RoadTrafficDemand[],
): readonly RoadTrafficDemand[] {
  const ids = new Set<string>();
  for (const demand of demands) {
    if (demand.id.length === 0 || ids.has(demand.id)) {
      throw new RangeError("road traffic demand ids must be non-empty and unique");
    }
    if (
      !Number.isFinite(demand.assignedFlowUnitsPerDay) ||
      demand.assignedFlowUnitsPerDay < 0
    ) {
      throw new RangeError("road traffic demand must be non-negative and finite");
    }
    ids.add(demand.id);
  }
  return demands;
}

function samePoint(first: Point, second: Point): boolean {
  return (
    Math.abs(first.x - second.x) <= 1e-7 &&
    Math.abs(first.y - second.y) <= 1e-7
  );
}

function routeEndpointsMatch(
  network: RoadNetwork,
  route: RoadRoute,
  start: Point,
  end: Point,
): boolean {
  const first = network.nodes.find(({ id }) => id === route.nodeIds[0]);
  const last = network.nodes.find(
    ({ id }) => id === route.nodeIds[route.nodeIds.length - 1],
  );
  return Boolean(
    first &&
      last &&
      samePoint(first.position, start) &&
      samePoint(last.position, end),
  );
}

function flowMap(
  flows: readonly RoadTrafficFlowStateSnapshot[],
): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const flow of flows) {
    for (const linkId of flow.routeLinkIds ?? []) {
      totals.set(
        linkId,
        (totals.get(linkId) ?? 0) + flow.assignedFlowUnitsPerDay,
      );
    }
  }
  return totals;
}

function assignAtTick(
  network: RoadNetwork,
  tick: number,
  demandsInput: readonly RoadTrafficDemand[],
): RoadTrafficUpdate {
  safeTick(tick, "traffic assignment tick");
  const demands = validateDemands(demandsInput);
  if (!Number.isSafeInteger(tick + TRAFFIC_ASSIGNMENT_INTERVAL_TICKS)) {
    throw new RangeError(
      "next traffic assignment tick exceeds the safe integer range",
    );
  }
  const flows = Object.freeze(
    demands.map((demand) => {
      const route = findRoadRoute(network, demand.start, demand.end);
      return Object.freeze({
        id: demand.id,
        assignedFlowUnitsPerDay: route
          ? demand.assignedFlowUnitsPerDay
          : 0,
        routeNodeIds: route ? Object.freeze([...route.nodeIds]) : null,
        routeLinkIds: route ? Object.freeze([...route.linkIds]) : null,
      });
    }),
  );
  return Object.freeze({
    network: applyRoadLinkFlows(network, flowMap(flows)),
    state: Object.freeze({
      lastAssignmentTick: tick,
      nextAssignmentTick: tick + TRAFFIC_ASSIGNMENT_INTERVAL_TICKS,
      flows,
    }),
  });
}

export function createRoadTraffic(
  network: RoadNetwork,
  tick: number,
  demands: readonly RoadTrafficDemand[],
): RoadTrafficUpdate {
  return assignAtTick(network, tick, demands);
}

export function advanceRoadTraffic(
  network: RoadNetwork,
  state: RoadTrafficStateSnapshot,
  targetTick: number,
  demands: readonly RoadTrafficDemand[],
): RoadTrafficUpdate {
  safeTick(targetTick, "traffic target tick");
  if (targetTick < state.lastAssignmentTick) {
    throw new RangeError(
      "traffic target tick cannot precede its assignment state",
    );
  }

  let currentNetwork = network;
  let currentState = state;
  while (currentState.nextAssignmentTick <= targetTick) {
    const update = assignAtTick(
      currentNetwork,
      currentState.nextAssignmentTick,
      demands,
    );
    currentNetwork = update.network;
    currentState = update.state;
  }
  return Object.freeze({ network: currentNetwork, state: currentState });
}

export function restoreRoadTraffic(
  network: RoadNetwork,
  state: RoadTrafficStateSnapshot,
  simulationTick: number,
  demandsInput: readonly RoadTrafficDemand[],
): RoadTrafficUpdate {
  safeTick(simulationTick, "simulation tick");
  safeTick(state.lastAssignmentTick, "last traffic assignment tick");
  safeTick(state.nextAssignmentTick, "next traffic assignment tick");
  const demands = validateDemands(demandsInput);
  if (
    state.lastAssignmentTick > simulationTick ||
    state.nextAssignmentTick <= simulationTick ||
    state.nextAssignmentTick - state.lastAssignmentTick !==
      TRAFFIC_ASSIGNMENT_INTERVAL_TICKS ||
    state.flows.length !== demands.length
  ) {
    throw new RangeError("saved traffic assignment cadence is inconsistent");
  }

  const restoredFlows = demands.map((demand) => {
    const saved = state.flows.find(({ id }) => id === demand.id);
    if (
      !saved ||
      saved.assignedFlowUnitsPerDay !== demand.assignedFlowUnitsPerDay ||
      (saved.routeNodeIds === null) !== (saved.routeLinkIds === null)
    ) {
      throw new RangeError("saved road traffic flow does not match its demand");
    }
    if (saved.routeNodeIds === null || saved.routeLinkIds === null) {
      if (findRoadRoute(network, demand.start, demand.end)) {
        throw new RangeError("saved road traffic route does not match its network");
      }
      return Object.freeze({ ...saved, routeNodeIds: null, routeLinkIds: null });
    }
    const route = createRoadRouteFromIds(
      network,
      saved.routeNodeIds,
      saved.routeLinkIds,
    );
    if (!route || !routeEndpointsMatch(network, route, demand.start, demand.end)) {
      throw new RangeError("saved road traffic route does not match its demand");
    }
    return Object.freeze({
      ...saved,
      routeNodeIds: Object.freeze([...route.nodeIds]),
      routeLinkIds: Object.freeze([...route.linkIds]),
    });
  });

  return Object.freeze({
    network: applyRoadLinkFlows(network, flowMap(restoredFlows)),
    state: Object.freeze({
      ...state,
      flows: Object.freeze(restoredFlows),
    }),
  });
}

export function assignedRoadTrafficRoute(
  network: RoadNetwork,
  state: RoadTrafficStateSnapshot,
  flowId: string,
): RoadRoute | undefined {
  const flow = state.flows.find(({ id }) => id === flowId);
  if (!flow || flow.routeNodeIds === null || flow.routeLinkIds === null) {
    return undefined;
  }
  return createRoadRouteFromIds(
    network,
    flow.routeNodeIds,
    flow.routeLinkIds,
  );
}
