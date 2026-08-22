import {
  restoreSimulation,
  type Simulation,
  type SimulationStateSnapshot,
} from "../simulation";
import type { Point, RoadSegment } from "../shared";

export const SAVE_FORMAT_VERSION = 1 as const;
export const SAVE_FILE_NAME = "millford-valley-save.json";

export interface SaveGameV1 {
  readonly formatVersion: typeof SAVE_FORMAT_VERSION;
  readonly scenarioId: "millford-valley";
  readonly scenarioSeed: string;
  readonly simulation: {
    readonly tick: number;
    readonly roadSegments: readonly RoadSegment[];
    readonly nextRoadSegmentNumber: number;
  };
}

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

export function validateSaveGame(value: unknown): SaveGameV1 {
  if (!isRecord(value)) {
    throw new SaveGameError("save data must be an object");
  }
  if (value.formatVersion !== SAVE_FORMAT_VERSION) {
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

  return Object.freeze({
    formatVersion: SAVE_FORMAT_VERSION,
    scenarioId: "millford-valley",
    scenarioSeed: value.scenarioSeed,
    simulation: Object.freeze({
      tick: readSafeInteger(value.simulation.tick, "simulation tick", 0),
      roadSegments: Object.freeze(
        value.simulation.roadSegments.map(readRoadSegment),
      ),
      nextRoadSegmentNumber: readSafeInteger(
        value.simulation.nextRoadSegmentNumber,
        "nextRoadSegmentNumber",
        1,
      ),
    }),
  });
}

export function createSaveGame(simulation: Simulation): SaveGameV1 {
  const state = simulation.getState();

  return validateSaveGame({
    formatVersion: SAVE_FORMAT_VERSION,
    scenarioId: "millford-valley",
    scenarioSeed: state.seed,
    simulation: {
      tick: state.tick,
      roadSegments: state.roadSegments,
      nextRoadSegmentNumber: state.nextRoadSegmentNumber,
    },
  });
}

export function restoreSaveGame(save: SaveGameV1): Simulation {
  const validated = validateSaveGame(save);
  const state: SimulationStateSnapshot = {
    seed: validated.scenarioSeed,
    tick: validated.simulation.tick,
    roadSegments: validated.simulation.roadSegments,
    nextRoadSegmentNumber: validated.simulation.nextRoadSegmentNumber,
  };

  try {
    return restoreSimulation(state);
  } catch (error) {
    throw new SaveGameError("save contains invalid simulation state", {
      cause: error,
    });
  }
}

export function serializeSaveGame(save: SaveGameV1): string {
  return `${JSON.stringify(validateSaveGame(save), null, 2)}\n`;
}

export function deserializeSaveGame(contents: string): SaveGameV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new SaveGameError("save file is not valid JSON", { cause: error });
  }

  return validateSaveGame(parsed);
}

export function createSaveFile(save: SaveGameV1): Blob {
  return new Blob([serializeSaveGame(save)], {
    type: "application/json",
  });
}

export async function readSaveFile(file: Blob): Promise<SaveGameV1> {
  return deserializeSaveGame(await file.text());
}

export function downloadSaveFile(
  save: SaveGameV1,
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
