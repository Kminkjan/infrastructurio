import {
  TICKS_PER_DAY,
  type Point,
  type RoadClass,
  type RoadNetwork,
  type RoadRoute,
  type RoadSegment,
  type ScenarioGeography,
  type SimulationCommand,
  type SimulationSnapshot,
} from "../shared";
import { generateMillfordValley } from "../scenarios";
import {
  advanceStoneSupplyChainDay,
  createStoneSupplyChainSnapshot,
  createStoneSupplyChainState,
  markStoneSupplyChainProcessed,
  validateStoneSupplyChainState,
  type StoneSupplyChainStateSnapshot,
} from "./economy/stone-supply-chain";
import { createAccessibilityScorer } from "./growth/accessibility";
import {
  advanceDevelopment,
  createDevelopmentSnapshot,
  createDevelopmentState,
  updateDevelopmentAccess,
  validateDevelopmentState,
  type DevelopmentModel,
  type DevelopmentStateSnapshot,
} from "./growth/development";
import { createMillfordAccessibilityModel } from "./growth/millford-accessibility";
import { createMillfordDevelopmentModel } from "./growth/millford-development";
import { createRoadNetwork, findRoadRoute } from "./transport/road-network";
import { createBottleneckAnalysis } from "./transport/bottlenecks";
import {
  advanceRoadTraffic,
  assignedRoadTrafficRoute,
  createRoadTraffic,
  restoreRoadTraffic,
  type RoadTrafficDemand,
  type RoadTrafficStateSnapshot,
} from "./transport/road-traffic";

const DEFAULT_PLAYER_ROAD_CLASS: RoadClass = "arterial";
export const INBOUND_TRAFFIC_FLOW_ID = "stone-supply-inbound";
export const OUTBOUND_TRAFFIC_FLOW_ID = "stone-supply-outbound";

interface SimulationState {
  readonly seed: string;
  readonly tick: number;
  readonly geography: ScenarioGeography;
  readonly roadNetwork: RoadNetwork;
  readonly roadTraffic: RoadTrafficStateSnapshot;
  readonly nextRoadSegmentNumber: number;
  readonly supplyChain: StoneSupplyChainStateSnapshot;
  readonly development: DevelopmentStateSnapshot;
}

export interface SimulationStateSnapshot {
  readonly seed: string;
  readonly tick: number;
  readonly roadSegments: readonly RoadSegment[];
  readonly nextRoadSegmentNumber: number;
  readonly roadTraffic?: RoadTrafficStateSnapshot;
  readonly supplyChain?: StoneSupplyChainStateSnapshot;
  readonly development?: DevelopmentStateSnapshot;
}

export interface Simulation {
  dispatch(command: SimulationCommand): SimulationSnapshot;
  getSnapshot(): SimulationSnapshot;
  getState(): SimulationStateSnapshot;
  findRoute(start: Point, end: Point): RoadRoute | undefined;
}

function trafficDemands(
  geography: ScenarioGeography,
  supplyChain: StoneSupplyChainStateSnapshot,
): readonly RoadTrafficDemand[] {
  return Object.freeze([
    Object.freeze({
      id: INBOUND_TRAFFIC_FLOW_ID,
      start: geography.quarry.position,
      end: geography.stoneworks.position,
      assignedFlowUnitsPerDay: supplyChain.inboundShippedTonsPerDay,
    }),
    Object.freeze({
      id: OUTBOUND_TRAFFIC_FLOW_ID,
      start: geography.stoneworks.position,
      end: geography.externalMarketConnection.position,
      assignedFlowUnitsPerDay: supplyChain.outboundShippedTonsPerDay,
    }),
  ]);
}

function supplyRoutes(state: SimulationState): {
  readonly inbound: RoadRoute | undefined;
  readonly outbound: RoadRoute | undefined;
} {
  return {
    inbound:
      assignedRoadTrafficRoute(
        state.roadNetwork,
        state.roadTraffic,
        INBOUND_TRAFFIC_FLOW_ID,
      ) ??
      findRoadRoute(
        state.roadNetwork,
        state.geography.quarry.position,
        state.geography.stoneworks.position,
      ),
    outbound:
      assignedRoadTrafficRoute(
        state.roadNetwork,
        state.roadTraffic,
        OUTBOUND_TRAFFIC_FLOW_ID,
      ) ??
      findRoadRoute(
        state.roadNetwork,
        state.geography.stoneworks.position,
        state.geography.externalMarketConnection.position,
      ),
  };
}

function snapshot(
  state: SimulationState,
  accessibility: ReturnType<typeof createAccessibilityScorer>,
  developmentModel: DevelopmentModel,
): SimulationSnapshot {
  const routes = supplyRoutes(state);
  const accessibilitySnapshot = accessibility.getSnapshot();
  const stoneSupplyChain = createStoneSupplyChainSnapshot(
    state.geography,
    state.supplyChain,
    routes.inbound,
    routes.outbound,
  );
  return Object.freeze({
    seed: state.seed,
    tick: state.tick,
    elapsedDays: state.tick / TICKS_PER_DAY,
    geography: state.geography,
    roadNetwork: state.roadNetwork,
    stoneSupplyChain,
    bottlenecks: createBottleneckAnalysis(
      state.geography,
      state.roadNetwork,
      state.roadTraffic,
      stoneSupplyChain,
    ),
    accessibility: accessibilitySnapshot,
    development: createDevelopmentSnapshot(
      state.development,
      developmentModel,
      accessibilitySnapshot,
    ),
  });
}

function upgradeRoad(
  state: SimulationState,
  roadSegmentId: string,
): SimulationState {
  const existing = state.roadNetwork.segments.find(
    ({ id }) => id === roadSegmentId,
  );
  if (!existing) {
    throw new RangeError(`road segment ${roadSegmentId} does not exist`);
  }
  if (existing.roadClass === "highway") {
    return state;
  }
  return {
    ...state,
    roadNetwork: createRoadNetwork(
      state.roadNetwork.segments.map((segment) =>
        segment.id === roadSegmentId
          ? Object.freeze({ ...segment, roadClass: "highway" as const })
          : segment,
      ),
    ),
  };
}

function advanceTarget(state: SimulationState, ticks: number): number {
  if (!Number.isSafeInteger(ticks) || ticks < 0) {
    throw new RangeError("advance ticks must be a non-negative safe integer");
  }
  const tick = state.tick + ticks;
  if (!Number.isSafeInteger(tick)) {
    throw new RangeError("simulation tick exceeds the safe integer range");
  }
  return tick;
}

function normalizeCoordinate(value: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError("road coordinates must be finite numbers");
  }
  return Math.round(Math.min(maximum, Math.max(0, value)) * 1_000) / 1_000;
}

function normalizePoint(position: Point, geography: ScenarioGeography): Point {
  return Object.freeze({
    x: normalizeCoordinate(position.x, geography.bounds.width),
    y: normalizeCoordinate(position.y, geography.bounds.height),
  });
}

function buildRoad(
  state: SimulationState,
  startInput: Point,
  endInput: Point,
  roadClass: RoadClass = DEFAULT_PLAYER_ROAD_CLASS,
): SimulationState {
  const start = normalizePoint(startInput, state.geography);
  const end = normalizePoint(endInput, state.geography);
  if (start.x === end.x && start.y === end.y) {
    throw new RangeError("a road segment must have two distinct endpoints");
  }
  const segment: RoadSegment = Object.freeze({
    id: `road-segment-${state.nextRoadSegmentNumber}`,
    roadClass,
    start,
    end,
  });
  return {
    ...state,
    roadNetwork: createRoadNetwork([...state.roadNetwork.segments, segment]),
    nextRoadSegmentNumber: state.nextRoadSegmentNumber + 1,
  };
}

function removeRoad(
  state: SimulationState,
  roadSegmentId: string,
): SimulationState {
  const segments = state.roadNetwork.segments.filter(
    ({ id }) => id !== roadSegmentId,
  );
  return segments.length === state.roadNetwork.segments.length
    ? state
    : { ...state, roadNetwork: createRoadNetwork(segments) };
}

function createSimulationState(
  seed: string,
  tick: number,
  roadSegments: readonly RoadSegment[],
  nextRoadSegmentNumber: number,
  savedDevelopment?: DevelopmentStateSnapshot,
  savedSupplyChain?: StoneSupplyChainStateSnapshot,
  savedRoadTraffic?: RoadTrafficStateSnapshot,
): SimulationState {
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError("simulation tick must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(nextRoadSegmentNumber) || nextRoadSegmentNumber < 1) {
    throw new RangeError("next road segment number must be a positive safe integer");
  }
  const geography = generateMillfordValley(seed);
  for (const segment of roadSegments) {
    for (const position of [segment.start, segment.end]) {
      if (
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        position.x < 0 ||
        position.x > geography.bounds.width ||
        position.y < 0 ||
        position.y > geography.bounds.height
      ) {
        throw new RangeError("saved road coordinates must be within map bounds");
      }
    }
  }
  const baseRoadNetwork = createRoadNetwork(roadSegments);
  if (
    baseRoadNetwork.segments.some(
      ({ id }) => id === `road-segment-${nextRoadSegmentNumber}`,
    )
  ) {
    throw new RangeError("next road segment id must be unused");
  }

  const developmentModel = createMillfordDevelopmentModel(geography);
  const development = savedDevelopment
    ? validateDevelopmentState(developmentModel, savedDevelopment)
    : createDevelopmentState(developmentModel, tick);
  if (development.processedTick !== tick) {
    throw new RangeError("development state must match the simulation tick");
  }
  const supplyChain = savedSupplyChain
    ? validateStoneSupplyChainState(savedSupplyChain, tick)
    : createStoneSupplyChainState(tick);
  const demands = trafficDemands(geography, supplyChain);
  const traffic = savedRoadTraffic
    ? restoreRoadTraffic(baseRoadNetwork, savedRoadTraffic, tick, demands)
    : createRoadTraffic(baseRoadNetwork, tick, demands);

  return Object.freeze({
    seed,
    tick,
    geography,
    roadNetwork: traffic.network,
    roadTraffic: traffic.state,
    nextRoadSegmentNumber,
    supplyChain,
    development,
  });
}

function runSimulation(initialState: SimulationState): Simulation {
  const stateSnapshot = (state: SimulationState): SimulationStateSnapshot =>
    Object.freeze({
      seed: state.seed,
      tick: state.tick,
      roadSegments: state.roadNetwork.segments,
      nextRoadSegmentNumber: state.nextRoadSegmentNumber,
      roadTraffic: state.roadTraffic,
      supplyChain: state.supplyChain,
      development: state.development,
    });

  let state = initialState;
  let accessibility = createAccessibilityScorer(
    createMillfordAccessibilityModel(
      initialState.geography,
      createStoneSupplyChainSnapshot(
        initialState.geography,
        initialState.supplyChain,
        undefined,
        undefined,
      ).stoneworks.laborOpportunity,
    ),
    initialState.roadNetwork,
  );
  const developmentModel = createMillfordDevelopmentModel(initialState.geography);

  function updateAccessibility(network: RoadNetwork, forceModel = false): void {
    if (forceModel) {
      const routes = supplyRoutes({ ...state, roadNetwork: network });
      const labor = createStoneSupplyChainSnapshot(
        state.geography,
        state.supplyChain,
        routes.inbound,
        routes.outbound,
      ).stoneworks.laborOpportunity;
      accessibility = createAccessibilityScorer(
        createMillfordAccessibilityModel(state.geography, labor),
        network,
      );
    } else {
      accessibility.updateNetwork(network);
    }
  }

  return {
    dispatch(command) {
      const previousRoadNetwork = state.roadNetwork;
      switch (command.type) {
        case "advance": {
          const targetTick = advanceTarget(state, command.ticks);
          let network = state.roadNetwork;
          let trafficState = state.roadTraffic;
          let supplyChain = state.supplyChain;
          let activityChanged = false;

          while (supplyChain.nextUpdateTick <= targetTick) {
            const updateTick = supplyChain.nextUpdateTick;
            const beforeBoundary = advanceRoadTraffic(
              network,
              trafficState,
              updateTick - 1,
              trafficDemands(state.geography, supplyChain),
            );
            network = beforeBoundary.network;
            trafficState = beforeBoundary.state;
            const previousProcessing = supplyChain.processedTonsPerDay;
            supplyChain = advanceStoneSupplyChainDay(
              supplyChain,
              updateTick,
              findRoadRoute(
                network,
                state.geography.quarry.position,
                state.geography.stoneworks.position,
              ),
              findRoadRoute(
                network,
                state.geography.stoneworks.position,
                state.geography.externalMarketConnection.position,
              ),
            );
            activityChanged ||=
              previousProcessing !== supplyChain.processedTonsPerDay;
            const atBoundary = createRoadTraffic(
              network,
              updateTick,
              trafficDemands(state.geography, supplyChain),
            );
            network = atBoundary.network;
            trafficState = atBoundary.state;
          }

          const traffic = advanceRoadTraffic(
            network,
            trafficState,
            targetTick,
            trafficDemands(state.geography, supplyChain),
          );
          supplyChain = markStoneSupplyChainProcessed(supplyChain, targetTick);
          state = {
            ...state,
            tick: targetTick,
            roadNetwork: traffic.network,
            roadTraffic: traffic.state,
            supplyChain,
          };
          updateAccessibility(state.roadNetwork, activityChanged);
          state = {
            ...state,
            development: advanceDevelopment(
              state.development,
              developmentModel,
              accessibility.getSnapshot(),
              state.seed,
              targetTick,
            ),
          };
          break;
        }
        case "reset":
          state = initialState;
          accessibility = createAccessibilityScorer(
            createMillfordAccessibilityModel(initialState.geography, 0),
            initialState.roadNetwork,
          );
          break;
        case "build-road":
          state = buildRoad(state, command.start, command.end, command.roadClass);
          break;
        case "upgrade-road":
          state = upgradeRoad(state, command.roadSegmentId);
          break;
        case "remove-road":
          state = removeRoad(state, command.roadSegmentId);
          break;
      }

      if (
        state.roadNetwork !== previousRoadNetwork &&
        command.type !== "reset" &&
        command.type !== "advance"
      ) {
        const traffic = createRoadTraffic(
          state.roadNetwork,
          state.tick,
          trafficDemands(state.geography, state.supplyChain),
        );
        state = {
          ...state,
          roadNetwork: traffic.network,
          roadTraffic: traffic.state,
        };
        updateAccessibility(state.roadNetwork);
        state = {
          ...state,
          development: updateDevelopmentAccess(
            state.development,
            developmentModel,
            accessibility.getSnapshot(),
          ),
        };
      }
      return snapshot(state, accessibility, developmentModel);
    },
    getSnapshot() {
      return snapshot(state, accessibility, developmentModel);
    },
    getState() {
      return stateSnapshot(state);
    },
    findRoute(start, end) {
      return findRoadRoute(
        state.roadNetwork,
        normalizePoint(start, state.geography),
        normalizePoint(end, state.geography),
      );
    },
  };
}

export function createSimulation(seed: string): Simulation {
  return runSimulation(createSimulationState(seed, 0, [], 1));
}

export function restoreSimulation(
  savedState: SimulationStateSnapshot,
): Simulation {
  return runSimulation(
    createSimulationState(
      savedState.seed,
      savedState.tick,
      savedState.roadSegments,
      savedState.nextRoadSegmentNumber,
      savedState.development,
      savedState.supplyChain,
      savedState.roadTraffic,
    ),
  );
}
