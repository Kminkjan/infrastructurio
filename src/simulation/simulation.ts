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
  createQuarryMarketFreight,
  MARKET_DAILY_DEMAND_TONS,
  QUARRY_DAILY_OUTPUT_TONS,
} from "./economy/quarry-market-freight";
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
  type RoadTrafficStateSnapshot,
} from "./transport/road-traffic";

const DEFAULT_PLAYER_ROAD_CLASS: RoadClass = "arterial";
const QUARRY_MARKET_ASSIGNED_FLOW_UNITS_PER_DAY = Math.min(
  QUARRY_DAILY_OUTPUT_TONS,
  MARKET_DAILY_DEMAND_TONS,
);

interface SimulationState {
  readonly seed: string;
  readonly tick: number;
  readonly geography: ScenarioGeography;
  readonly roadNetwork: RoadNetwork;
  readonly roadTraffic: RoadTrafficStateSnapshot;
  readonly nextRoadSegmentNumber: number;
  readonly development: DevelopmentStateSnapshot;
}

export interface SimulationStateSnapshot {
  readonly seed: string;
  readonly tick: number;
  readonly roadSegments: readonly RoadSegment[];
  readonly nextRoadSegmentNumber: number;
  readonly roadTraffic?: RoadTrafficStateSnapshot;
  readonly development?: DevelopmentStateSnapshot;
}

export interface Simulation {
  dispatch(command: SimulationCommand): SimulationSnapshot;
  getSnapshot(): SimulationSnapshot;
  getState(): SimulationStateSnapshot;
  findRoute(start: Point, end: Point): RoadRoute | undefined;
}

function snapshot(
  state: SimulationState,
  accessibility: ReturnType<typeof createAccessibilityScorer>,
  developmentModel: DevelopmentModel,
): SimulationSnapshot {
  const quarryMarketRoute = assignedRoadTrafficRoute(
    state.roadNetwork,
    state.roadTraffic,
  );

  const accessibilitySnapshot = accessibility.getSnapshot();
  const quarryMarketFreight = createQuarryMarketFreight(
    state.geography,
    quarryMarketRoute,
  );
  return Object.freeze({
    seed: state.seed,
    tick: state.tick,
    elapsedDays: state.tick / TICKS_PER_DAY,
    geography: state.geography,
    roadNetwork: state.roadNetwork,
    quarryMarketFreight,
    bottlenecks: createBottleneckAnalysis(
      state.geography,
      state.roadNetwork,
      state.roadTraffic,
      quarryMarketFreight,
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

  const segments = state.roadNetwork.segments.map((segment) =>
    segment.id === roadSegmentId
      ? Object.freeze({ ...segment, roadClass: "highway" as const })
      : segment,
  );
  return { ...state, roadNetwork: createRoadNetwork(segments) };
}

function advance(state: SimulationState, ticks: number): number {
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

function normalizePoint(
  position: Point,
  geography: ScenarioGeography,
): Point {
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
  const roadNetwork = createRoadNetwork([...state.roadNetwork.segments, segment]);

  return {
    ...state,
    roadNetwork,
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
  if (segments.length === state.roadNetwork.segments.length) {
    return state;
  }

  return { ...state, roadNetwork: createRoadNetwork(segments) };
}

function createSimulationState(
  seed: string,
  tick: number,
  roadSegments: readonly RoadSegment[],
  nextRoadSegmentNumber: number,
  savedDevelopment?: DevelopmentStateSnapshot,
  savedRoadTraffic?: RoadTrafficStateSnapshot,
): SimulationState {
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError("simulation tick must be a non-negative safe integer");
  }
  if (
    !Number.isSafeInteger(nextRoadSegmentNumber) ||
    nextRoadSegmentNumber < 1
  ) {
    throw new RangeError(
      "next road segment number must be a positive safe integer",
    );
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

  const traffic = savedRoadTraffic
    ? restoreRoadTraffic(
        baseRoadNetwork,
        savedRoadTraffic,
        tick,
        geography.quarry.position,
        geography.externalMarketConnection.position,
        QUARRY_MARKET_ASSIGNED_FLOW_UNITS_PER_DAY,
      )
    : createRoadTraffic(
        baseRoadNetwork,
        tick,
        geography.quarry.position,
        geography.externalMarketConnection.position,
        QUARRY_MARKET_ASSIGNED_FLOW_UNITS_PER_DAY,
      );

  return Object.freeze({
    seed,
    tick,
    geography,
    roadNetwork: traffic.network,
    roadTraffic: traffic.state,
    nextRoadSegmentNumber,
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
      development: state.development,
    });

  let state = initialState;
  let accessibility = createAccessibilityScorer(
    createMillfordAccessibilityModel(initialState.geography),
    initialState.roadNetwork,
  );
  const developmentModel = createMillfordDevelopmentModel(
    initialState.geography,
  );

  return {
    dispatch(command) {
      const previousRoadNetwork = state.roadNetwork;
      switch (command.type) {
        case "advance": {
          const tick = advance(state, command.ticks);
          const traffic = advanceRoadTraffic(
            state.roadNetwork,
            state.roadTraffic,
            tick,
            state.geography.quarry.position,
            state.geography.externalMarketConnection.position,
            QUARRY_MARKET_ASSIGNED_FLOW_UNITS_PER_DAY,
          );
          if (traffic.network !== state.roadNetwork) {
            accessibility.updateNetwork(traffic.network);
          }
          state = {
            ...state,
            tick,
            roadNetwork: traffic.network,
            roadTraffic: traffic.state,
            development: advanceDevelopment(
              state.development,
              developmentModel,
              accessibility.getSnapshot(),
              state.seed,
              tick,
            ),
          };
          break;
        }
        case "reset":
          state = initialState;
          accessibility = createAccessibilityScorer(
            createMillfordAccessibilityModel(initialState.geography),
            initialState.roadNetwork,
          );
          break;
        case "build-road":
          state = buildRoad(
            state,
            command.start,
            command.end,
            command.roadClass,
          );
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
          state.geography.quarry.position,
          state.geography.externalMarketConnection.position,
          QUARRY_MARKET_ASSIGNED_FLOW_UNITS_PER_DAY,
        );
        state = {
          ...state,
          roadNetwork: traffic.network,
          roadTraffic: traffic.state,
        };
        accessibility.updateNetwork(state.roadNetwork);
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
  const initialState = createSimulationState(seed, 0, [], 1);

  return runSimulation(initialState);
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
      savedState.roadTraffic,
    ),
  );
}
