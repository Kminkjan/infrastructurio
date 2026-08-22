import {
  restoreSimulation,
  type DevelopmentStateSnapshot,
  type Simulation,
  type SimulationStateSnapshot,
} from "../simulation";
import type { Point, RoadSegment } from "../shared";

export const SAVE_FORMAT_VERSION = 2 as const;
export const SAVE_FILE_NAME = "millford-valley-save.json";

export interface SaveGameV1 {
  readonly formatVersion: 1;
  readonly scenarioId: "millford-valley";
  readonly scenarioSeed: string;
  readonly simulation: {
    readonly tick: number;
    readonly roadSegments: readonly RoadSegment[];
    readonly nextRoadSegmentNumber: number;
  };
}

export interface SaveGameV2 {
  readonly formatVersion: typeof SAVE_FORMAT_VERSION;
  readonly scenarioId: "millford-valley";
  readonly scenarioSeed: string;
  readonly simulation: {
    readonly tick: number;
    readonly roadSegments: readonly RoadSegment[];
    readonly nextRoadSegmentNumber: number;
    readonly development: DevelopmentStateSnapshot;
  };
}

export type SaveGame = SaveGameV1 | SaveGameV2;

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

  return Object.freeze({
    id: value.id,
    start: readPoint(value.start, `road segment ${index} start`),
    end: readPoint(value.end, `road segment ${index} end`),
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

  return Object.freeze({
    formatVersion: SAVE_FORMAT_VERSION,
    scenarioId: "millford-valley",
    scenarioSeed: value.scenarioSeed,
    simulation: Object.freeze({
      ...simulation,
      development: readDevelopmentState(value.simulation.development),
    }),
  });
}

export function createSaveGame(simulation: Simulation): SaveGameV2 {
  const state = simulation.getState();
  if (!state.development) {
    throw new SaveGameError("simulation did not provide development state");
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
    },
  }) as SaveGameV2;
}

export function restoreSaveGame(save: SaveGame): Simulation {
  const validated = validateSaveGame(save);
  const state: SimulationStateSnapshot = {
    seed: validated.scenarioSeed,
    tick: validated.simulation.tick,
    roadSegments: validated.simulation.roadSegments,
    nextRoadSegmentNumber: validated.simulation.nextRoadSegmentNumber,
    development:
      validated.formatVersion === SAVE_FORMAT_VERSION
        ? validated.simulation.development
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
