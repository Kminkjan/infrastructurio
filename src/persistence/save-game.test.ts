// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createSimulation } from "../simulation";
import {
  SAVE_FORMAT_VERSION,
  SAVE_FILE_NAME,
  SaveGameError,
  createSaveFile,
  createSaveGame,
  deserializeSaveGame,
  downloadSaveFile,
  readSaveFile,
  restoreSaveGame,
  serializeSaveGame,
} from ".";

function createConnectedSimulation() {
  const simulation = createSimulation("save-round-trip");
  const geography = simulation.getSnapshot().geography;
  simulation.dispatch({
    type: "build-road",
    start: geography.quarry.position,
    end: geography.externalMarketConnection.position,
  });
  simulation.dispatch({
    type: "build-road",
    start: { x: 0, y: 0 },
    end: { x: 20, y: 0 },
  });
  simulation.dispatch({
    type: "remove-road",
    roadSegmentId: "road-segment-2",
  });
  simulation.dispatch({ type: "advance", ticks: 24 * 17 });
  return simulation;
}

describe("save games", () => {
  it("round-trips roads, time, economic state, and future road ids", () => {
    const original = createConnectedSimulation();
    const before = original.getSnapshot();

    const save = deserializeSaveGame(
      serializeSaveGame(createSaveGame(original)),
    );
    const restored = restoreSaveGame(save);
    const after = restored.getSnapshot();

    expect(save).toMatchObject({
      formatVersion: SAVE_FORMAT_VERSION,
      scenarioId: "millford-valley",
      scenarioSeed: "save-round-trip",
      simulation: {
        tick: 24 * 17,
        nextRoadSegmentNumber: 3,
      },
    });
    expect(after.roadNetwork).toEqual(before.roadNetwork);
    expect(after.tick).toBe(before.tick);
    expect(after.elapsedDays).toBe(before.elapsedDays);
    expect(after.quarryMarketFreight).toEqual(before.quarryMarketFreight);
    expect(after.accessibility.locations).toEqual(
      before.accessibility.locations,
    );
    expect(after.development).toEqual(before.development);
    expect(after.quarryMarketFreight.shippedTonsPerDay).toBeGreaterThan(0);

    const continued = restored.dispatch({
      type: "build-road",
      start: { x: 0, y: 20 },
      end: { x: 20, y: 20 },
    });
    expect(continued.roadNetwork.segments.at(-1)?.id).toBe("road-segment-3");
  });

  it("preserves completed and pending development for deterministic continuation", () => {
    const original = createSimulation("save-development");
    const geography = original.getSnapshot().geography;
    original.dispatch({
      type: "build-road",
      start: geography.settlementSeeds[0]!.position,
      end: geography.externalMarketConnection.position,
    });
    original.dispatch({ type: "advance", ticks: 24 * 14 });

    const restored = restoreSaveGame(createSaveGame(original));
    expect(restored.getSnapshot().development).toEqual(
      original.getSnapshot().development,
    );
    expect(restored.getState().development).toEqual(
      original.getState().development,
    );

    const command = { type: "advance", ticks: 24 * 7 } as const;
    expect(restored.dispatch(command).development).toEqual(
      original.dispatch(command).development,
    );
  });

  it("loads version 1 saves with an empty growth history at their current tick", () => {
    const current = createSaveGame(createConnectedSimulation());
    const legacy = {
      formatVersion: 1 as const,
      scenarioId: current.scenarioId,
      scenarioSeed: current.scenarioSeed,
      simulation: {
        tick: current.simulation.tick,
        roadSegments: current.simulation.roadSegments,
        nextRoadSegmentNumber: current.simulation.nextRoadSegmentNumber,
      },
    };

    const restored = restoreSaveGame(
      deserializeSaveGame(JSON.stringify(legacy)),
    );
    expect(restored.getSnapshot()).toMatchObject({
      tick: current.simulation.tick,
      development: {
        demand: {
          completedGrowthPopulation: 0,
          committedGrowthPopulation: 0,
        },
      },
    });
    expect(
      restored.getSnapshot().development.nextEvaluationTick,
    ).toBeGreaterThan(current.simulation.tick);
  });

  it("exports and imports the versioned save as a JSON file", async () => {
    const save = createSaveGame(createConnectedSimulation());
    const file = createSaveFile(save);

    expect(file.type).toBe("application/json");
    await expect(readSaveFile(file)).resolves.toEqual(save);
  });

  it("starts a named file download and releases its object URL", () => {
    vi.useFakeTimers();
    try {
      const save = createSaveGame(createConnectedSimulation());
      const clicked = vi.fn();
      const removed = vi.fn();
      const appended = vi.fn();
      const anchor = {
        click: clicked,
        download: "",
        hidden: false,
        href: "",
        remove: removed,
      };
      const documentObject = {
        body: { append: appended },
        createElement: () => anchor,
      } as unknown as Document;
      const urlObject = {
        createObjectURL: vi.fn((blob: Blob) => {
          expect(blob.type).toBe("application/json");
          return "blob:save-game";
        }),
        revokeObjectURL: vi.fn(),
      };

      downloadSaveFile(save, documentObject, urlObject);

      expect(anchor).toMatchObject({
        download: SAVE_FILE_NAME,
        hidden: true,
        href: "blob:save-game",
      });
      expect(appended).toHaveBeenCalledWith(anchor);
      expect(clicked).toHaveBeenCalledOnce();
      expect(removed).toHaveBeenCalledOnce();
      expect(urlObject.revokeObjectURL).not.toHaveBeenCalled();

      vi.runAllTimers();
      expect(urlObject.revokeObjectURL).toHaveBeenCalledWith("blob:save-game");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects malformed, unsupported, and invalid simulation data", () => {
    expect(() => deserializeSaveGame("not JSON")).toThrow(SaveGameError);
    expect(() =>
      deserializeSaveGame(
        JSON.stringify({
          formatVersion: 3,
          scenarioId: "millford-valley",
          scenarioSeed: "future",
          simulation: {},
        }),
      ),
    ).toThrow("unsupported save format version: 3");

    const save = createSaveGame(createConnectedSimulation());
    const invalid = {
      ...save,
      simulation: {
        ...save.simulation,
        roadSegments: [
          {
            id: "road-segment-1",
            start: { x: -1, y: 0 },
            end: { x: 10, y: 0 },
          },
        ],
      },
    };
    expect(() => restoreSaveGame(invalid)).toThrow(
      "save contains invalid simulation state",
    );

    const invalidDevelopment = {
      ...save,
      simulation: {
        ...save.simulation,
        development: {
          ...save.simulation.development,
          processedTick: save.simulation.tick + 1,
        },
      },
    };
    expect(() => restoreSaveGame(invalidDevelopment)).toThrow(
      "save contains invalid simulation state",
    );
  });
});
