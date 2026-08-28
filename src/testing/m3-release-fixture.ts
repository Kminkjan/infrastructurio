import {
  createSaveGame,
  deserializeSaveGame,
  restoreSaveGame,
  serializeSaveGame,
} from "../persistence";
import {
  getBottleneckOverlayFeatures,
} from "../rendering";
import { createRepresentativeFreightTrafficPlan } from "../rendering/representative-freight";
import { OLD_MILLFORD_BRIDGE_ROAD_ID } from "../scenarios";
import {
  createSimulation,
  type Simulation,
} from "../simulation";
import type {
  InfrastructureTransactionQuote,
  Point,
  ScenarioEndingSummary,
  SimulationSnapshot,
} from "../shared";

export const M3_RELEASE_SEED = "millford-valley-foundation";
export const M3_MAX_COMPLETION_DAYS = 21;

export type M3PlaytestVariant =
  | "bridge-upgrade"
  | "highway-bypass"
  | "rail-shift";

export interface M3PlaytestResult {
  readonly variant: M3PlaytestVariant;
  readonly simulation: Simulation;
  readonly pressured: SimulationSnapshot;
  readonly lateScenario: SimulationSnapshot;
  readonly completed: SimulationSnapshot;
  readonly playerActions: number;
  readonly elapsedDays: number;
  readonly ending: ScenarioEndingSummary;
}

export interface M3TargetScaleFixture {
  readonly simulation: Simulation;
  readonly snapshot: SimulationSnapshot;
  readonly roadSegmentCount: number;
  readonly roadLinkCount: number;
  readonly railTrackCount: number;
  readonly railLinkCount: number;
  readonly developmentMarkCount: number;
  readonly overlayFeatureCount: number;
  readonly representativeVehicleCount: number;
}

function inspectSupplyChain(simulation: Simulation): number {
  const geography = simulation.getSnapshot().geography;
  for (const entityId of [
    geography.quarry.id,
    geography.stoneworks.id,
    geography.externalMarketConnection.id,
  ]) {
    simulation.dispatch({ type: "inspect-entity", entityId });
  }
  return 3;
}

function buildStartingConnections(simulation: Simulation): number {
  const geography = simulation.getSnapshot().geography;
  const eastbank = geography.settlementSeeds.find(
    ({ id }) => id === "settlement-eastbank",
  );
  if (!eastbank) throw new Error("M3 fixture requires Eastbank");
  simulation.dispatch({
    type: "build-road",
    start: geography.quarry.position,
    end: geography.stoneworks.position,
  });
  simulation.dispatch({
    type: "build-road",
    start: eastbank.position,
    end: geography.externalMarketConnection.position,
  });
  return 2;
}

function applyIntervention(
  simulation: Simulation,
  variant: M3PlaytestVariant,
): number {
  const geography = simulation.getSnapshot().geography;
  switch (variant) {
    case "bridge-upgrade":
      simulation.dispatch({
        type: "upgrade-road",
        roadSegmentId: OLD_MILLFORD_BRIDGE_ROAD_ID,
      });
      return 1;
    case "highway-bypass":
      simulation.dispatch({
        type: "build-road",
        start: geography.stoneworks.position,
        end: geography.externalMarketConnection.position,
        roadClass: "highway",
      });
      return 1;
    case "rail-shift":
      simulation.dispatch({
        type: "place-freight-rail-terminal",
        site: "stoneworks",
      });
      simulation.dispatch({
        type: "place-freight-rail-terminal",
        site: "market",
      });
      simulation.dispatch({
        type: "build-rail-track",
        start: geography.stoneworks.position,
        end: geography.externalMarketConnection.position,
      });
      return 3;
  }
}

export function createM3LateScenario(
  variant: M3PlaytestVariant,
): {
  readonly simulation: Simulation;
  readonly pressured: SimulationSnapshot;
  readonly lateScenario: SimulationSnapshot;
  readonly playerActions: number;
} {
  const simulation = createSimulation(`${M3_RELEASE_SEED}:${variant}`);
  let playerActions = inspectSupplyChain(simulation);
  playerActions += buildStartingConnections(simulation);
  const pressured = simulation.dispatch({ type: "advance", ticks: 24 });
  playerActions += 1;
  playerActions += applyIntervention(simulation, variant);

  let lateScenario = simulation.getSnapshot();
  while (
    !lateScenario.scenarioProgress.success &&
    lateScenario.scenarioProgress.successfulDays < 1 &&
    lateScenario.elapsedDays < M3_MAX_COMPLETION_DAYS
  ) {
    lateScenario = simulation.dispatch({ type: "advance", ticks: 24 });
    playerActions += 1;
  }
  return Object.freeze({
    simulation,
    pressured,
    lateScenario,
    playerActions,
  });
}

export function completeM3Playtest(
  variant: M3PlaytestVariant,
  restoreAtLateScenario = false,
): M3PlaytestResult {
  const late = createM3LateScenario(variant);
  let simulation = late.simulation;
  if (restoreAtLateScenario) {
    simulation = restoreSaveGame(
      deserializeSaveGame(serializeSaveGame(createSaveGame(simulation))),
    );
  }
  let completed = simulation.getSnapshot();
  let playerActions = late.playerActions;
  while (
    !completed.scenarioProgress.success &&
    completed.elapsedDays < M3_MAX_COMPLETION_DAYS
  ) {
    completed = simulation.dispatch({ type: "advance", ticks: 24 });
    playerActions += 1;
  }
  const ending = completed.scenarioProgress.ending;
  if (!ending) {
    throw new Error(
      `${variant} did not complete within ${M3_MAX_COMPLETION_DAYS} simulated days`,
    );
  }
  return Object.freeze({
    variant,
    simulation,
    pressured: late.pressured,
    lateScenario: late.lateScenario,
    completed,
    playerActions,
    elapsedDays: completed.elapsedDays,
    ending,
  });
}

function afford(
  simulation: Simulation,
  quote: () => InfrastructureTransactionQuote,
): void {
  for (let weeks = 0; weeks < 8 && !quote().affordable; weeks += 1) {
    simulation.dispatch({ type: "advance", ticks: 24 * 7 });
  }
  if (!quote().affordable) {
    throw new Error("target-scale fixture could not fund planned infrastructure");
  }
}

function buildTargetRoad(
  simulation: Simulation,
  start: Point,
  end: Point,
): void {
  afford(simulation, () =>
    simulation.quoteRoadConstruction(start, end, "arterial"),
  );
  simulation.dispatch({ type: "build-road", start, end });
}

function buildTargetTrack(
  simulation: Simulation,
  start: Point,
  end: Point,
): void {
  afford(simulation, () => simulation.quoteRailTrackConstruction(start, end));
  simulation.dispatch({ type: "build-rail-track", start, end });
}

export function createM3TargetScaleFixture(): M3TargetScaleFixture {
  const result = completeM3Playtest("rail-shift");
  const simulation = result.simulation;
  const geography = simulation.getSnapshot().geography;
  const millford = geography.settlementSeeds.find(
    ({ id }) => id === "settlement-millford",
  );
  const eastbank = geography.settlementSeeds.find(
    ({ id }) => id === "settlement-eastbank",
  );
  if (!millford || !eastbank) {
    throw new Error("M3 target-scale fixture requires both settlements");
  }

  const roadSegments = [
    [geography.quarry.position, millford.position],
    [millford.position, { x: 250, y: 150 }],
    [{ x: 250, y: 150 }, eastbank.position],
    [{ x: 250, y: 150 }, { x: 700, y: 80 }],
    [{ x: 700, y: 80 }, geography.externalMarketConnection.position],
    [eastbank.position, { x: 805, y: 275 }],
  ] as const;
  for (const [start, end] of roadSegments) {
    buildTargetRoad(simulation, start, end);
  }

  afford(simulation, () =>
    simulation.quoteFreightRailTerminalConstruction("quarry"),
  );
  simulation.dispatch({ type: "place-freight-rail-terminal", site: "quarry" });
  const tracks = [
    [geography.quarry.position, geography.stoneworks.position],
    [geography.quarry.position, { x: 100, y: 90 }],
    [{ x: 100, y: 90 }, { x: 500, y: 70 }],
    [{ x: 500, y: 70 }, geography.externalMarketConnection.position],
    [geography.stoneworks.position, { x: 500, y: 70 }],
  ] as const;
  for (const [start, end] of tracks) {
    buildTargetTrack(simulation, start, end);
  }
  simulation.dispatch({ type: "advance", ticks: 24 });

  const snapshot = simulation.getSnapshot();
  const overlayFeatures = getBottleneckOverlayFeatures(snapshot);
  const representativeVehicleCount = [
    snapshot.stoneSupplyChain.inboundFreight,
    snapshot.stoneSupplyChain.outboundFreight,
  ].reduce((total, freight) => {
    return total +
      (createRepresentativeFreightTrafficPlan(
        freight,
        snapshot.roadNetwork,
        snapshot.railNetwork,
      )?.vehicleCount ?? 0);
  }, 0);
  return Object.freeze({
    simulation,
    snapshot,
    roadSegmentCount: snapshot.roadNetwork.segments.length,
    roadLinkCount: snapshot.roadNetwork.links.length,
    railTrackCount: snapshot.railNetwork.tracks.length,
    railLinkCount: snapshot.railNetwork.links.length,
    developmentMarkCount: snapshot.development.locations.reduce(
      (total, location) =>
        total +
        Math.ceil(location.growthPopulation / 10) +
        (location.pendingConstruction ? 1 : 0),
      0,
    ),
    overlayFeatureCount: overlayFeatures.length,
    representativeVehicleCount,
  });
}
