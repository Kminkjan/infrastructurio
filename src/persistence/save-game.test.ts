// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createSimulation } from "../simulation";
import { OLD_MILLFORD_BRIDGE_ROAD_ID } from "../scenarios";
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
  validateSaveGame,
} from ".";

function createConnectedSimulation() {
  const simulation = createSimulation("save-round-trip");
  const geography = simulation.getSnapshot().geography;
  simulation.dispatch({
    type: "build-road",
    start: geography.quarry.position,
    end: geography.stoneworks.position,
  });
  simulation.dispatch({
    type: "build-road",
    start: geography.stoneworks.position,
    end: geography.externalMarketConnection.position,
  });
  simulation.dispatch({
    type: "build-road",
    start: { x: 0, y: 0 },
    end: { x: 20, y: 0 },
  });
  simulation.dispatch({
    type: "remove-road",
    roadSegmentId: "road-segment-3",
  });
  simulation.dispatch({ type: "advance", ticks: 24 * 17 });
  return simulation;
}

function legacyRoadTraffic(save: ReturnType<typeof createSaveGame>) {
  return {
    lastAssignmentTick: save.simulation.freightOperators.lastAssignmentTick,
    nextAssignmentTick: save.simulation.freightOperators.nextAssignmentTick,
    flows: save.simulation.freightOperators.flows.map(({ id }) => ({
      id,
      assignedFlowUnitsPerDay: 0,
      routeNodeIds: null,
      routeLinkIds: null,
    })),
  };
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
        nextRoadSegmentNumber: 4,
      },
    });
    expect(after.roadNetwork).toEqual(before.roadNetwork);
    expect(restored.getState().freightOperators).toEqual(
      original.getState().freightOperators,
    );
    expect(restored.getState().supplyChain).toEqual(
      original.getState().supplyChain,
    );
    expect(restored.getState().finances).toEqual(
      original.getState().finances,
    );
    expect(after.tick).toBe(before.tick);
    expect(after.elapsedDays).toBe(before.elapsedDays);
    expect(after.stoneSupplyChain).toEqual(before.stoneSupplyChain);
    expect(after.accessibility.locations).toEqual(
      before.accessibility.locations,
    );
    expect(after.development).toEqual(before.development);
    expect(after.stoneSupplyChain.inboundFreight.shippedTonsPerDay).toBeGreaterThan(0);
    expect(after.stoneSupplyChain.outboundFreight.shippedTonsPerDay).toBeGreaterThan(0);

    const replayCommand = { type: "advance", ticks: 24 * 7 } as const;
    expect(restored.dispatch(replayCommand).stoneSupplyChain).toEqual(
      original.dispatch(replayCommand).stoneSupplyChain,
    );

    const futureRoad = {
      start: { x: 0, y: 20 },
      end: { x: 20, y: 20 },
    } as const;
    expect(
      restored.quoteRoadConstruction(futureRoad.start, futureRoad.end),
    ).toEqual(
      original.quoteRoadConstruction(futureRoad.start, futureRoad.end),
    );
    const continued = restored.dispatch({
      type: "build-road",
      ...futureRoad,
    });
    const originalContinued = original.dispatch({
      type: "build-road",
      ...futureRoad,
    });
    expect(continued.roadNetwork.segments.at(-1)?.id).toBe("road-segment-4");
    expect(continued.finances).toEqual(originalContinued.finances);
  });

  it("round-trips rail topology, terminals, finances, routing, and future track ids", () => {
    const original = createSimulation("save-rail-round-trip");
    const geography = original.getSnapshot().geography;
    original.dispatch({ type: "place-freight-rail-terminal", site: "quarry" });
    original.dispatch({ type: "place-freight-rail-terminal", site: "stoneworks" });
    original.dispatch({
      type: "build-rail-track",
      start: geography.quarry.position,
      end: geography.stoneworks.position,
    });
    original.dispatch({
      type: "build-rail-track",
      start: { x: 20, y: 20 },
      end: { x: 30, y: 20 },
    });
    original.dispatch({
      type: "remove-rail-track",
      railTrackId: "rail-track-2",
    });

    const save = deserializeSaveGame(serializeSaveGame(createSaveGame(original)));
    const restored = restoreSaveGame(save);

    expect(save).toMatchObject({
      formatVersion: SAVE_FORMAT_VERSION,
      simulation: {
        nextRailTrackNumber: 3,
        railTracks: [{ id: "rail-track-1" }],
        railTerminals: [
          { id: "rail-terminal-quarry", site: "quarry" },
          { id: "rail-terminal-stoneworks", site: "stoneworks" },
        ],
      },
    });
    expect(restored.getSnapshot().railNetwork).toEqual(
      original.getSnapshot().railNetwork,
    );
    expect(restored.getState().finances).toEqual(original.getState().finances);
    expect(restored.findRailRoute(
      "rail-terminal-quarry",
      "rail-terminal-stoneworks",
    )).toEqual(original.findRailRoute(
      "rail-terminal-quarry",
      "rail-terminal-stoneworks",
    ));
    expect(restored.dispatch({
      type: "build-rail-track",
      start: { x: 40, y: 20 },
      end: { x: 50, y: 20 },
    }).railNetwork.tracks.at(-1)?.id).toBe("rail-track-3");
  });

  it("round-trips private operator pricing and assignment cadence", () => {
    const original = createConnectedSimulation();
    original.dispatch({
      type: "set-freight-service-price",
      mode: "road",
      adjustmentHours: 2.5,
    });
    const restored = restoreSaveGame(
      deserializeSaveGame(serializeSaveGame(createSaveGame(original))),
    );

    expect(restored.getState().freightOperators).toEqual(
      original.getState().freightOperators,
    );
    expect(
      restored.getSnapshot().stoneSupplyChain.inboundFreight.serviceCandidates[0]
        ?.priceAdjustmentHours,
    ).toBe(2.5);
  });

  it("preserves objective progress and continues the success hold", () => {
    const original = createSimulation("save-scenario-progress");
    const geography = original.getSnapshot().geography;
    for (const entityId of [
      geography.quarry.id,
      geography.stoneworks.id,
      geography.externalMarketConnection.id,
    ]) {
      original.dispatch({ type: "inspect-entity", entityId });
    }
    original.dispatch({
      type: "build-road",
      start: geography.quarry.position,
      end: geography.stoneworks.position,
    });
    original.dispatch({
      type: "build-road",
      start: geography.settlementSeeds.find(
        ({ id }) => id === "settlement-eastbank",
      )!.position,
      end: geography.externalMarketConnection.position,
    });
    original.dispatch({ type: "advance", ticks: 24 });
    original.dispatch({
      type: "upgrade-road",
      roadSegmentId: OLD_MILLFORD_BRIDGE_ROAD_ID,
    });
    original.dispatch({ type: "advance", ticks: 24 * 13 });
    expect(original.getSnapshot().scenarioProgress.successfulDays).toBe(1);

    const save = deserializeSaveGame(serializeSaveGame(createSaveGame(original)));
    const restored = restoreSaveGame(save);
    expect(restored.getState().scenarioProgress).toEqual(
      original.getState().scenarioProgress,
    );
    expect(restored.getSnapshot().scenarioProgress).toEqual(
      original.getSnapshot().scenarioProgress,
    );
    const restoredCompleted = restored.dispatch({ type: "advance", ticks: 48 });
    const originalCompleted = original.dispatch({ type: "advance", ticks: 48 });
    expect(restoredCompleted.scenarioProgress.success).toBe(true);
    expect(restoredCompleted.scenarioProgress.ending).toEqual(
      originalCompleted.scenarioProgress.ending,
    );
    expect(
      restoreSaveGame(save).dispatch({ type: "reset" }),
    ).toEqual(createSimulation("save-scenario-progress").getSnapshot());
  });

  it("migrates version 8 objective history without inventing an intervention baseline", () => {
    const original = createSimulation("version-8-progress");
    const geography = original.getSnapshot().geography;
    original.dispatch({
      type: "build-road",
      start: geography.quarry.position,
      end: geography.stoneworks.position,
    });
    const current = createSaveGame(original);
    const { latestStrategicIntervention: _baseline, ...legacyProgress } =
      current.simulation.scenarioProgress;
    const legacy = validateSaveGame({
      ...current,
      formatVersion: 8,
      simulation: {
        ...current.simulation,
        scenarioProgress: legacyProgress,
      },
    });
    if (legacy.formatVersion !== 8) {
      throw new Error("expected a version 8 save");
    }
    const restored = restoreSaveGame(legacy);

    expect("latestStrategicIntervention" in legacy.simulation.scenarioProgress).toBe(false);
    expect(restored.getState().scenarioProgress).toMatchObject({
      processedTick: original.getState().scenarioProgress?.processedTick,
      latestStrategicIntervention: null,
    });
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

  it("preserves emergency finance and future daily penalties", () => {
    const original = createSimulation("save-emergency-finance");
    original.dispatch({
      type: "build-road",
      start: { x: 0, y: 0 },
      end: { x: 960, y: 0 },
      roadClass: "highway",
    });
    original.dispatch({
      type: "build-road",
      start: { x: 0, y: 20 },
      end: { x: 960, y: 20 },
      roadClass: "arterial",
    });
    original.dispatch({ type: "issue-emergency-bond" });
    original.dispatch({ type: "advance", ticks: 24 });

    const restored = restoreSaveGame(createSaveGame(original));
    expect(restored.getState().finances).toEqual(original.getState().finances);
    expect(restored.getSnapshot().finances.emergencyFinance).toEqual(
      original.getSnapshot().finances.emergencyFinance,
    );

    const command = { type: "advance", ticks: 24 } as const;
    expect(restored.dispatch(command).finances).toEqual(
      original.dispatch(command).finances,
    );
  });

  it("preserves an upgraded crossing and its resolved bottleneck state", () => {
    const original = createSimulation("save-upgraded-crossing");
    const geography = original.getSnapshot().geography;
    original.dispatch({
      type: "build-road",
      start: geography.quarry.position,
      end: geography.stoneworks.position,
    });
    original.dispatch({
      type: "build-road",
      start: geography.settlementSeeds.find(
        ({ id }) => id === "settlement-eastbank",
      )!.position,
      end: geography.externalMarketConnection.position,
    });
    original.dispatch({ type: "advance", ticks: 24 });
    const upgraded = original.dispatch({
      type: "upgrade-road",
      roadSegmentId: OLD_MILLFORD_BRIDGE_ROAD_ID,
    });
    expect(
      upgraded.bottlenecks.roadBottlenecks.some(
        ({ isMillfordBridge }) => isMillfordBridge,
      ),
    ).toBe(false);

    const restored = restoreSaveGame(createSaveGame(original)).getSnapshot();
    expect(restored.roadNetwork.segments.find(
      ({ id }) => id === OLD_MILLFORD_BRIDGE_ROAD_ID,
    )?.roadClass).toBe("highway");
    expect(restored.bottlenecks).toEqual(upgraded.bottlenecks);
  });

  it("loads version 1 saves with an empty growth history at their current tick", () => {
    const current = createSaveGame(createConnectedSimulation());
    const legacy = {
      formatVersion: 1 as const,
      scenarioId: current.scenarioId,
      scenarioSeed: current.scenarioSeed,
      simulation: {
        tick: current.simulation.tick,
        roadSegments: current.simulation.roadSegments.map(
          ({ id, start, end }) => ({ id, start, end }),
        ),
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
    expect(restored.getSnapshot().roadNetwork.segments).toEqual(
      current.simulation.roadSegments.map((segment) => ({
        ...segment,
        roadClass: "arterial",
      })),
    );
  });

  it("loads version 2 saves with derived traffic and default classes", () => {
    const current = createSaveGame(createConnectedSimulation());
    const legacy = {
      formatVersion: 2 as const,
      scenarioId: current.scenarioId,
      scenarioSeed: current.scenarioSeed,
      simulation: {
        tick: current.simulation.tick,
        roadSegments: current.simulation.roadSegments.map(
          ({ id, start, end }) => ({ id, start, end }),
        ),
        nextRoadSegmentNumber: current.simulation.nextRoadSegmentNumber,
        development: current.simulation.development,
      },
    };

    const restored = restoreSaveGame(
      deserializeSaveGame(JSON.stringify(legacy)),
    );
    expect(restored.getState().development).toEqual(
      current.simulation.development,
    );
    expect(restored.getSnapshot().roadNetwork.segments.every(
      ({ roadClass }) => roadClass === "arterial",
    )).toBe(true);
    expect(restored.getState().freightOperators).toBeDefined();
  });

  it("loads version 7 saves with fresh objective history at the saved tick", () => {
    const current = createSaveGame(createConnectedSimulation());
    const { scenarioProgress: _scenarioProgress, ...legacySimulation } =
      current.simulation;
    const restored = restoreSaveGame(
      deserializeSaveGame(
        JSON.stringify({
          formatVersion: 7,
          scenarioId: current.scenarioId,
          scenarioSeed: current.scenarioSeed,
          simulation: legacySimulation,
        }),
      ),
    );

    expect(restored.getSnapshot().tick).toBe(current.simulation.tick);
    expect(restored.getSnapshot().scenarioProgress).toMatchObject({
      inspectedEntityIds: [],
      successfulDays: 0,
      success: false,
    });
  });

  it("migrates version 3 quarry-export saves to a dormant stoneworks", () => {
    const current = createSaveGame(createConnectedSimulation());
    const legacy = {
      formatVersion: 3 as const,
      scenarioId: current.scenarioId,
      scenarioSeed: current.scenarioSeed,
      simulation: {
        tick: current.simulation.tick,
        roadSegments: current.simulation.roadSegments,
        nextRoadSegmentNumber: current.simulation.nextRoadSegmentNumber,
        development: current.simulation.development,
        roadTraffic: {
          lastAssignmentTick: current.simulation.tick,
          nextAssignmentTick: current.simulation.tick + 8,
          assignedFlowUnitsPerDay: 100,
          routeNodeIds: null,
          routeLinkIds: null,
        },
      },
    };

    const restored = restoreSaveGame(
      deserializeSaveGame(JSON.stringify(legacy)),
    );
    expect(restored.getSnapshot().stoneSupplyChain).toMatchObject({
      lastUpdateTick: null,
      stoneworks: {
        active: false,
        inputInventoryTons: 0,
        finishedStoneInventoryTons: 0,
      },
    });
    expect(restored.getSnapshot().stoneSupplyChain.nextUpdateTick).toBeGreaterThan(
      current.simulation.tick,
    );
  });

  it("migrates version 4 saves with a fresh treasury at the saved tick", () => {
    const current = createSaveGame(createConnectedSimulation());
    const legacy = {
      formatVersion: 4 as const,
      scenarioId: current.scenarioId,
      scenarioSeed: current.scenarioSeed,
      simulation: {
        tick: current.simulation.tick,
        roadSegments: current.simulation.roadSegments,
        nextRoadSegmentNumber: current.simulation.nextRoadSegmentNumber,
        development: current.simulation.development,
        supplyChain: current.simulation.supplyChain,
        roadTraffic: legacyRoadTraffic(current),
      },
    };

    const restored = restoreSaveGame(
      deserializeSaveGame(JSON.stringify(legacy)),
    );
    expect(restored.getSnapshot().finances).toMatchObject({
      balance: 60_000,
      totalCapitalSpending: 0,
      totalOperatingRevenue: 0,
      totalMaintenancePaid: 0,
    });
    expect(restored.getState().finances?.processedTick).toBe(
      current.simulation.tick,
    );
    expect(restored.getState().supplyChain).toEqual(current.simulation.supplyChain);
  });

  it("migrates version 5 saves with an empty rail network", () => {
    const current = createSaveGame(createConnectedSimulation());
    const legacy = {
      formatVersion: 5 as const,
      scenarioId: current.scenarioId,
      scenarioSeed: current.scenarioSeed,
      simulation: {
        tick: current.simulation.tick,
        roadSegments: current.simulation.roadSegments,
        nextRoadSegmentNumber: current.simulation.nextRoadSegmentNumber,
        development: current.simulation.development,
        supplyChain: current.simulation.supplyChain,
        roadTraffic: legacyRoadTraffic(current),
        finances: current.simulation.finances,
      },
    };

    const restored = restoreSaveGame(deserializeSaveGame(JSON.stringify(legacy)));
    expect(restored.getSnapshot().railNetwork).toEqual({
      tracks: [],
      terminals: [],
      nodes: [],
      links: [],
    });
    expect(restored.getState().finances).toEqual(current.simulation.finances);
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
          formatVersion: SAVE_FORMAT_VERSION + 1,
          scenarioId: "millford-valley",
          scenarioSeed: "future",
          simulation: {},
        }),
      ),
    ).toThrow(`unsupported save format version: ${SAVE_FORMAT_VERSION + 1}`);

    const save = createSaveGame(createConnectedSimulation());
    const invalid = {
      ...save,
      simulation: {
        ...save.simulation,
        roadSegments: [
          {
            id: "road-segment-1",
            roadClass: "arterial" as const,
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

    const invalidTraffic = {
      ...save,
      simulation: {
        ...save.simulation,
        freightOperators: {
          ...save.simulation.freightOperators,
          nextAssignmentTick: save.simulation.tick,
        },
      },
    };
    expect(() => restoreSaveGame(invalidTraffic)).toThrow(
      "save contains invalid simulation state",
    );

    const invalidSupplyChain = {
      ...save,
      simulation: {
        ...save.simulation,
        supplyChain: {
          ...save.simulation.supplyChain,
          inputInventoryTons: 241,
        },
      },
    };
    expect(() => restoreSaveGame(invalidSupplyChain)).toThrow(
      "save contains invalid simulation state",
    );

    const invalidFinances = {
      ...save,
      simulation: {
        ...save.simulation,
        finances: {
          ...save.simulation.finances,
          processedTick: save.simulation.tick + 1,
        },
      },
    };
    expect(() => restoreSaveGame(invalidFinances)).toThrow(
      "save contains invalid simulation state",
    );

    const invalidRail = {
      ...save,
      simulation: {
        ...save.simulation,
        railTracks: [{
          id: "rail-track-1",
          start: { x: -1, y: 0 },
          end: { x: 10, y: 0 },
        }],
      },
    };
    expect(() => restoreSaveGame(invalidRail)).toThrow(
      "save contains invalid simulation state",
    );

    const incompatibleTerminal = {
      ...save,
      simulation: {
        ...save.simulation,
        railTerminals: [{
          id: "rail-terminal-quarry",
          site: "quarry" as const,
          siteId: "market-connection-east",
        }],
      },
    };
    expect(() => restoreSaveGame(incompatibleTerminal)).toThrow(
      "save contains invalid simulation state",
    );
  });
});
