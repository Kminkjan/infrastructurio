import {
  TICKS_PER_DAY,
  type AccessibilitySnapshot,
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
  type ConsequenceForecastEntry,
} from "../shared";
import {
  createMillfordStartingRoads,
  generateMillfordValley,
} from "../scenarios";
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
  FREIGHT_ASSIGNMENT_INTERVAL_TICKS,
} from "./transport/freight-operators";
import type { RoadTrafficStateSnapshot } from "./transport/road-traffic";
import {
  createScenarioProgressSnapshot,
  createScenarioProgressState,
  recordStrategicIntervention,
  recordScenarioInspection,
  updateScenarioProgress,
  validateScenarioProgressState,
  type ScenarioProgressContext,
  type ScenarioProgressStateSnapshot,
} from "./scenario/millford-scenario";
import { createSimulationExplanations } from "./explanations";

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
  readonly scenarioProgress: ScenarioProgressStateSnapshot;
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
  readonly scenarioProgress?: ScenarioProgressStateSnapshot;
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

function derivedSnapshots(
  state: SimulationState,
  accessibility: ReturnType<typeof createAccessibilityScorer>,
  developmentModel: DevelopmentModel,
  initialAccessibility: AccessibilitySnapshot,
) {
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
  const finances = createFinanceSnapshot(
    state.finances,
    state.geography,
    state.roadNetwork,
    state.railNetwork,
  );
  const bottlenecks = createBottleneckAnalysis(
    state.geography,
    state.roadNetwork,
    state.freightOperators,
    stoneSupplyChain,
  );
  const development = createDevelopmentSnapshot(
    state.development,
    developmentModel,
    accessibilitySnapshot,
  );
  const progressContext: ScenarioProgressContext = Object.freeze({
    tick: state.tick,
    geography: state.geography,
    roadNetwork: state.roadNetwork,
    supplyChain: stoneSupplyChain,
    finances,
    bottlenecks,
    accessibility: accessibilitySnapshot,
    development,
    initialAccessibility,
  });
  return Object.freeze({
    stoneSupplyChain,
    finances,
    bottlenecks,
    accessibility: accessibilitySnapshot,
    development,
    progressContext,
  });
}

function snapshot(
  state: SimulationState,
  accessibility: ReturnType<typeof createAccessibilityScorer>,
  developmentModel: DevelopmentModel,
  initialAccessibility: ScenarioProgressContext["initialAccessibility"],
  consequenceForecast: readonly ConsequenceForecastEntry[] = [],
): SimulationSnapshot {
  const derived = derivedSnapshots(
    state,
    accessibility,
    developmentModel,
    initialAccessibility,
  );
  const scenarioProgress = createScenarioProgressSnapshot(
    state.scenarioProgress,
    derived.progressContext,
  );
  const explanations = createSimulationExplanations(
    state.geography,
    derived.stoneSupplyChain,
    derived.finances,
    state.roadNetwork,
    state.railNetwork,
    derived.accessibility,
    derived.development,
    state.scenarioProgress.latestStrategicIntervention,
    state.freightOperators.nextAssignmentTick,
    scenarioProgress,
    consequenceForecast,
  );
  return Object.freeze({
    seed: state.seed,
    tick: state.tick,
    elapsedDays: state.tick / TICKS_PER_DAY,
    time: Object.freeze({
      trafficUpdateIntervalTicks: FREIGHT_ASSIGNMENT_INTERVAL_TICKS,
      economyUpdateIntervalTicks: TICKS_PER_DAY,
      developmentUpdateIntervalTicks: developmentModel.evaluationIntervalTicks,
      nextTrafficUpdateTick: state.freightOperators.nextAssignmentTick,
      nextEconomyUpdateTick: state.supplyChain.nextUpdateTick,
      nextMaintenanceUpdateTick: state.supplyChain.nextUpdateTick,
      nextDevelopmentUpdateTick: state.development.nextEvaluationTick,
    }),
    geography: state.geography,
    roadNetwork: state.roadNetwork,
    railNetwork: state.railNetwork,
    stoneSupplyChain: derived.stoneSupplyChain,
    finances: derived.finances,
    bottlenecks: derived.bottlenecks,
    accessibility: derived.accessibility,
    development: derived.development,
    scenarioProgress,
    explanations,
  });
}

function forecastValue(
  label: string,
  value: number,
  unit: ConsequenceForecastEntry["values"][number]["unit"],
) {
  return Object.freeze({ label, value, unit });
}

function createConsequenceForecast(
  state: SimulationState,
  authoredInitialState: SimulationState,
  current: SimulationSnapshot,
): readonly ConsequenceForecastEntry[] {
  const boundaries = [
    { kind: "traffic-assignment" as const, tick: current.time.nextTrafficUpdateTick },
    { kind: "economy-and-finance" as const, tick: current.time.nextEconomyUpdateTick },
    { kind: "development" as const, tick: current.time.nextDevelopmentUpdateTick },
  ].sort((first, second) => first.tick - second.tick || first.kind.localeCompare(second.kind));
  const projection = runSimulation(state, authoredInitialState, false);
  let projected = current;
  const entries: ConsequenceForecastEntry[] = [];
  for (const boundary of boundaries) {
    if (boundary.tick > projected.tick) {
      projected = projection.dispatch({
        type: "advance",
        ticks: boundary.tick - projected.tick,
      });
    }
    if (boundary.kind === "traffic-assignment") {
      const inbound = projected.stoneSupplyChain.inboundFreight;
      const outbound = projected.stoneSupplyChain.outboundFreight;
      entries.push(Object.freeze({
        kind: boundary.kind,
        tick: boundary.tick,
        inTicks: boundary.tick - state.tick,
        summary: `Operators will assign inbound granite to ${inbound.chosenMode ?? "no service"} and outbound stone to ${outbound.chosenMode ?? "no service"}.`,
        values: Object.freeze([
          forecastValue("Inbound assigned", inbound.assignedTonsPerDay, "tons/day"),
          forecastValue("Outbound assigned", outbound.assignedTonsPerDay, "tons/day"),
          ...(inbound.routeCost === null ? [] : [forecastValue("Inbound route cost", inbound.routeCost, "hours")]),
          ...(outbound.routeCost === null ? [] : [forecastValue("Outbound route cost", outbound.routeCost, "hours")]),
        ]),
      }));
    } else if (boundary.kind === "economy-and-finance") {
      entries.push(Object.freeze({
        kind: boundary.kind,
        tick: boundary.tick,
        inTicks: boundary.tick - state.tick,
        summary: `The daily update will process ${projected.stoneSupplyChain.stoneworks.processedTonsPerDay.toLocaleString()} tons and leave the treasury at $${projected.finances.balance.toFixed(2)}.`,
        values: Object.freeze([
          forecastValue("Inbound shipped", projected.stoneSupplyChain.inboundFreight.shippedTonsPerDay, "tons/day"),
          forecastValue("Stone processed", projected.stoneSupplyChain.stoneworks.processedTonsPerDay, "tons/day"),
          forecastValue("Outbound shipped", projected.stoneSupplyChain.outboundFreight.shippedTonsPerDay, "tons/day"),
          forecastValue("Operating revenue", projected.finances.lastDailyRevenue, "currency"),
          forecastValue("Maintenance charged", projected.finances.lastDailyMaintenance, "currency"),
          forecastValue("Emergency penalty", projected.finances.emergencyFinance.dailyPenalty, "currency"),
          forecastValue("Treasury after update", projected.finances.balance, "currency"),
        ]),
      }));
    } else {
      entries.push(Object.freeze({
        kind: boundary.kind,
        tick: boundary.tick,
        inTicks: boundary.tick - state.tick,
        summary: `Development will evaluate Millford and Eastbank with ${projected.development.demand.completedGrowthPopulation} completed and ${projected.development.demand.committedGrowthPopulation} committed residents.`,
        values: Object.freeze([
          ...projected.development.locations.map((location) =>
            forecastValue(`${location.name} pressure`, location.pressure, "access points"),
          ),
          forecastValue("Completed regional growth", projected.development.demand.completedGrowthPopulation, "residents"),
          forecastValue("Committed regional growth", projected.development.demand.committedGrowthPopulation, "residents"),
        ]),
      }));
    }
  }
  return Object.freeze(entries);
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
  savedScenarioProgress?: ScenarioProgressStateSnapshot,
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
  const scenarioProgress = savedScenarioProgress
    ? validateScenarioProgressState(savedScenarioProgress, tick, geography)
    : createScenarioProgressState(tick);
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
    scenarioProgress,
  });
}

function runSimulation(
  initialState: SimulationState,
  authoredInitialState: SimulationState = initialState,
  includeForecast = true,
): Simulation {
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
      scenarioProgress: state.scenarioProgress,
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
  const initialAccessibility = createAccessibilityScorer(
    createMillfordAccessibilityModel(authoredInitialState.geography, 0),
    authoredInitialState.roadNetwork,
  ).getSnapshot();

  function currentSnapshot(): SimulationSnapshot {
    const current = snapshot(
      state,
      accessibility,
      developmentModel,
      initialAccessibility,
    );
    return includeForecast
      ? snapshot(
          state,
          accessibility,
          developmentModel,
          initialAccessibility,
          createConsequenceForecast(state, authoredInitialState, current),
        )
      : current;
  }

  function updateProgress(evaluateDailyBoundary: boolean): void {
    const derived = derivedSnapshots(
      state,
      accessibility,
      developmentModel,
      initialAccessibility,
    );
    state = {
      ...state,
      scenarioProgress: updateScenarioProgress(
        state.scenarioProgress,
        derived.progressContext,
        evaluateDailyBoundary,
      ),
    };
  }

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
      const previousTransaction = state.finances.lastInfrastructureTransaction;
      const interventionBaseline = state.scenarioProgress.bridgeOverloadObserved &&
        [
          "build-road",
          "upgrade-road",
          "remove-road",
          "build-rail-track",
          "remove-rail-track",
          "place-freight-rail-terminal",
          "remove-freight-rail-terminal",
        ].includes(command.type)
        ? accessibility.getSnapshot()
        : undefined;
      switch (command.type) {
        case "advance": {
          const targetTick = advanceTarget(state, command.ticks);
          let network = state.roadNetwork;
          let railNetwork = state.railNetwork;
          let operatorState = state.freightOperators;
          let supplyChain = state.supplyChain;
          let finances = state.finances;

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
            const activityChanged =
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

            state = {
              ...state,
              tick: updateTick,
              roadNetwork: network,
              railNetwork,
              freightOperators: operatorState,
              supplyChain,
              finances,
            };
            updateAccessibility(network, activityChanged);
            state = {
              ...state,
              development: advanceDevelopment(
                state.development,
                developmentModel,
                accessibility.getSnapshot(),
                state.seed,
                updateTick,
              ),
            };
            updateProgress(true);
            network = state.roadNetwork;
            railNetwork = state.railNetwork;
            operatorState = state.freightOperators;
            supplyChain = state.supplyChain;
            finances = state.finances;
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
          updateAccessibility(state.roadNetwork);
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
          state = authoredInitialState;
          accessibility = createAccessibilityScorer(
            createMillfordAccessibilityModel(authoredInitialState.geography, 0),
            authoredInitialState.roadNetwork,
          );
          break;
        case "inspect-entity":
          state = {
            ...state,
            scenarioProgress: recordScenarioInspection(
              state.scenarioProgress,
              state.geography,
              command.entityId,
            ),
          };
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
      if (
        interventionBaseline &&
        state.finances.lastInfrastructureTransaction !== previousTransaction
      ) {
        state = {
          ...state,
          scenarioProgress: recordStrategicIntervention(
            state.scenarioProgress,
            interventionBaseline,
          ),
        };
      }
      updateProgress(false);
      return currentSnapshot();
    },
    getSnapshot() {
      return currentSnapshot();
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
  const geography = generateMillfordValley(seed);
  return runSimulation(
    createSimulationState(
      seed,
      0,
      createMillfordStartingRoads(geography),
      1,
      [],
      [],
      1,
    ),
  );
}

export function restoreSimulation(
  savedState: SimulationStateSnapshot,
): Simulation {
  const restoredState = createSimulationState(
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
    savedState.scenarioProgress,
  );
  const geography = generateMillfordValley(savedState.seed);
  const authoredInitialState = createSimulationState(
    savedState.seed,
    0,
    createMillfordStartingRoads(geography),
    1,
    [],
    [],
    1,
  );
  return runSimulation(restoredState, authoredInitialState);
}
