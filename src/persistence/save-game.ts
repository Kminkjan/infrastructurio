import {
  restoreSimulation,
  type DevelopmentStateSnapshot,
  type RoadTrafficStateSnapshot,
  type Simulation,
  type SimulationStateSnapshot,
} from "../simulation";
import type { Point, RoadClass, RoadSegment } from "../shared";

export const SAVE_FORMAT_VERSION = 3 as const;
export const SAVE_FILE_NAME = "millford-valley-save.json";

interface SavedRoadSegment {
  readonly id: string;
  readonly roadClass?: RoadClass;
  readonly start: Point;
  readonly end: Point;
}

export interface SaveGameV1 {
  readonly formatVersion: 1;
  readonly scenarioId: "millford-valley";
  readonly scenarioSeed: string;
  readonly simulation: {
    readonly tick: number;
    readonly roadSegments: readonly SavedRoadSegment[];
    readonly nextRoadSegmentNumber: number;
  };
}

export interface SaveGameV2 {
  readonly formatVersion: 2;
  readonly scenarioId: "millford-valley";
  readonly scenarioSeed: string;
  readonly simulation: {
    readonly tick: number;
    readonly roadSegments: readonly SavedRoadSegment[];
    readonly nextRoadSegmentNumber: number;
    readonly development: DevelopmentStateSnapshot;
  };
}

export interface SaveGameV3 {
  readonly formatVersion: typeof SAVE_FORMAT_VERSION;
  readonly scenarioId: "millford-valley";
  readonly scenarioSeed: string;
  readonly simulation: {
    readonly tick: number;
    readonly roadSegments: readonly RoadSegment[];
    readonly nextRoadSegmentNumber: number;
    readonly development: DevelopmentStateSnapshot;
    readonly roadTraffic: RoadTrafficStateSnapshot;
  };
}

export type SaveGame = SaveGameV1 | SaveGameV2 | SaveGameV3;

export class SaveGameError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SaveGameError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSafeInteger(
  value: unknown,
  name: string,
  minimum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new SaveGameError(
      `${name} must be a safe integer of at least ${minimum}`,
    );
  }

  return value as number;
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
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length === 0
  ) {
    throw new SaveGameError(`road segment ${index} must have a non-empty id`);
  }

  const roadClass = value.roadClass ?? "arterial";
  if (
    roadClass !== "local" &&
    roadClass !== "arterial" &&
    roadClass !== "highway"
  ) {
    throw new SaveGameError(`road segment ${index} has an unknown road class`);
  }

  return Object.freeze({
    id: value.id,
    roadClass,
    start: readPoint(value.start, `road segment ${index} start`),
    end: readPoint(value.end, `road segment ${index} end`),
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

function readRoadTrafficState(value: unknown): RoadTrafficStateSnapshot {
  if (!isRecord(value)) {
    throw new SaveGameError("road traffic state must be an object");
  }
  const routeNodeIds =
    value.routeNodeIds === null
      ? null
      : readStringArray(value.routeNodeIds, "road traffic routeNodeIds");
  const routeLinkIds =
    value.routeLinkIds === null
      ? null
      : readStringArray(value.routeLinkIds, "road traffic routeLinkIds");
  if (
    typeof value.assignedFlowUnitsPerDay !== "number" ||
    !Number.isFinite(value.assignedFlowUnitsPerDay) ||
    value.assignedFlowUnitsPerDay < 0
  ) {
    throw new SaveGameError(
      "road traffic assignedFlowUnitsPerDay must be non-negative and finite",
    );
  }
  return Object.freeze({
    lastAssignmentTick: readSafeInteger(
      value.lastAssignmentTick,
      "road traffic lastAssignmentTick",
      0,
    ),
    nextAssignmentTick: readSafeInteger(
      value.nextAssignmentTick,
      "road traffic nextAssignmentTick",
      0,
    ),
    assignedFlowUnitsPerDay: value.assignedFlowUnitsPerDay,
    routeNodeIds,
    routeLinkIds,
  });
}

function readDevelopmentState(value: unknown): DevelopmentStateSnapshot {
  if (
    !isRecord(value) ||
    !Array.isArray(value.locations) ||
    !Array.isArray(value.pendingConstruction)
  ) {
    throw new SaveGameError("development state must contain state arrays");
  }

  const lastEvaluationTick =
    value.lastEvaluationTick === null
      ? null
      : readSafeInteger(
          value.lastEvaluationTick,
          "development lastEvaluationTick",
          0,
        );
  return Object.freeze({
    processedTick: readSafeInteger(
      value.processedTick,
      "development processedTick",
      0,
    ),
    evaluationNumber: readSafeInteger(
      value.evaluationNumber,
      "development evaluationNumber",
      0,
    ),
    lastEvaluationTick,
    nextEvaluationTick: readSafeInteger(
      value.nextEvaluationTick,
      "development nextEvaluationTick",
      1,
    ),
    nextConstructionNumber: readSafeInteger(
      value.nextConstructionNumber,
      "development nextConstructionNumber",
      1,
    ),
    locations: Object.freeze(
      value.locations.map((location, index) => {
        if (
          !isRecord(location) ||
          typeof location.locationId !== "string" ||
          location.locationId.length === 0
        ) {
          throw new SaveGameError(
            `development location ${index} must have a non-empty id`,
          );
        }
        return Object.freeze({
          locationId: location.locationId,
          growthPopulation: readSafeInteger(
            location.growthPopulation,
            `development location ${index} growthPopulation`,
            0,
          ),
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
          throw new SaveGameError(
            `pending construction ${index} must have non-empty ids`,
          );
        }
        return Object.freeze({
          id: project.id,
          locationId: project.locationId,
          population: readSafeInteger(
            project.population,
            `pending construction ${index} population`,
            1,
          ),
          startedTick: readSafeInteger(
            project.startedTick,
            `pending construction ${index} startedTick`,
            0,
          ),
          completesTick: readSafeInteger(
            project.completesTick,
            `pending construction ${index} completesTick`,
            1,
          ),
        });
      }),
    ),
  });
}

export function validateSaveGame(value: unknown): SaveGame {
  if (!isRecord(value)) {
    throw new SaveGameError("save data must be an object");
  }
  if (
    value.formatVersion !== 1 &&
    value.formatVersion !== 2 &&
    value.formatVersion !== SAVE_FORMAT_VERSION
  ) {
    throw new SaveGameError(
      `unsupported save format version: ${String(value.formatVersion)}`,
    );
  }
  if (value.scenarioId !== "millford-valley") {
    throw new SaveGameError(`unsupported scenario: ${String(value.scenarioId)}`);
  }
  if (typeof value.scenarioSeed !== "string") {
    throw new SaveGameError("scenarioSeed must be a string");
  }
  if (!isRecord(value.simulation)) {
    throw new SaveGameError("simulation state must be an object");
  }
  if (!Array.isArray(value.simulation.roadSegments)) {
    throw new SaveGameError("simulation roadSegments must be an array");
  }

  const simulation = Object.freeze({
    tick: readSafeInteger(value.simulation.tick, "simulation tick", 0),
    roadSegments: Object.freeze(
      value.simulation.roadSegments.map(readRoadSegment),
    ),
    nextRoadSegmentNumber: readSafeInteger(
      value.simulation.nextRoadSegmentNumber,
      "nextRoadSegmentNumber",
      1,
    ),
  });
  if (value.formatVersion === 1) {
    return Object.freeze({
      formatVersion: 1,
      scenarioId: "millford-valley",
      scenarioSeed: value.scenarioSeed,
      simulation,
    });
  }

  const development = readDevelopmentState(value.simulation.development);
  if (value.formatVersion === 2) {
    return Object.freeze({
      formatVersion: 2,
      scenarioId: "millford-valley",
      scenarioSeed: value.scenarioSeed,
      simulation: Object.freeze({ ...simulation, development }),
    });
  }

  return Object.freeze({
    formatVersion: 3,
    scenarioId: "millford-valley",
    scenarioSeed: value.scenarioSeed,
    simulation: Object.freeze({
      ...simulation,
      development,
      roadTraffic: readRoadTrafficState(value.simulation.roadTraffic),
    }),
  });
}

export function createSaveGame(simulation: Simulation): SaveGameV3 {
  const state = simulation.getState();
  if (!state.development || !state.roadTraffic) {
    throw new SaveGameError(
      "simulation did not provide development and road traffic state",
    );
  }

  return validateSaveGame({
    formatVersion: SAVE_FORMAT_VERSION,
    scenarioId: "millford-valley",
    scenarioSeed: state.seed,
    simulation: {
      tick: state.tick,
      roadSegments: state.roadSegments,
      nextRoadSegmentNumber: state.nextRoadSegmentNumber,
      development: state.development,
      roadTraffic: state.roadTraffic,
    },
  }) as SaveGameV3;
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
    development:
      validated.formatVersion !== 1
        ? validated.simulation.development
        : undefined,
    roadTraffic:
      validated.formatVersion === SAVE_FORMAT_VERSION
        ? validated.simulation.roadTraffic
        : undefined,
  };

  try {
    return restoreSimulation(state);
  } catch (error) {
    throw new SaveGameError("save contains invalid simulation state", {
      cause: error,
    });
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
  return new Blob([serializeSaveGame(save)], {
    type: "application/json",
  });
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
