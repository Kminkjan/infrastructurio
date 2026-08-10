// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createSimulation } from ".";

describe("headless simulation", () => {
  it("produces the same snapshots for the same seed and commands", () => {
    expect(globalThis).not.toHaveProperty("document");

    const first = createSimulation("millford-valley");
    const second = createSimulation("millford-valley");
    const commands = [
      { type: "advance", ticks: 6 },
      { type: "advance", ticks: 18 },
      { type: "advance", ticks: 48 },
    ] as const;

    const firstSnapshots = commands.map((command) => first.dispatch(command));
    const secondSnapshots = commands.map((command) => second.dispatch(command));

    expect(firstSnapshots).toEqual(secondSnapshots);
    expect(first.getSnapshot()).toMatchObject({
      seed: "millford-valley",
      tick: 72,
      elapsedDays: 3,
    });
  });

  it("resets to the initial deterministic state", () => {
    const simulation = createSimulation("millford-valley");
    const initialSnapshot = simulation.getSnapshot();
    simulation.dispatch({ type: "advance", ticks: 24 });

    expect(simulation.dispatch({ type: "reset" })).toEqual(initialSnapshot);
  });

  it("rejects invalid time steps", () => {
    const simulation = createSimulation("millford-valley");

    expect(() =>
      simulation.dispatch({ type: "advance", ticks: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      simulation.dispatch({ type: "advance", ticks: 0.5 }),
    ).toThrow(RangeError);
  });
});
