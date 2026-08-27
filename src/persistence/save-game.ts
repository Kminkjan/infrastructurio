import {
  restoreSimulation,
  type DevelopmentStateSnapshot,
  type FinanceStateSnapshot,
  type FreightOperatorCandidateState,
  type FreightOperatorFlowStateSnapshot,
  type FreightOperatorStateSnapshot,
  type RoadTrafficFlowStateSnapshot,
  type RoadTrafficStateSnapshot,
  type Simulation,
  type SimulationStateSnapshot,
  type ScenarioProgressStateSnapshot,
  type StoneSupplyChainStateSnapshot,
} from "../simulation";
import type {
  FreightRailTerminalState,
  FreightLimitingFactor,
  InfrastructureCostBreakdown,
  Point,
  RailTerminalSite,
  RailTrackSegment,
  RoadClass,
  RoadSegment,
  StoneworksLimitingFactor,
  ScenarioEndingSummary,
} from "../shared";

export const SAVE_FORMAT_VERSION = 8 as const;
export const SAVE_FILE_NAME = "millford-valley-save.json";

interface SavedRoadSegment {
  readonly id: string;
  readonly roadClass?: RoadClass;
  readonly start: Point;
  readonly end: Point;
}

interface SaveBaseSimulation {
  readonly tick: number;
  readonly roadSegments: readonly SavedRoadSegment[];
  readonly nextRoadSegmentNumber: number;
}

export interface SaveGameV1 {
  readonly formatVersion: 1;
  readonly scenarioId: "millford-valley";
  readonly scenarioSeed: string;
  readonly simulation: SaveBaseSimulation;
}

export interface SaveGameV2 {
  readonly formatVersion: 2;
  readonly scenarioId: "millford-valley";
  readonly scenarioSeed: string;
  readonly simulation: SaveBaseSimulation & {
    readonly development: DevelopmentStateSnapshot;
  };
}

interface LegacyRoadTrafficStateV3 {
  readonly lastAssignmentTick: number;
  readonly nextAssignmentTick: number;
  readonly assignedFlowUnitsPerDay: number;
  readonly routeNodeIds: readonly string[] | null;
  readonly routeLinkIds: readonly string[] | null;
}

export interface SaveGameV3 {
  readonly formatVersion: 3;
  readonly scenarioId: "millford-valley";
  readonly scenarioSeed: string;
  readonly simulation: SaveBaseSimulation & {
    readonly development: DevelopmentStateSnapshot;
    readonly roadTraffic: LegacyRoadTrafficStateV3;
  };
}

export interface SaveGameV4 {
  readonly formatVersion: 4;
  readonly scenarioId: "millford-valley";
  readonly scenarioSeed: string;
  readonly simulation: SaveBaseSimulation & {
    readonly roadSegments: readonly RoadSegment[];
    readonly development: DevelopmentStateSnapshot;
    readonly supplyChain: StoneSupplyChainStateSnapshot;
    readonly roadTraffic: RoadTrafficStateSnapshot;
  };
}

export interface SaveGameV5 {
  readonly formatVersion: 5;
  readonly scenarioId: "millford-valley";
  readonly scenarioSeed: string;
  readonly simulation: SaveBaseSimulation & {
    readonly roadSegments: readonly RoadSegment[];
    readonly development: DevelopmentStateSnapshot;
    readonly supplyChain: StoneSupplyChainStateSnapshot;
    readonly roadTraffic: RoadTrafficStateSnapshot;
    readonly finances: FinanceStateSnapshot;
  };
}

export interface SaveGameV6 {
  readonly formatVersion: 6;
  readonly scenarioId: "millford-valley";
  readonly scenarioSeed: string;
  readonly simulation: SaveBaseSimulation & {
    readonly roadSegments: readonly RoadSegment[];
    readonly railTracks: readonly RailTrackSegment[];
    readonly railTerminals: readonly FreightRailTerminalState[];
    readonly nextRailTrackNumber: number;
    readonly development: DevelopmentStateSnapshot;
    readonly supplyChain: StoneSupplyChainStateSnapshot;
    readonly roadTraffic: RoadTrafficStateSnapshot;
    readonly finances: FinanceStateSnapshot;
  };
}

export interface SaveGameV7 {
  readonly formatVersion: 7;
  readonly scenarioId: "millford-valley";
  readonly scenarioSeed: string;
  readonly simulation: SaveBaseSimulation & {
    readonly roadSegments: readonly RoadSegment[];
    readonly railTracks: readonly RailTrackSegment[];
    readonly railTerminals: readonly FreightRailTerminalState[];
    readonly nextRailTrackNumber: number;
    readonly development: DevelopmentStateSnapshot;
    readonly supplyChain: StoneSupplyChainStateSnapshot;
    readonly freightOperators: FreightOperatorStateSnapshot;
    readonly finances: FinanceStateSnapshot;
  };
}

export interface SaveGameV8 {
  readonly formatVersion: typeof SAVE_FORMAT_VERSION;
  readonly scenarioId: "millford-valley";
  readonly scenarioSeed: string;
  readonly simulation: SaveGameV7["simulation"] & {
    readonly scenarioProgress: ScenarioProgressStateSnapshot;
  };
}

export type SaveGame =
  | SaveGameV1
  | SaveGameV2
  | SaveGameV3
  | SaveGameV4
  | SaveGameV5
  | SaveGameV6
  | SaveGameV7
  | SaveGameV8;

export class SaveGameError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SaveGameError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSafeInteger(value: unknown, name: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new SaveGameError(`${name} must be a safe integer of at least ${minimum}`);
  }
  return value as number;
}

function readNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new SaveGameError(`${name} must be non-negative and finite`);
  }
  return value;
}

function readBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new SaveGameError(`${name} must be a boolean`);
  }
  return value;
}

function readFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SaveGameError(`${name} must be finite`);
  }
  return value;
}

function readPoint(value: unknown, name: string): Point {
  if (
    !isRecord(value) ||
    typeof value.x !== "number" ||
    !Number.isFinite(value.x) ||
    typeof value.y !== "number" ||
    !Number.isFinite(value.y)
  ) {
    throw new SaveGameError(`${name} must contain finite x and y coordinates`);
  }
  return Object.freeze({ x: value.x, y: value.y });
}

function readRoadSegment(value: unknown, index: number): RoadSegment {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    throw new SaveGameError(`road segment ${index} must have a non-empty id`);
  }
  const roadClass = value.roadClass ?? "arterial";
  if (roadClass !== "local" && roadClass !== "arterial" && roadClass !== "highway") {
    throw new SaveGameError(`road segment ${index} has an unknown road class`);
  }
  return Object.freeze({
    id: value.id,
    roadClass,
    start: readPoint(value.start, `road segment ${index} start`),
    end: readPoint(value.end, `road segment ${index} end`),
  });
}

function readRailTrack(value: unknown, index: number): RailTrackSegment {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    throw new SaveGameError(`rail track ${index} must have a non-empty id`);
  }
  return Object.freeze({
    id: value.id,
    start: readPoint(value.start, `rail track ${index} start`),
    end: readPoint(value.end, `rail track ${index} end`),
  });
}

function readRailTerminal(
  value: unknown,
  index: number,
): FreightRailTerminalState {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.siteId !== "string" ||
    value.siteId.length === 0 ||
    (value.site !== "quarry" &&
      value.site !== "stoneworks" &&
      value.site !== "market")
  ) {
    throw new SaveGameError(`rail terminal ${index} is invalid`);
  }
  return Object.freeze({
    id: value.id,
    site: value.site as RailTerminalSite,
    siteId: value.siteId,
  });
}

function readStringArray(value: unknown, name: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new SaveGameError(`${name} must contain non-empty strings`);
  }
  return Object.freeze([...value]);
}

function readNullableStringArray(
  value: unknown,
  name: string,
): readonly string[] | null {
  return value === null ? null : readStringArray(value, name);
}

function readLegacyRoadTrafficState(value: unknown): LegacyRoadTrafficStateV3 {
  if (!isRecord(value)) {
    throw new SaveGameError("road traffic state must be an object");
  }
  return Object.freeze({
    lastAssignmentTick: readSafeInteger(value.lastAssignmentTick, "road traffic lastAssignmentTick", 0),
    nextAssignmentTick: readSafeInteger(value.nextAssignmentTick, "road traffic nextAssignmentTick", 0),
    assignedFlowUnitsPerDay: readNumber(value.assignedFlowUnitsPerDay, "road traffic assignedFlowUnitsPerDay"),
    routeNodeIds: readNullableStringArray(value.routeNodeIds, "road traffic routeNodeIds"),
    routeLinkIds: readNullableStringArray(value.routeLinkIds, "road traffic routeLinkIds"),
  });
}

function readRoadTrafficFlow(
  value: unknown,
  index: number,
): RoadTrafficFlowStateSnapshot {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    throw new SaveGameError(`road traffic flow ${index} must have a non-empty id`);
  }
  return Object.freeze({
    id: value.id,
    assignedFlowUnitsPerDay: readNumber(
      value.assignedFlowUnitsPerDay,
      `road traffic flow ${index} assignedFlowUnitsPerDay`,
    ),
    routeNodeIds: readNullableStringArray(
      value.routeNodeIds,
      `road traffic flow ${index} routeNodeIds`,
    ),
    routeLinkIds: readNullableStringArray(
      value.routeLinkIds,
      `road traffic flow ${index} routeLinkIds`,
    ),
  });
}

function readRoadTrafficState(value: unknown): RoadTrafficStateSnapshot {
  if (!isRecord(value) || !Array.isArray(value.flows)) {
    throw new SaveGameError("road traffic state must contain flows");
  }
  return Object.freeze({
    lastAssignmentTick: readSafeInteger(value.lastAssignmentTick, "road traffic lastAssignmentTick", 0),
    nextAssignmentTick: readSafeInteger(value.nextAssignmentTick, "road traffic nextAssignmentTick", 0),
    flows: Object.freeze(value.flows.map(readRoadTrafficFlow)),
  });
}

function readFreightOperatorCandidate(
  value: unknown,
  name: string,
): FreightOperatorCandidateState {
  if (!isRecord(value) || (value.mode !== "road" && value.mode !== "rail")) {
    throw new SaveGameError(`${name} has an unknown mode`);
  }
  const nullableId = (entry: unknown, field: string): string | null => {
    if (entry === null) return null;
    if (typeof entry !== "string" || entry.length === 0) {
      throw new SaveGameError(`${name} ${field} must be a non-empty string or null`);
    }
    return entry;
  };
  return Object.freeze({
    mode: value.mode,
    nodeIds: readNullableStringArray(value.nodeIds, `${name} nodeIds`),
    linkIds: readNullableStringArray(value.linkIds, `${name} linkIds`),
    originRailTerminalId: nullableId(value.originRailTerminalId, "origin terminal"),
    destinationRailTerminalId: nullableId(value.destinationRailTerminalId, "destination terminal"),
    generalizedCostHours: value.generalizedCostHours === null
      ? null
      : readNumber(value.generalizedCostHours, `${name} generalizedCostHours`),
    capacityTonsPerDay: readNumber(value.capacityTonsPerDay, `${name} capacity`),
    freeFlowTravelTimeHours: value.freeFlowTravelTimeHours === null
      ? null
      : readNumber(value.freeFlowTravelTimeHours, `${name} freeFlowTravelTimeHours`),
    congestionDelayHours: readNumber(value.congestionDelayHours, `${name} congestionDelayHours`),
    terminalHandlingTimeHours: readNumber(value.terminalHandlingTimeHours, `${name} terminalHandlingTimeHours`),
    accessEgressTimeHours: readNumber(value.accessEgressTimeHours, `${name} accessEgressTimeHours`),
    priceAdjustmentHours: readNumber(value.priceAdjustmentHours, `${name} priceAdjustmentHours`),
  });
}

function readFreightOperatorState(value: unknown): FreightOperatorStateSnapshot {
  if (!isRecord(value) || !isRecord(value.pricing) || !Array.isArray(value.flows)) {
    throw new SaveGameError("freight operator state must contain pricing and flows");
  }
  return Object.freeze({
    lastAssignmentTick: readSafeInteger(value.lastAssignmentTick, "freight lastAssignmentTick", 0),
    nextAssignmentTick: readSafeInteger(value.nextAssignmentTick, "freight nextAssignmentTick", 1),
    pricing: Object.freeze({
      roadAdjustmentHours: readNumber(value.pricing.roadAdjustmentHours, "road price adjustment"),
      railAdjustmentHours: readNumber(value.pricing.railAdjustmentHours, "rail price adjustment"),
    }),
    flows: Object.freeze(value.flows.map((flow, index): FreightOperatorFlowStateSnapshot => {
      if (!isRecord(flow) || typeof flow.id !== "string" || !Array.isArray(flow.candidates) ||
          (flow.chosenMode !== null && flow.chosenMode !== "road" && flow.chosenMode !== "rail")) {
        throw new SaveGameError(`freight operator flow ${index} is invalid`);
      }
      return Object.freeze({
        id: flow.id,
        demandTonsPerDay: readNumber(flow.demandTonsPerDay, `freight flow ${index} demand`),
        assignedTonsPerDay: readNumber(flow.assignedTonsPerDay, `freight flow ${index} assigned`),
        chosenMode: flow.chosenMode,
        candidates: Object.freeze(flow.candidates.map((candidate, candidateIndex) =>
          readFreightOperatorCandidate(candidate, `freight flow ${index} candidate ${candidateIndex}`),
        )),
      });
    })),
  });
}

function readDevelopmentState(value: unknown): DevelopmentStateSnapshot {
  if (!isRecord(value) || !Array.isArray(value.locations) || !Array.isArray(value.pendingConstruction)) {
    throw new SaveGameError("development state must contain state arrays");
  }
  return Object.freeze({
    processedTick: readSafeInteger(value.processedTick, "development processedTick", 0),
    evaluationNumber: readSafeInteger(value.evaluationNumber, "development evaluationNumber", 0),
    lastEvaluationTick:
      value.lastEvaluationTick === null
        ? null
        : readSafeInteger(value.lastEvaluationTick, "development lastEvaluationTick", 0),
    nextEvaluationTick: readSafeInteger(value.nextEvaluationTick, "development nextEvaluationTick", 1),
    nextConstructionNumber: readSafeInteger(value.nextConstructionNumber, "development nextConstructionNumber", 1),
    locations: Object.freeze(
      value.locations.map((location, index) => {
        if (!isRecord(location) || typeof location.locationId !== "string" || location.locationId.length === 0) {
          throw new SaveGameError(`development location ${index} must have a non-empty id`);
        }
        return Object.freeze({
          locationId: location.locationId,
          growthPopulation: readSafeInteger(location.growthPopulation, `development location ${index} growthPopulation`, 0),
        });
      }),
    ),
    pendingConstruction: Object.freeze(
      value.pendingConstruction.map((project, index) => {
        if (
          !isRecord(project) ||
          typeof project.id !== "string" ||
          project.id.length === 0 ||
          typeof project.locationId !== "string" ||
          project.locationId.length === 0
        ) {
          throw new SaveGameError(`pending construction ${index} must have non-empty ids`);
        }
        return Object.freeze({
          id: project.id,
          locationId: project.locationId,
          population: readSafeInteger(project.population, `pending construction ${index} population`, 1),
          startedTick: readSafeInteger(project.startedTick, `pending construction ${index} startedTick`, 0),
          completesTick: readSafeInteger(project.completesTick, `pending construction ${index} completesTick`, 1),
        });
      }),
    ),
  });
}

function readFreightFactor(value: unknown, name: string): FreightLimitingFactor {
  if (
    value !== "no-route" &&
    value !== "route-cost" &&
    value !== "production" &&
    value !== "input-storage" &&
    value !== "inventory" &&
    value !== "market-demand"
  ) {
    throw new SaveGameError(`${name} is unknown`);
  }
  return value;
}

function readStoneworksFactor(value: unknown): StoneworksLimitingFactor {
  if (value !== "input-shortage" && value !== "processing-capacity" && value !== "output-storage") {
    throw new SaveGameError("stoneworks limiting factor is unknown");
  }
  return value;
}

function readSupplyChainState(value: unknown): StoneSupplyChainStateSnapshot {
  if (!isRecord(value)) {
    throw new SaveGameError("supply-chain state must be an object");
  }
  return Object.freeze({
    processedTick: readSafeInteger(value.processedTick, "supply-chain processedTick", 0),
    lastUpdateTick:
      value.lastUpdateTick === null
        ? null
        : readSafeInteger(value.lastUpdateTick, "supply-chain lastUpdateTick", 0),
    nextUpdateTick: readSafeInteger(value.nextUpdateTick, "supply-chain nextUpdateTick", 1),
    inputInventoryTons: readNumber(value.inputInventoryTons, "supply-chain inputInventoryTons"),
    finishedStoneInventoryTons: readNumber(value.finishedStoneInventoryTons, "supply-chain finishedStoneInventoryTons"),
    inboundAvailableTonsPerDay: readNumber(value.inboundAvailableTonsPerDay, "supply-chain inboundAvailableTonsPerDay"),
    inboundRequestedTonsPerDay: readNumber(value.inboundRequestedTonsPerDay, "supply-chain inboundRequestedTonsPerDay"),
    inboundShippedTonsPerDay: readNumber(value.inboundShippedTonsPerDay, "supply-chain inboundShippedTonsPerDay"),
    inboundLimitingFactor: readFreightFactor(value.inboundLimitingFactor, "inbound limiting factor"),
    processedTonsPerDay: readNumber(value.processedTonsPerDay, "supply-chain processedTonsPerDay"),
    stoneworksLimitingFactor: readStoneworksFactor(value.stoneworksLimitingFactor),
    outboundAvailableTonsPerDay: readNumber(value.outboundAvailableTonsPerDay, "supply-chain outboundAvailableTonsPerDay"),
    outboundRequestedTonsPerDay: readNumber(value.outboundRequestedTonsPerDay, "supply-chain outboundRequestedTonsPerDay"),
    outboundShippedTonsPerDay: readNumber(value.outboundShippedTonsPerDay, "supply-chain outboundShippedTonsPerDay"),
    outboundLimitingFactor: readFreightFactor(value.outboundLimitingFactor, "outbound limiting factor"),
  });
}

function readInfrastructureCostBreakdown(
  value: unknown,
): InfrastructureCostBreakdown {
  if (!isRecord(value)) {
    throw new SaveGameError("infrastructure cost breakdown must be an object");
  }
  if (value.infrastructureKind !== "road" && value.infrastructureKind !== "rail") {
    throw new SaveGameError("infrastructure cost breakdown has an unknown kind");
  }
  if (
    value.transactionKind !== "construction" &&
    value.transactionKind !== "upgrade" &&
    value.transactionKind !== "removal"
  ) {
    throw new SaveGameError("infrastructure transaction has an unknown kind");
  }
  if (
    typeof value.infrastructureClass !== "string" ||
    value.infrastructureClass.length === 0
  ) {
    throw new SaveGameError("infrastructure transaction must name its class");
  }
  return Object.freeze({
    infrastructureKind: value.infrastructureKind,
    transactionKind: value.transactionKind,
    infrastructureClass: value.infrastructureClass,
    length: readNumber(value.length, "infrastructure length"),
    baseCost: readNumber(value.baseCost, "infrastructure baseCost"),
    landAcquisitionCost: readNumber(
      value.landAcquisitionCost,
      "infrastructure landAcquisitionCost",
    ),
    crossingWorkCost: readNumber(
      value.crossingWorkCost,
      "infrastructure crossingWorkCost",
    ),
    totalCost: readNumber(value.totalCost, "infrastructure totalCost"),
    salvageCredit: readNumber(
      value.salvageCredit,
      "infrastructure salvageCredit",
    ),
    netCost: readFiniteNumber(value.netCost, "infrastructure netCost"),
    affectedLandIds: readStringArray(
      value.affectedLandIds,
      "infrastructure affectedLandIds",
    ),
    riverCrossingCount: readSafeInteger(
      value.riverCrossingCount,
      "infrastructure riverCrossingCount",
      0,
    ),
  });
}

function readFinanceState(value: unknown): FinanceStateSnapshot {
  if (!isRecord(value)) {
    throw new SaveGameError("finance state must be an object");
  }
  const lastTransaction = value.lastInfrastructureTransaction;
  if (lastTransaction !== null && !isRecord(lastTransaction)) {
    throw new SaveGameError("last infrastructure transaction must be an object or null");
  }
  let parsedLastTransaction: FinanceStateSnapshot["lastInfrastructureTransaction"] =
    null;
  if (lastTransaction) {
    if (lastTransaction.affordable !== true) {
      throw new SaveGameError("committed transaction must be affordable");
    }
    parsedLastTransaction = Object.freeze({
      tick: readSafeInteger(lastTransaction.tick, "transaction tick", 0),
      breakdown: readInfrastructureCostBreakdown(lastTransaction.breakdown),
      balanceBefore: readFiniteNumber(
        lastTransaction.balanceBefore,
        "transaction balanceBefore",
      ),
      balanceAfter: readFiniteNumber(
        lastTransaction.balanceAfter,
        "transaction balanceAfter",
      ),
      affordable: true,
    });
  }
  return Object.freeze({
    processedTick: readSafeInteger(value.processedTick, "finance processedTick", 0),
    balance: readFiniteNumber(value.balance, "finance balance"),
    totalCapitalSpending: readNumber(
      value.totalCapitalSpending,
      "finance totalCapitalSpending",
    ),
    totalOperatingRevenue: readNumber(
      value.totalOperatingRevenue,
      "finance totalOperatingRevenue",
    ),
    totalMaintenancePaid: readNumber(
      value.totalMaintenancePaid,
      "finance totalMaintenancePaid",
    ),
    totalSalvageRevenue: readNumber(
      value.totalSalvageRevenue,
      "finance totalSalvageRevenue",
    ),
    lastDailyRevenue: readNumber(
      value.lastDailyRevenue,
      "finance lastDailyRevenue",
    ),
    lastDailyMaintenance: readNumber(
      value.lastDailyMaintenance,
      "finance lastDailyMaintenance",
    ),
    emergencyBondCount: readSafeInteger(
      value.emergencyBondCount,
      "finance emergencyBondCount",
      0,
    ),
    totalEmergencyPenalties: readNumber(
      value.totalEmergencyPenalties,
      "finance totalEmergencyPenalties",
    ),
    lastInfrastructureTransaction: parsedLastTransaction,
  });
}

function readScenarioEnding(value: unknown): ScenarioEndingSummary | null {
  if (value === null) return null;
  if (!isRecord(value) || !Array.isArray(value.accessibilityChanges)) {
    throw new SaveGameError("scenario ending must contain accessibility changes");
  }
  if (
    value.intervention !== "bridge-upgrade" &&
    value.intervention !== "road-bypass" &&
    value.intervention !== "rail-shift" &&
    value.intervention !== "combined"
  ) {
    throw new SaveGameError("scenario ending has an unknown intervention");
  }
  if (
    value.bridgeStatus !== "relieved" &&
    value.bridgeStatus !== "unused" &&
    value.bridgeStatus !== "removed"
  ) {
    throw new SaveGameError("scenario ending has an unknown bridge status");
  }
  const accessibilityChanges = value.accessibilityChanges.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.locationId !== "string" ||
      typeof entry.name !== "string"
    ) {
      throw new SaveGameError("scenario accessibility change is invalid");
    }
    return Object.freeze({
      locationId: entry.locationId,
      name: entry.name,
      initialScore: readNumber(entry.initialScore, "initial accessibility score"),
      finalScore: readNumber(entry.finalScore, "final accessibility score"),
      change: readFiniteNumber(entry.change, "accessibility score change"),
    });
  });
  return Object.freeze({
    completedTick: readSafeInteger(value.completedTick, "scenario completedTick", 0),
    intervention: value.intervention,
    totalCapitalSpending: readNumber(value.totalCapitalSpending, "ending capital spending"),
    totalMaintenancePaid: readNumber(value.totalMaintenancePaid, "ending maintenance paid"),
    dailyMaintenance: readNumber(value.dailyMaintenance, "ending daily maintenance"),
    roadFreightTonsPerDay: readNumber(value.roadFreightTonsPerDay, "ending road freight"),
    railFreightTonsPerDay: readNumber(value.railFreightTonsPerDay, "ending rail freight"),
    roadFreightShare: readNumber(value.roadFreightShare, "ending road freight share"),
    railFreightShare: readNumber(value.railFreightShare, "ending rail freight share"),
    bridgeStatus: value.bridgeStatus,
    bridgeAssignedTonsPerDay: readNumber(value.bridgeAssignedTonsPerDay, "ending bridge assignment"),
    bridgeCapacityTonsPerDay: readNumber(value.bridgeCapacityTonsPerDay, "ending bridge capacity"),
    accessibilityChanges: Object.freeze(accessibilityChanges),
  });
}

function readScenarioProgressState(value: unknown): ScenarioProgressStateSnapshot {
  if (!isRecord(value)) {
    throw new SaveGameError("scenario progress state must be an object");
  }
  return Object.freeze({
    processedTick: readSafeInteger(value.processedTick, "scenario progress processedTick", 0),
    inspectedEntityIds: readStringArray(value.inspectedEntityIds, "scenario inspectedEntityIds"),
    supplyChainActivated: readBoolean(value.supplyChainActivated, "scenario supplyChainActivated"),
    bridgeOverloadObserved: readBoolean(value.bridgeOverloadObserved, "scenario bridgeOverloadObserved"),
    interventionCompleted: readBoolean(value.interventionCompleted, "scenario interventionCompleted"),
    successfulDays: readSafeInteger(value.successfulDays, "scenario successfulDays", 0),
    lastEvaluatedDayTick: readSafeInteger(value.lastEvaluatedDayTick, "scenario lastEvaluatedDayTick", 0),
    ending: readScenarioEnding(value.ending),
  });
}

export function validateSaveGame(value: unknown): SaveGame {
  if (!isRecord(value)) {
    throw new SaveGameError("save data must be an object");
  }
  if (value.formatVersion !== 1 && value.formatVersion !== 2 && value.formatVersion !== 3 && value.formatVersion !== 4 && value.formatVersion !== 5 && value.formatVersion !== 6 && value.formatVersion !== 7 && value.formatVersion !== SAVE_FORMAT_VERSION) {
    throw new SaveGameError(`unsupported save format version: ${String(value.formatVersion)}`);
  }
  if (value.scenarioId !== "millford-valley") {
    throw new SaveGameError(`unsupported scenario: ${String(value.scenarioId)}`);
  }
  if (typeof value.scenarioSeed !== "string" || !isRecord(value.simulation) || !Array.isArray(value.simulation.roadSegments)) {
    throw new SaveGameError("save must contain a scenario seed and simulation state");
  }
  const simulation = Object.freeze({
    tick: readSafeInteger(value.simulation.tick, "simulation tick", 0),
    roadSegments: Object.freeze(value.simulation.roadSegments.map(readRoadSegment)),
    nextRoadSegmentNumber: readSafeInteger(value.simulation.nextRoadSegmentNumber, "nextRoadSegmentNumber", 1),
  });
  if (value.formatVersion === 1) {
    return Object.freeze({ formatVersion: 1, scenarioId: "millford-valley", scenarioSeed: value.scenarioSeed, simulation });
  }
  const development = readDevelopmentState(value.simulation.development);
  if (value.formatVersion === 2) {
    return Object.freeze({ formatVersion: 2, scenarioId: "millford-valley", scenarioSeed: value.scenarioSeed, simulation: Object.freeze({ ...simulation, development }) });
  }
  if (value.formatVersion === 3) {
    return Object.freeze({
      formatVersion: 3,
      scenarioId: "millford-valley",
      scenarioSeed: value.scenarioSeed,
      simulation: Object.freeze({
        ...simulation,
        development,
        roadTraffic: readLegacyRoadTrafficState(value.simulation.roadTraffic),
      }),
    });
  }
  const supplyChain = readSupplyChainState(value.simulation.supplyChain);
  const roadTraffic = value.formatVersion <= 6
    ? readRoadTrafficState(value.simulation.roadTraffic)
    : undefined;
  if (value.formatVersion === 4) {
    return Object.freeze({
      formatVersion: 4,
      scenarioId: "millford-valley",
      scenarioSeed: value.scenarioSeed,
      simulation: Object.freeze({
        ...simulation,
        development,
        supplyChain,
        roadTraffic: roadTraffic!,
      }),
    });
  }
  const finances = readFinanceState(value.simulation.finances);
  if (value.formatVersion === 5) {
    return Object.freeze({
      formatVersion: 5,
      scenarioId: "millford-valley",
      scenarioSeed: value.scenarioSeed,
      simulation: Object.freeze({
        ...simulation,
        development,
        supplyChain,
        roadTraffic: roadTraffic!,
        finances,
      }),
    });
  }
  if (
    !Array.isArray(value.simulation.railTracks) ||
    !Array.isArray(value.simulation.railTerminals)
  ) {
    throw new SaveGameError("version 6 save must contain rail state arrays");
  }
  const railState = {
    railTracks: Object.freeze(value.simulation.railTracks.map(readRailTrack)),
    railTerminals: Object.freeze(
      value.simulation.railTerminals.map(readRailTerminal),
    ),
    nextRailTrackNumber: readSafeInteger(
      value.simulation.nextRailTrackNumber,
      "nextRailTrackNumber",
      1,
    ),
  };
  if (value.formatVersion === 6) return Object.freeze({
    formatVersion: 6,
    scenarioId: "millford-valley",
    scenarioSeed: value.scenarioSeed,
    simulation: Object.freeze({
      ...simulation,
      development,
      supplyChain,
      roadTraffic: roadTraffic!,
      finances,
      ...railState,
    }),
  });
  const freightOperators = readFreightOperatorState(
    value.simulation.freightOperators,
  );
  if (value.formatVersion === 7) return Object.freeze({
    formatVersion: 7,
    scenarioId: "millford-valley",
    scenarioSeed: value.scenarioSeed,
    simulation: Object.freeze({
      ...simulation,
      development,
      supplyChain,
      finances,
      ...railState,
      freightOperators,
    }),
  });
  return Object.freeze({
    formatVersion: SAVE_FORMAT_VERSION,
    scenarioId: "millford-valley",
    scenarioSeed: value.scenarioSeed,
    simulation: Object.freeze({
      ...simulation,
      development,
      supplyChain,
      finances,
      ...railState,
      freightOperators,
      scenarioProgress: readScenarioProgressState(
        value.simulation.scenarioProgress,
      ),
    }),
  });
}

export function createSaveGame(simulation: Simulation): SaveGameV8 {
  const state = simulation.getState();
  if (!state.development || !state.freightOperators || !state.supplyChain || !state.finances || !state.railTracks || !state.railTerminals || !state.nextRailTrackNumber || !state.scenarioProgress) {
    throw new SaveGameError("simulation did not provide complete authoritative state");
  }
  return validateSaveGame({
    formatVersion: SAVE_FORMAT_VERSION,
    scenarioId: "millford-valley",
    scenarioSeed: state.seed,
    simulation: {
      tick: state.tick,
      roadSegments: state.roadSegments,
      nextRoadSegmentNumber: state.nextRoadSegmentNumber,
      railTracks: state.railTracks,
      railTerminals: state.railTerminals,
      nextRailTrackNumber: state.nextRailTrackNumber,
      development: state.development,
      supplyChain: state.supplyChain,
      freightOperators: state.freightOperators,
      finances: state.finances,
      scenarioProgress: state.scenarioProgress,
    },
  }) as SaveGameV8;
}

export function restoreSaveGame(save: SaveGame): Simulation {
  const validated = validateSaveGame(save);
  const state: SimulationStateSnapshot = {
    seed: validated.scenarioSeed,
    tick: validated.simulation.tick,
    roadSegments: validated.simulation.roadSegments.map((segment) => ({
      ...segment,
      roadClass: segment.roadClass ?? "arterial",
    })),
    nextRoadSegmentNumber: validated.simulation.nextRoadSegmentNumber,
    railTracks:
      validated.formatVersion === 6 || validated.formatVersion === 7 || validated.formatVersion === 8
        ? validated.simulation.railTracks
        : [],
    railTerminals:
      validated.formatVersion === 6 || validated.formatVersion === 7 || validated.formatVersion === 8
        ? validated.simulation.railTerminals
        : [],
    nextRailTrackNumber:
      validated.formatVersion === 6 || validated.formatVersion === 7 || validated.formatVersion === 8
        ? validated.simulation.nextRailTrackNumber
        : 1,
    development: validated.formatVersion !== 1 ? validated.simulation.development : undefined,
    supplyChain:
      validated.formatVersion === 4 || validated.formatVersion === 5 || validated.formatVersion === 6 || validated.formatVersion === 7 || validated.formatVersion === 8
        ? validated.simulation.supplyChain
        : undefined,
    roadTraffic:
      validated.formatVersion === 4 || validated.formatVersion === 5 || validated.formatVersion === 6
        ? validated.simulation.roadTraffic
        : undefined,
    freightOperators:
      validated.formatVersion === 7 || validated.formatVersion === 8
        ? validated.simulation.freightOperators
        : undefined,
    finances:
      validated.formatVersion === 5 || validated.formatVersion === 6 || validated.formatVersion === 7 || validated.formatVersion === 8
        ? validated.simulation.finances
        : undefined,
    scenarioProgress:
      validated.formatVersion === SAVE_FORMAT_VERSION
        ? validated.simulation.scenarioProgress
        : undefined,
  };
  try {
    return restoreSimulation(state);
  } catch (error) {
    throw new SaveGameError("save contains invalid simulation state", { cause: error });
  }
}

export function serializeSaveGame(save: SaveGame): string {
  return `${JSON.stringify(validateSaveGame(save), null, 2)}\n`;
}

export function deserializeSaveGame(contents: string): SaveGame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new SaveGameError("save file is not valid JSON", { cause: error });
  }
  return validateSaveGame(parsed);
}

export function createSaveFile(save: SaveGame): Blob {
  return new Blob([serializeSaveGame(save)], { type: "application/json" });
}

export async function readSaveFile(file: Blob): Promise<SaveGame> {
  return deserializeSaveGame(await file.text());
}

export function downloadSaveFile(
  save: SaveGame,
  documentObject: Document = document,
  urlObject: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL,
): void {
  const objectUrl = urlObject.createObjectURL(createSaveFile(save));
  const anchor = documentObject.createElement("a");
  anchor.href = objectUrl;
  anchor.download = SAVE_FILE_NAME;
  anchor.hidden = true;
  documentObject.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => urlObject.revokeObjectURL(objectUrl), 0);
}
