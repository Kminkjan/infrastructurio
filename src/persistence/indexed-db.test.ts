// @vitest-environment node

import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createSimulation } from "../simulation";
import { createSaveGame, loadLocalGame, saveLocalGame } from ".";

describe("local IndexedDB saves", () => {
  it("returns no save for a new local database", async () => {
    await expect(loadLocalGame(new IDBFactory())).resolves.toBeUndefined();
  });

  it("stores and retrieves the current save from the local slot", async () => {
    const factory = new IDBFactory();
    const simulation = createSimulation("indexed-db-round-trip");
    simulation.dispatch({ type: "advance", ticks: 72 });
    const save = createSaveGame(simulation);

    await saveLocalGame(save, factory);

    await expect(loadLocalGame(factory)).resolves.toEqual(save);
  });

  it("replaces the previous local slot deterministically", async () => {
    const factory = new IDBFactory();
    const first = createSaveGame(createSimulation("first-local-save"));
    const secondSimulation = createSimulation("second-local-save");
    secondSimulation.dispatch({ type: "advance", ticks: 24 });
    const second = createSaveGame(secondSimulation);

    await saveLocalGame(first, factory);
    await saveLocalGame(second, factory);

    await expect(loadLocalGame(factory)).resolves.toEqual(second);
  });
});
