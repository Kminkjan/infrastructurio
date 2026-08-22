import {
  TICKS_PER_DAY,
  type Point,
  type RoadNetwork,
  type RoadRoute,
  type RoadSegment,
  type ScenarioGeography,
  type SimulationCommand,
  type SimulationSnapshot,
} from "../shared";
import { generateMillfordValley } from "../scenarios";
import { createQuarryMarketFreight } from "./economy/quarry-market-freight";
import { createRoadNetwork, findRoadRoute } from "./transport/road-network";

interface SimulationState {
  readonly seed: string;
  readonly tick: number;
  readonly geography: ScenarioGeography;
  readonly roadNetwork: RoadNetwork;
  readonly nextRoadSegmentNumber: number;
}

export interface SimulationStateSnapshot {
  readonly seed: string;
  readonly tick: number;
  readonly roadSegments: readonly RoadSegment[];
  readonly nextRoadSegmentNumber: number;
}

export interface Simulation {
  dispatch(command: SimulationCommand): SimulationSnapshot;
  getSnapshot(): SimulationSnapshot;
  getState(): SimulationStateSnapshot;
  findRoute(start: Point, end: Point): RoadRoute | undefined;
}

function snapshot(state: SimulationState): SimulationSnapshot {
  const quarryMarketRoute = findRoadRoute(
    state.roadNetwork,
    state.geography.quarry.position,
    state.geography.externalMarketConnection.position,
  );

  return Object.freeze({
    seed: state.seed,
    tick: state.tick,
    elapsedDays: state.tick / TICKS_PER_DAY,
    geography: state.geography,
    roadNetwork: state.roadNetwork,
    quarryMarketFreight: createQuarryMarketFreight(
      state.geography,
      quarryMarketRoute,
    ),
  });
}

function advance(state: SimulationState, ticks: number): SimulationState {
  if (!Number.isSafeInteger(ticks) || ticks < 0) {
    throw new RangeError("advance ticks must be a non-negative safe integer");
  }

  return { ...state, tick: state.tick + ticks };
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
): SimulationState {
  const start = normalizePoint(startInput, state.geography);
  const end = normalizePoint(endInput, state.geography);
  if (start.x === end.x && start.y === end.y) {
    throw new RangeError("a road segment must have two distinct endpoints");
  }

  const segment: RoadSegment = Object.freeze({
    id: `road-segment-${state.nextRoadSegmentNumber}`,
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

  const roadNetwork = createRoadNetwork(roadSegments);
  if (
    roadNetwork.segments.some(
      ({ id }) => id === `road-segment-${nextRoadSegmentNumber}`,
    )
  ) {
    throw new RangeError("next road segment id must be unused");
  }

  return Object.freeze({
    seed,
    tick,
    geography,
    roadNetwork,
    nextRoadSegmentNumber,
  });
}

function runSimulation(initialState: SimulationState): Simulation {
  const stateSnapshot = (state: SimulationState): SimulationStateSnapshot =>
    Object.freeze({
      seed: state.seed,
      tick: state.tick,
      roadSegments: state.roadNetwork.segments,
      nextRoadSegmentNumber: state.nextRoadSegmentNumber,
    });

  let state = initialState;

  return {
    dispatch(command) {
      switch (command.type) {
        case "advance":
          state = advance(state, command.ticks);
          break;
        case "reset":
          state = initialState;
          break;
        case "build-road":
          state = buildRoad(state, command.start, command.end);
          break;
        case "remove-road":
          state = removeRoad(state, command.roadSegmentId);
          break;
      }

      return snapshot(state);
    },
    getSnapshot() {
      return snapshot(state);
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
  const initialState: SimulationState = Object.freeze({
    seed,
    tick: 0,
    geography: generateMillfordValley(seed),
    roadNetwork: createRoadNetwork(),
    nextRoadSegmentNumber: 1,
  });

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
    ),
  );
}
