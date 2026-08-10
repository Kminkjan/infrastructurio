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

  it("builds, routes across, and removes authoritative road segments", () => {
    const simulation = createSimulation("road-edit-test");
    simulation.dispatch({
      type: "build-road",
      start: { x: 100, y: 100 },
      end: { x: 300, y: 100 },
    });
    const connected = simulation.dispatch({
      type: "build-road",
      start: { x: 300, y: 100 },
      end: { x: 300, y: 250 },
    });

    expect(connected.roadNetwork.segments.map(({ id }) => id)).toEqual([
      "road-segment-1",
      "road-segment-2",
    ]);
    expect(
      simulation.findRoute({ x: 100, y: 100 }, { x: 300, y: 250 }),
    ).toMatchObject({ length: 350 });

    const disconnected = simulation.dispatch({
      type: "remove-road",
      roadSegmentId: "road-segment-2",
    });
    expect(disconnected.roadNetwork.segments).toHaveLength(1);
    expect(
      simulation.findRoute({ x: 100, y: 100 }, { x: 300, y: 250 }),
    ).toBeUndefined();
  });

  it("replays road commands deterministically and resets the network", () => {
    const first = createSimulation("road-determinism");
    const second = createSimulation("road-determinism");
    const commands = [
      {
        type: "build-road",
        start: { x: 100.1234, y: 200.5678 },
        end: { x: 500, y: 200 },
      },
      {
        type: "build-road",
        start: { x: 300, y: 100 },
        end: { x: 300, y: 300 },
      },
    ] as const;

    const firstSnapshots = commands.map((command) => first.dispatch(command));
    const secondSnapshots = commands.map((command) => second.dispatch(command));

    expect(firstSnapshots).toEqual(secondSnapshots);
    expect(
      first.findRoute(
        { x: 100.1234, y: 200.5678 },
        { x: 500, y: 200 },
      ),
    ).toBeDefined();
    expect(first.dispatch({ type: "reset" }).roadNetwork).toEqual({
      segments: [],
      nodes: [],
      links: [],
    });
  });
});
