import {
  TICKS_PER_DAY,
  type InfrastructureTransactionQuote,
  type FreightRoute,
  type Point,
  type FreightRailTerminalState,
  type RailNetwork,
  type RailRoute,
  type RailTerminalSite,
  type RailTrackSegment,
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
  advanceFinanceDay,
  commitInfrastructureTransaction,
  createFinanceSnapshot,
  createFinanceState,
  issueEmergencyBond,
  markFinanceProcessed,
  quoteFreightRailTerminalConstruction,
  quoteFreightRailTerminalRemoval,
  quoteRailTrackConstruction,
  quoteRailTrackRemoval,
  quoteRoadConstruction,
  quoteRoadRemoval,
  quoteRoadUpgrade,
  validateFinanceState,
  type FinanceStateSnapshot,
} from "./economy/infrastructure-finance";
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
import {
  createFreightRailTerminalState,
  createRailNetwork,
  findRailRoute as queryRailRoute,
} from "./transport/rail-network";
import { createBottleneckAnalysis } from "./transport/bottlenecks";
import {
  advanceFreightOperators,
  assignedFreightRoute,
  createFreightOperators,
  freightServiceCandidates,
  restoreFreightOperators,
  setFreightServicePrice,
  type FreightOperatorDemand,
  type FreightOperatorStateSnapshot,
} from "./transport/freight-operators";
import type { RoadTrafficStateSnapshot } from "./transport/road-traffic";

const DEFAULT_PLAYER_ROAD_CLASS: RoadClass = "arterial";
export const INBOUND_TRAFFIC_FLOW_ID = "stone-supply-inbound";
export const OUTBOUND_TRAFFIC_FLOW_ID = "stone-supply-outbound";

interface SimulationState {
  readonly seed: string;
  readonly tick: number;
  readonly geography: ScenarioGeography;
  readonly roadNetwork: RoadNetwork;
  readonly freightOperators: FreightOperatorStateSnapshot;
  readonly nextRoadSegmentNumber: number;
  readonly railNetwork: RailNetwork;
  readonly nextRailTrackNumber: number;
  readonly supplyChain: StoneSupplyChainStateSnapshot;
  readonly finances: FinanceStateSnapshot;
  readonly development: DevelopmentStateSnapshot;
}

export interface SimulationStateSnapshot {
  readonly seed: string;
  readonly tick: number;
  readonly roadSegments: readonly RoadSegment[];
  readonly nextRoadSegmentNumber: number;
  readonly railTracks?: readonly RailTrackSegment[];
  readonly railTerminals?: readonly FreightRailTerminalState[];
  readonly nextRailTrackNumber?: number;
  readonly roadTraffic?: RoadTrafficStateSnapshot;
  readonly freightOperators?: FreightOperatorStateSnapshot;
  readonly supplyChain?: StoneSupplyChainStateSnapshot;
  readonly finances?: FinanceStateSnapshot;
  readonly development?: DevelopmentStateSnapshot;
}

export interface Simulation {
  dispatch(command: SimulationCommand): SimulationSnapshot;
  getSnapshot(): SimulationSnapshot;
  getState(): SimulationStateSnapshot;
  findRoute(start: Point, end: Point): RoadRoute | undefined;
  findRailRoute(
    originTerminalId: string,
    destinationTerminalId: string,
  ): RailRoute | undefined;
  quoteRoadConstruction(
    start: Point,
    end: Point,
    roadClass?: RoadClass,
  ): InfrastructureTransactionQuote;
  quoteRoadUpgrade(roadSegmentId: string): InfrastructureTransactionQuote;
  quoteRoadRemoval(roadSegmentId: string): InfrastructureTransactionQuote;
  quoteRailTrackConstruction(
    start: Point,
    end: Point,
  ): InfrastructureTransactionQuote;
  quoteRailTrackRemoval(railTrackId: string): InfrastructureTransactionQuote;
  quoteFreightRailTerminalConstruction(
    site: RailTerminalSite,
  ): InfrastructureTransactionQuote;
  quoteFreightRailTerminalRemoval(
    railTerminalId: string,
  ): InfrastructureTransactionQuote;
}

function freightDemands(
  geography: ScenarioGeography,
  supplyChain: StoneSupplyChainStateSnapshot,
): readonly FreightOperatorDemand[] {
  return Object.freeze([
    Object.freeze({
      id: INBOUND_TRAFFIC_FLOW_ID,
      start: geography.quarry.position,
      end: geography.stoneworks.position,
      originRailTerminalId: "rail-terminal-quarry",
      destinationRailTerminalId: "rail-terminal-stoneworks",
      demandTonsPerDay: supplyChain.inboundShippedTonsPerDay,
    }),
    Object.freeze({
      id: OUTBOUND_TRAFFIC_FLOW_ID,
      start: geography.stoneworks.position,
      end: geography.externalMarketConnection.position,
      originRailTerminalId: "rail-terminal-stoneworks",
      destinationRailTerminalId: "rail-terminal-market",
      demandTonsPerDay: supplyChain.outboundShippedTonsPerDay,
    }),
  ]);
}

function supplyRoutes(state: SimulationState): {
  readonly inbound: FreightRoute | undefined;
  readonly outbound: FreightRoute | undefined;
} {
  return {
    inbound: assignedFreightRoute(
      state.roadNetwork,
      state.railNetwork,
      state.freightOperators,
      INBOUND_TRAFFIC_FLOW_ID,
    ),
    outbound: assignedFreightRoute(
      state.roadNetwork,
      state.railNetwork,
      state.freightOperators,
      OUTBOUND_TRAFFIC_FLOW_ID,
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
    freightServiceCandidates(
      state.roadNetwork,
      state.railNetwork,
      state.freightOperators,
      INBOUND_TRAFFIC_FLOW_ID,
    ),
    freightServiceCandidates(
      state.roadNetwork,
      state.railNetwork,
      state.freightOperators,
      OUTBOUND_TRAFFIC_FLOW_ID,
    ),
  );
  return Object.freeze({
    seed: state.seed,
    tick: state.tick,
    elapsedDays: state.tick / TICKS_PER_DAY,
    geography: state.geography,
    roadNetwork: state.roadNetwork,
    railNetwork: state.railNetwork,
    stoneSupplyChain,
    finances: createFinanceSnapshot(
      state.finances,
      state.geography,
      state.roadNetwork,
      state.railNetwork,
    ),
    bottlenecks: createBottleneckAnalysis(
      state.geography,
      state.roadNetwork,
      state.freightOperators,
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
  const roadNetwork = createRoadNetwork(
    state.roadNetwork.segments.map((segment) =>
      segment.id === roadSegmentId
        ? Object.freeze({ ...segment, roadClass: "highway" as const })
        : segment,
    ),
  );
  const transactionQuote = quoteRoadUpgrade(
    state.finances.balance,
    state.geography,
    existing,
  );
  return {
    ...state,
    roadNetwork,
    finances: commitInfrastructureTransaction(
      state.finances,
      transactionQuote,
      state.tick,
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

function normalizeCoordinate(
  value: number,
  maximum: number,
  infrastructure = "road",
): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${infrastructure} coordinates must be finite numbers`);
  }
  return Math.round(Math.min(maximum, Math.max(0, value)) * 1_000) / 1_000;
}

function normalizePoint(
  position: Point,
  geography: ScenarioGeography,
  infrastructure = "road",
): Point {
  return Object.freeze({
    x: normalizeCoordinate(position.x, geography.bounds.width, infrastructure),
    y: normalizeCoordinate(position.y, geography.bounds.height, infrastructure),
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
  const transactionQuote = quoteRoadConstruction(
    state.finances.balance,
    state.geography,
    segment,
  );
  return {
    ...state,
    roadNetwork,
    nextRoadSegmentNumber: state.nextRoadSegmentNumber + 1,
    finances: commitInfrastructureTransaction(
      state.finances,
      transactionQuote,
      state.tick,
    ),
  };
}

function removeRoad(
  state: SimulationState,
  roadSegmentId: string,
): SimulationState {
  const existing = state.roadNetwork.segments.find(
    ({ id }) => id === roadSegmentId,
  );
  if (!existing) {
    return state;
  }
  const segments = state.roadNetwork.segments.filter(
    ({ id }) => id !== roadSegmentId,
  );
  const transactionQuote = quoteRoadRemoval(state.finances.balance, existing);
  return {
    ...state,
    roadNetwork: createRoadNetwork(segments),
    finances: commitInfrastructureTransaction(
      state.finances,
      transactionQuote,
      state.tick,
    ),
  };
}

function buildRailTrack(
  state: SimulationState,
  startInput: Point,
  endInput: Point,
): SimulationState {
  const start = normalizePoint(startInput, state.geography, "rail track");
  const end = normalizePoint(endInput, state.geography, "rail track");
  if (start.x === end.x && start.y === end.y) {
    throw new RangeError("a rail track must have two distinct endpoints");
  }
  const track: RailTrackSegment = Object.freeze({
    id: `rail-track-${state.nextRailTrackNumber}`,
    start,
    end,
  });
  const railNetwork = createRailNetwork(
    [...state.railNetwork.tracks, track],
    state.railNetwork.terminals,
    state.geography,
  );
  const transactionQuote = quoteRailTrackConstruction(
    state.finances.balance,
    state.geography,
    track,
  );
  return Object.freeze({
    ...state,
    railNetwork,
    nextRailTrackNumber: state.nextRailTrackNumber + 1,
    finances: commitInfrastructureTransaction(
      state.finances,
      transactionQuote,
      state.tick,
    ),
  });
}

function removeRailTrack(
  state: SimulationState,
  railTrackId: string,
): SimulationState {
  const existing = state.railNetwork.tracks.find(
    ({ id }) => id === railTrackId,
  );
  if (!existing) {
    return state;
  }
  const transactionQuote = quoteRailTrackRemoval(
    state.finances.balance,
    existing,
  );
  return Object.freeze({
    ...state,
    railNetwork: createRailNetwork(
      state.railNetwork.tracks.filter(({ id }) => id !== railTrackId),
      state.railNetwork.terminals,
      state.geography,
    ),
    finances: commitInfrastructureTransaction(
      state.finances,
      transactionQuote,
      state.tick,
    ),
  });
}

function placeFreightRailTerminal(
  state: SimulationState,
  site: RailTerminalSite,
): SimulationState {
  if (state.railNetwork.terminals.some((terminal) => terminal.site === site)) {
    throw new RangeError(`a freight rail terminal already exists at ${site}`);
  }
  const terminal = createFreightRailTerminalState(state.geography, site);
  const railNetwork = createRailNetwork(
    state.railNetwork.tracks,
    [...state.railNetwork.terminals, terminal],
    state.geography,
  );
  const transactionQuote = quoteFreightRailTerminalConstruction(
    state.finances.balance,
  );
  return Object.freeze({
    ...state,
    railNetwork,
    finances: commitInfrastructureTransaction(
      state.finances,
      transactionQuote,
      state.tick,
    ),
  });
}

function removeFreightRailTerminal(
  state: SimulationState,
  railTerminalId: string,
): SimulationState {
  const existing = state.railNetwork.terminals.find(
    ({ id }) => id === railTerminalId,
  );
  if (!existing) {
    return state;
  }
  const transactionQuote = quoteFreightRailTerminalRemoval(
    state.finances.balance,
  );
  return Object.freeze({
    ...state,
    railNetwork: createRailNetwork(
      state.railNetwork.tracks,
      state.railNetwork.terminals.filter(({ id }) => id !== railTerminalId),
      state.geography,
    ),
    finances: commitInfrastructureTransaction(
      state.finances,
      transactionQuote,
      state.tick,
    ),
  });
}

function createSimulationState(
  seed: string,
  tick: number,
  roadSegments: readonly RoadSegment[],
  nextRoadSegmentNumber: number,
  railTracks: readonly RailTrackSegment[] = [],
  railTerminals: readonly FreightRailTerminalState[] = [],
  nextRailTrackNumber = 1,
  savedDevelopment?: DevelopmentStateSnapshot,
  savedSupplyChain?: StoneSupplyChainStateSnapshot,
  savedRoadTraffic?: RoadTrafficStateSnapshot,
  savedFinances?: FinanceStateSnapshot,
  savedFreightOperators?: FreightOperatorStateSnapshot,
): SimulationState {
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError("simulation tick must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(nextRoadSegmentNumber) || nextRoadSegmentNumber < 1) {
    throw new RangeError("next road segment number must be a positive safe integer");
  }
  if (!Number.isSafeInteger(nextRailTrackNumber) || nextRailTrackNumber < 1) {
    throw new RangeError("next rail track number must be a positive safe integer");
  }
  const geography = generateMillfordValley(seed);
  for (const [kind, segments] of [
    ["road", roadSegments],
    ["rail track", railTracks],
  ] as const) {
    for (const segment of segments) {
    for (const position of [segment.start, segment.end]) {
      if (
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        position.x < 0 ||
        position.x > geography.bounds.width ||
        position.y < 0 ||
        position.y > geography.bounds.height
      ) {
          throw new RangeError(
            `saved ${kind} coordinates must be within map bounds`,
          );
        }
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
  const railNetwork = createRailNetwork(railTracks, railTerminals, geography);
  if (
    railNetwork.tracks.some(
      ({ id }) => id === `rail-track-${nextRailTrackNumber}`,
    )
  ) {
    throw new RangeError("next rail track id must be unused");
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
  const finances = savedFinances
    ? validateFinanceState(savedFinances, tick)
    : createFinanceState(tick);
  // Versions before multimodal assignment carry road-only state. Their final
  // topology and economy are retained, while assignment is rebuilt at load.
  void savedRoadTraffic;
  const demands = freightDemands(geography, supplyChain);
  const operators = savedFreightOperators
    ? restoreFreightOperators(
        baseRoadNetwork,
        railNetwork,
        savedFreightOperators,
        tick,
        demands,
      )
    : createFreightOperators(baseRoadNetwork, railNetwork, tick, demands);

  return Object.freeze({
    seed,
    tick,
    geography,
    roadNetwork: operators.roadNetwork,
    freightOperators: operators.state,
    nextRoadSegmentNumber,
    railNetwork: operators.railNetwork,
    nextRailTrackNumber,
    supplyChain,
    finances,
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
      railTracks: state.railNetwork.tracks.map(({ id, start, end }) =>
        Object.freeze({ id, start, end }),
      ),
      railTerminals: state.railNetwork.terminals.map(({ id, site, siteId }) =>
        Object.freeze({ id, site, siteId }),
      ),
      nextRailTrackNumber: state.nextRailTrackNumber,
      freightOperators: state.freightOperators,
      supplyChain: state.supplyChain,
      finances: state.finances,
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
      const previousRailNetwork = state.railNetwork;
      switch (command.type) {
        case "advance": {
          const targetTick = advanceTarget(state, command.ticks);
          let network = state.roadNetwork;
          let railNetwork = state.railNetwork;
          let operatorState = state.freightOperators;
          let supplyChain = state.supplyChain;
          let finances = state.finances;
          let activityChanged = false;

          while (supplyChain.nextUpdateTick <= targetTick) {
            const updateTick = supplyChain.nextUpdateTick;
            const beforeBoundary = advanceFreightOperators(
              network,
              railNetwork,
              operatorState,
              updateTick - 1,
              freightDemands(state.geography, supplyChain),
            );
            network = beforeBoundary.roadNetwork;
            railNetwork = beforeBoundary.railNetwork;
            operatorState = beforeBoundary.state;
            const previousProcessing = supplyChain.processedTonsPerDay;
            supplyChain = advanceStoneSupplyChainDay(
              supplyChain,
              updateTick,
              assignedFreightRoute(
                network,
                railNetwork,
                operatorState,
                INBOUND_TRAFFIC_FLOW_ID,
              ),
              assignedFreightRoute(
                network,
                railNetwork,
                operatorState,
                OUTBOUND_TRAFFIC_FLOW_ID,
              ),
            );
            activityChanged ||=
              previousProcessing !== supplyChain.processedTonsPerDay;
            finances = advanceFinanceDay(
              finances,
              updateTick,
              supplyChain.outboundShippedTonsPerDay,
              state.geography,
              network,
              railNetwork,
            );
            const atBoundary = createFreightOperators(
              network,
              railNetwork,
              updateTick,
              freightDemands(state.geography, supplyChain),
              operatorState.pricing,
            );
            network = atBoundary.roadNetwork;
            railNetwork = atBoundary.railNetwork;
            operatorState = atBoundary.state;
          }

          const operators = advanceFreightOperators(
            network,
            railNetwork,
            operatorState,
            targetTick,
            freightDemands(state.geography, supplyChain),
          );
          supplyChain = markStoneSupplyChainProcessed(supplyChain, targetTick);
          finances = markFinanceProcessed(finances, targetTick);
          state = {
            ...state,
            tick: targetTick,
            roadNetwork: operators.roadNetwork,
            railNetwork: operators.railNetwork,
            freightOperators: operators.state,
            supplyChain,
            finances,
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
        case "build-rail-track":
          state = buildRailTrack(state, command.start, command.end);
          break;
        case "remove-rail-track":
          state = removeRailTrack(state, command.railTrackId);
          break;
        case "place-freight-rail-terminal":
          state = placeFreightRailTerminal(state, command.site);
          break;
        case "remove-freight-rail-terminal":
          state = removeFreightRailTerminal(state, command.railTerminalId);
          break;
        case "set-freight-service-price":
          state = {
            ...state,
            freightOperators: {
              ...state.freightOperators,
              pricing: setFreightServicePrice(
                state.freightOperators.pricing,
                command.mode,
                command.adjustmentHours,
              ),
            },
          };
          break;
        case "issue-emergency-bond":
          state = { ...state, finances: issueEmergencyBond(state.finances) };
          break;
      }

      if (
        (state.roadNetwork !== previousRoadNetwork ||
          state.railNetwork !== previousRailNetwork ||
          command.type === "set-freight-service-price") &&
        command.type !== "reset" &&
        command.type !== "advance"
      ) {
        const operators = createFreightOperators(
          state.roadNetwork,
          state.railNetwork,
          state.tick,
          freightDemands(state.geography, state.supplyChain),
          state.freightOperators.pricing,
        );
        state = {
          ...state,
          roadNetwork: operators.roadNetwork,
          railNetwork: operators.railNetwork,
          freightOperators: operators.state,
        };
        if (state.roadNetwork !== previousRoadNetwork) {
          updateAccessibility(state.roadNetwork);
        }
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
    findRailRoute(originTerminalId, destinationTerminalId) {
      return queryRailRoute(
        state.railNetwork,
        originTerminalId,
        destinationTerminalId,
      );
    },
    quoteRoadConstruction(start, end, roadClass = DEFAULT_PLAYER_ROAD_CLASS) {
      const normalizedStart = normalizePoint(start, state.geography);
      const normalizedEnd = normalizePoint(end, state.geography);
      if (
        normalizedStart.x === normalizedEnd.x &&
        normalizedStart.y === normalizedEnd.y
      ) {
        throw new RangeError("a road segment must have two distinct endpoints");
      }
      return quoteRoadConstruction(state.finances.balance, state.geography, {
        roadClass,
        start: normalizedStart,
        end: normalizedEnd,
      });
    },
    quoteRoadUpgrade(roadSegmentId) {
      const segment = state.roadNetwork.segments.find(
        ({ id }) => id === roadSegmentId,
      );
      if (!segment) {
        throw new RangeError(`road segment ${roadSegmentId} does not exist`);
      }
      return quoteRoadUpgrade(state.finances.balance, state.geography, segment);
    },
    quoteRoadRemoval(roadSegmentId) {
      const segment = state.roadNetwork.segments.find(
        ({ id }) => id === roadSegmentId,
      );
      if (!segment) {
        throw new RangeError(`road segment ${roadSegmentId} does not exist`);
      }
      return quoteRoadRemoval(state.finances.balance, segment);
    },
    quoteRailTrackConstruction(start, end) {
      const normalizedStart = normalizePoint(start, state.geography, "rail track");
      const normalizedEnd = normalizePoint(end, state.geography, "rail track");
      if (
        normalizedStart.x === normalizedEnd.x &&
        normalizedStart.y === normalizedEnd.y
      ) {
        throw new RangeError("a rail track must have two distinct endpoints");
      }
      return quoteRailTrackConstruction(
        state.finances.balance,
        state.geography,
        { start: normalizedStart, end: normalizedEnd },
      );
    },
    quoteRailTrackRemoval(railTrackId) {
      const track = state.railNetwork.tracks.find(({ id }) => id === railTrackId);
      if (!track) {
        throw new RangeError(`rail track ${railTrackId} does not exist`);
      }
      return quoteRailTrackRemoval(state.finances.balance, track);
    },
    quoteFreightRailTerminalConstruction(site) {
      createFreightRailTerminalState(state.geography, site);
      if (state.railNetwork.terminals.some((terminal) => terminal.site === site)) {
        throw new RangeError(`a freight rail terminal already exists at ${site}`);
      }
      return quoteFreightRailTerminalConstruction(state.finances.balance);
    },
    quoteFreightRailTerminalRemoval(railTerminalId) {
      if (!state.railNetwork.terminals.some(({ id }) => id === railTerminalId)) {
        throw new RangeError(`rail terminal ${railTerminalId} does not exist`);
      }
      return quoteFreightRailTerminalRemoval(state.finances.balance);
    },
  };
}

export function createSimulation(seed: string): Simulation {
  return runSimulation(createSimulationState(seed, 0, [], 1, [], [], 1));
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
      savedState.railTracks,
      savedState.railTerminals,
      savedState.nextRailTrackNumber,
      savedState.development,
      savedState.supplyChain,
      savedState.roadTraffic,
      savedState.finances,
      savedState.freightOperators,
    ),
  );
}
