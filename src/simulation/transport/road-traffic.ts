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

export interface RoadTrafficStateSnapshot {
  readonly lastAssignmentTick: number;
  readonly nextAssignmentTick: number;
  readonly assignedFlowUnitsPerDay: number;
  readonly routeNodeIds: readonly string[] | null;
  readonly routeLinkIds: readonly string[] | null;
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

function assignedFlow(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("road traffic demand must be non-negative and finite");
  }
  return value;
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

function assignAtTick(
  network: RoadNetwork,
  tick: number,
  start: Point,
  end: Point,
  demandInput: number,
): RoadTrafficUpdate {
  safeTick(tick, "traffic assignment tick");
  const demand = assignedFlow(demandInput);
  if (!Number.isSafeInteger(tick + TRAFFIC_ASSIGNMENT_INTERVAL_TICKS)) {
    throw new RangeError(
      "next traffic assignment tick exceeds the safe integer range",
    );
  }
  const route = findRoadRoute(network, start, end);
  const flow = route ? demand : 0;
  const flowByLinkId = new Map(
    route?.linkIds.map((linkId) => [linkId, flow] as const) ?? [],
  );
  const assignedNetwork = applyRoadLinkFlows(network, flowByLinkId);

  return Object.freeze({
    network: assignedNetwork,
    state: Object.freeze({
      lastAssignmentTick: tick,
      nextAssignmentTick: tick + TRAFFIC_ASSIGNMENT_INTERVAL_TICKS,
      assignedFlowUnitsPerDay: flow,
      routeNodeIds: route ? Object.freeze([...route.nodeIds]) : null,
      routeLinkIds: route ? Object.freeze([...route.linkIds]) : null,
    }),
  });
}

export function createRoadTraffic(
  network: RoadNetwork,
  tick: number,
  start: Point,
  end: Point,
  demand: number,
): RoadTrafficUpdate {
  return assignAtTick(network, tick, start, end, demand);
}

export function advanceRoadTraffic(
  network: RoadNetwork,
  state: RoadTrafficStateSnapshot,
  targetTick: number,
  start: Point,
  end: Point,
  demand: number,
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
      start,
      end,
      demand,
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
  start: Point,
  end: Point,
  demandInput: number,
): RoadTrafficUpdate {
  safeTick(simulationTick, "simulation tick");
  safeTick(state.lastAssignmentTick, "last traffic assignment tick");
  safeTick(state.nextAssignmentTick, "next traffic assignment tick");
  const demand = assignedFlow(demandInput);
  if (
    state.lastAssignmentTick > simulationTick ||
    state.nextAssignmentTick <= simulationTick ||
    state.nextAssignmentTick - state.lastAssignmentTick !==
      TRAFFIC_ASSIGNMENT_INTERVAL_TICKS
  ) {
    throw new RangeError("saved traffic assignment cadence is inconsistent");
  }

  const hasRoute = state.routeNodeIds !== null || state.routeLinkIds !== null;
  if (
    (state.routeNodeIds === null) !== (state.routeLinkIds === null) ||
    !Number.isFinite(state.assignedFlowUnitsPerDay) ||
    state.assignedFlowUnitsPerDay < 0
  ) {
    throw new RangeError("saved road traffic route is inconsistent");
  }
  if (!hasRoute) {
    if (
      state.assignedFlowUnitsPerDay !== 0 ||
      findRoadRoute(network, start, end)
    ) {
      throw new RangeError(
        "saved road traffic without a route does not match its network",
      );
    }
    return Object.freeze({
      network: applyRoadLinkFlows(network, new Map()),
      state: Object.freeze({ ...state, routeNodeIds: null, routeLinkIds: null }),
    });
  }

  const route = createRoadRouteFromIds(
    network,
    state.routeNodeIds ?? [],
    state.routeLinkIds ?? [],
  );
  if (
    !route ||
    !routeEndpointsMatch(network, route, start, end) ||
    state.assignedFlowUnitsPerDay !== demand
  ) {
    throw new RangeError("saved road traffic route does not match its demand");
  }
  const flowByLinkId = new Map(
    route.linkIds.map(
      (linkId) => [linkId, state.assignedFlowUnitsPerDay] as const,
    ),
  );
  return Object.freeze({
    network: applyRoadLinkFlows(network, flowByLinkId),
    state: Object.freeze({
      ...state,
      routeNodeIds: Object.freeze([...route.nodeIds]),
      routeLinkIds: Object.freeze([...route.linkIds]),
    }),
  });
}

export function assignedRoadTrafficRoute(
  network: RoadNetwork,
  state: RoadTrafficStateSnapshot,
): RoadRoute | undefined {
  if (state.routeNodeIds === null || state.routeLinkIds === null) {
    return undefined;
  }
  return createRoadRouteFromIds(
    network,
    state.routeNodeIds,
    state.routeLinkIds,
  );
}
