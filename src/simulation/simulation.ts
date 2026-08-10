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
import { createRoadNetwork, findRoadRoute } from "./transport/road-network";

interface SimulationState {
  readonly seed: string;
  readonly tick: number;
  readonly geography: ScenarioGeography;
  readonly roadNetwork: RoadNetwork;
  readonly nextRoadSegmentNumber: number;
}

export interface Simulation {
  dispatch(command: SimulationCommand): SimulationSnapshot;
  getSnapshot(): SimulationSnapshot;
  findRoute(start: Point, end: Point): RoadRoute | undefined;
}

function snapshot(state: SimulationState): SimulationSnapshot {
  return Object.freeze({
    seed: state.seed,
    tick: state.tick,
    elapsedDays: state.tick / TICKS_PER_DAY,
    geography: state.geography,
    roadNetwork: state.roadNetwork,
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

export function createSimulation(seed: string): Simulation {
  const initialState: SimulationState = Object.freeze({
    seed,
    tick: 0,
    geography: generateMillfordValley(seed),
    roadNetwork: createRoadNetwork(),
    nextRoadSegmentNumber: 1,
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
    findRoute(start, end) {
      return findRoadRoute(
        state.roadNetwork,
        normalizePoint(start, state.geography),
        normalizePoint(end, state.geography),
      );
    },
  };
}
