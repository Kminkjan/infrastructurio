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

  it("advances both stone-supply legs only at deterministic daily boundaries", () => {
    const simulation = createSimulation("stone-supply");
    const initial = simulation.getSnapshot();
    const quarry = initial.geography.quarry.position;
    const stoneworks = initial.geography.stoneworks.position;
    const market = initial.geography.externalMarketConnection.position;

    expect(initial.stoneSupplyChain).toMatchObject({
      updateIntervalTicks: 24,
      lastUpdateTick: null,
      nextUpdateTick: 24,
      stoneworks: {
        active: false,
        inputStorageCapacityTons: 240,
        processingCapacityTonsPerDay: 100,
        outputStorageCapacityTons: 160,
      },
    });
    simulation.dispatch({
      type: "build-road",
      start: quarry,
      end: stoneworks,
    });
    expect(
      simulation.dispatch({ type: "advance", ticks: 23 }).stoneSupplyChain
        .inboundFreight.shippedTonsPerDay,
    ).toBe(0);

    const inboundDay = simulation.dispatch({ type: "advance", ticks: 1 });
    expect(inboundDay.stoneSupplyChain).toMatchObject({
      lastUpdateTick: 24,
      inboundFreight: { shippedTonsPerDay: 120 },
      stoneworks: {
        active: true,
        inputInventoryTons: 20,
        processedTonsPerDay: 100,
        finishedStoneInventoryTons: 100,
      },
      outboundFreight: { shippedTonsPerDay: 0, limitingFactor: "no-route" },
    });
    simulation.dispatch({
      type: "build-road",
      start: stoneworks,
      end: market,
    });
    const completeChain = simulation.dispatch({ type: "advance", ticks: 24 });
    expect(completeChain.stoneSupplyChain.outboundFreight).toMatchObject({
      commodity: "finished-stone",
      shippedTonsPerDay: 100,
      limitingFactor: "market-demand",
    });

    const disconnectedInbound = simulation.dispatch({
      type: "remove-road",
      roadSegmentId: "road-segment-1",
    });
    expect(disconnectedInbound.stoneSupplyChain.inboundFreight).toMatchObject({
      shippedTonsPerDay: 0,
      route: null,
      limitingFactor: "no-route",
    });
  });

  it("replays both supply-chain legs identically across chunked advances", () => {
    const setup = (simulation: ReturnType<typeof createSimulation>) => {
      const geography = simulation.getSnapshot().geography;
      simulation.dispatch({ type: "build-road", start: geography.quarry.position, end: geography.stoneworks.position });
      simulation.dispatch({ type: "build-road", start: geography.stoneworks.position, end: geography.externalMarketConnection.position });
    };
    const first = createSimulation("supply-replay");
    const second = createSimulation("supply-replay");
    setup(first);
    setup(second);
    first.dispatch({ type: "advance", ticks: 24 * 10 });
    for (let day = 0; day < 10; day += 1) {
      second.dispatch({ type: "advance", ticks: 24 });
    }

    expect(second.getSnapshot().stoneSupplyChain).toEqual(
      first.getSnapshot().stoneSupplyChain,
    );
    expect(second.getSnapshot().roadNetwork).toEqual(
      first.getSnapshot().roadNetwork,
    );
    expect(second.getSnapshot().accessibility.locations).toEqual(
      first.getSnapshot().accessibility.locations,
    );
    expect(second.getState().supplyChain).toEqual(first.getState().supplyChain);
  });

  it("publishes deterministic network accessibility for candidate locations", () => {
    const simulation = createSimulation("accessibility-snapshot");
    const initial = simulation.getSnapshot();
    const [millford, eastbank] = initial.geography.settlementSeeds;
    expect(millford).toBeDefined();
    expect(eastbank).toBeDefined();

    expect(
      initial.accessibility.locations.map(({ locationId }) => locationId),
    ).toEqual(initial.geography.settlementSeeds.map(({ id }) => id));
    for (const location of initial.accessibility.locations) {
      expect(location).toMatchObject({
        market: { score: 0, nearestNetworkCost: null },
        labor: { score: 0, nearestNetworkCost: null },
        resource: { score: 0, nearestNetworkCost: null },
        service: { score: 0, nearestNetworkCost: null },
      });
    }

    const fertileCenter = initial.geography.fertileLand.boundary.reduce(
      (center, position, _index, boundary) => ({
        x: center.x + position.x / boundary.length,
        y: center.y + position.y / boundary.length,
      }),
      { x: 0, y: 0 },
    );
    const anchors = [
      millford!.position,
      initial.geography.quarry.position,
      eastbank!.position,
      fertileCenter,
      initial.geography.externalMarketConnection.position,
    ];
    let connected = initial;
    for (let index = 0; index < anchors.length - 1; index += 1) {
      connected = simulation.dispatch({
        type: "build-road",
        start: anchors[index]!,
        end: anchors[index + 1]!,
      });
    }

    for (const location of connected.accessibility.locations) {
      expect(location.market.score).toBeGreaterThan(0);
      expect(location.labor.score).toBeGreaterThan(0);
      expect(location.resource.score).toBeGreaterThan(0);
      expect(location.service.score).toBeGreaterThan(0);
    }

    const replay = createSimulation("accessibility-snapshot");
    for (let index = 0; index < anchors.length - 1; index += 1) {
      replay.dispatch({
        type: "build-road",
        start: anchors[index]!,
        end: anchors[index + 1]!,
      });
    }
    expect(replay.getSnapshot().accessibility).toEqual(connected.accessibility);
  });

  it("invalidates only candidate locations affected by a local edit", () => {
    const simulation = createSimulation("accessibility-invalidation");
    const geography = simulation.getSnapshot().geography;
    const [millford, eastbank] = geography.settlementSeeds;
    expect(millford).toBeDefined();
    expect(eastbank).toBeDefined();

    simulation.dispatch({
      type: "build-road",
      start: millford!.position,
      end: geography.quarry.position,
    });
    const fertileCenter = geography.fertileLand.boundary.reduce(
      (center, position, _index, boundary) => ({
        x: center.x + position.x / boundary.length,
        y: center.y + position.y / boundary.length,
      }),
      { x: 0, y: 0 },
    );
    const locallyEdited = simulation.dispatch({
      type: "build-road",
      start: geography.quarry.position,
      end: fertileCenter,
    });

    expect(
      locallyEdited.accessibility.lastNetworkUpdateInvalidatedLocationIds,
    ).toEqual([millford!.id]);
    expect(
      locallyEdited.accessibility.locations.find(
        ({ locationId }) => locationId === eastbank!.id,
      ),
    ).toBeDefined();

    const unrelated = simulation.dispatch({
      type: "build-road",
      start: { x: 0, y: 0 },
      end: { x: 20, y: 0 },
    });
    expect(
      unrelated.accessibility.lastNetworkUpdateInvalidatedLocationIds,
    ).toEqual([]);
  });

  it("adds realized stoneworks employment to Millford accessibility", () => {
    const simulation = createSimulation("stoneworks-employment");
    const geography = simulation.getSnapshot().geography;
    const millford = geography.settlementSeeds[0]!;
    simulation.dispatch({
      type: "build-road",
      start: geography.quarry.position,
      end: geography.stoneworks.position,
    });
    simulation.dispatch({
      type: "build-road",
      start: millford.position,
      end: geography.stoneworks.position,
    });
    simulation.dispatch({
      type: "build-road",
      start: geography.stoneworks.position,
      end: geography.externalMarketConnection.position,
    });
    const beforeSnapshot = simulation.getSnapshot();
    const before = beforeSnapshot.accessibility.locations.find(
      ({ locationId }) => locationId === millford.id,
    )!;
    const beforePressure = beforeSnapshot.development.locations.find(
      ({ locationId }) => locationId === millford.id,
    )!.pressure;

    const afterSnapshot = simulation.dispatch({ type: "advance", ticks: 24 });
    const after = afterSnapshot.accessibility.locations.find(
      ({ locationId }) => locationId === millford.id,
    )!;
    const afterPressure = afterSnapshot.development.locations.find(
      ({ locationId }) => locationId === millford.id,
    )!.pressure;

    expect(after.labor.score).toBeGreaterThan(before.labor.score);
    expect(afterPressure).toBeGreaterThan(beforePressure);
    expect(simulation.getSnapshot().stoneSupplyChain.stoneworks).toMatchObject({
      active: true,
      laborOpportunity: 40,
    });
  });

  it("grows a connected settlement after delayed construction within regional demand", () => {
    const simulation = createSimulation("settlement-growth");
    const geography = simulation.getSnapshot().geography;
    const millford = geography.settlementSeeds[0];
    expect(millford).toBeDefined();

    const connected = simulation.dispatch({
      type: "build-road",
      start: millford!.position,
      end: geography.externalMarketConnection.position,
    });
    expect(connected.development).toMatchObject({
      demand: {
        targetGrowthPopulation: 100,
        completedGrowthPopulation: 0,
      },
    });
    expect(
      connected.development.locations.find(
        ({ locationId }) => locationId === millford!.id,
      )?.pressure,
    ).toBeGreaterThan(0);

    const scheduled = simulation.dispatch({ type: "advance", ticks: 24 * 7 });
    expect(scheduled.development.demand).toMatchObject({
      completedGrowthPopulation: 0,
      committedGrowthPopulation: 10,
    });
    expect(
      scheduled.development.locations.find(
        ({ locationId }) => locationId === millford!.id,
      )?.status,
    ).toBe("growing");

    const completed = simulation.dispatch({ type: "advance", ticks: 24 * 7 });
    expect(
      completed.development.locations.find(
        ({ locationId }) => locationId === millford!.id,
      ),
    ).toMatchObject({ growthPopulation: 10, totalPopulation: 70 });

    const saturated = simulation.dispatch({
      type: "advance",
      ticks: 24 * 7 * 20,
    });
    expect(saturated.development.demand).toEqual({
      targetGrowthPopulation: 100,
      completedGrowthPopulation: 100,
      committedGrowthPopulation: 100,
      remainingGrowthPopulation: 0,
    });
  });

  it("lets both Millford Valley candidates compete when both gain access", () => {
    const simulation = createSimulation("development-competition");
    const geography = simulation.getSnapshot().geography;
    const [millford, eastbank] = geography.settlementSeeds;
    expect(millford).toBeDefined();
    expect(eastbank).toBeDefined();
    const fertileCenter = geography.fertileLand.boundary.reduce(
      (center, position, _index, boundary) => ({
        x: center.x + position.x / boundary.length,
        y: center.y + position.y / boundary.length,
      }),
      { x: 0, y: 0 },
    );
    const anchors = [
      millford!.position,
      geography.quarry.position,
      eastbank!.position,
      fertileCenter,
      geography.externalMarketConnection.position,
    ];
    for (let index = 0; index < anchors.length - 1; index += 1) {
      simulation.dispatch({
        type: "build-road",
        start: anchors[index]!,
        end: anchors[index + 1]!,
      });
    }

    const developed = simulation.dispatch({
      type: "advance",
      ticks: 24 * 7 * 12,
    });
    for (const location of developed.development.locations) {
      expect(location.growthPopulation).toBeGreaterThan(0);
    }
    expect(developed.development.demand.committedGrowthPopulation).toBe(100);
  });

  it("keeps completed development under pressure before gradual decline after access removal", () => {
    const simulation = createSimulation("settlement-decline");
    const geography = simulation.getSnapshot().geography;
    const millford = geography.settlementSeeds[0];
    expect(millford).toBeDefined();
    simulation.dispatch({
      type: "build-road",
      start: millford!.position,
      end: geography.externalMarketConnection.position,
    });
    simulation.dispatch({ type: "advance", ticks: 24 * 14 });

    const disconnected = simulation.dispatch({
      type: "remove-road",
      roadSegmentId: "road-segment-1",
    });
    expect(
      disconnected.development.locations.find(
        ({ locationId }) => locationId === millford!.id,
      ),
    ).toMatchObject({
      growthPopulation: 10,
      totalPopulation: 70,
      status: "declining",
      pendingConstruction: null,
    });

    const declined = simulation.dispatch({ type: "advance", ticks: 24 * 7 });
    expect(
      declined.development.locations.find(
        ({ locationId }) => locationId === millford!.id,
      ),
    ).toMatchObject({
      basePopulation: 60,
      growthPopulation: 5,
      totalPopulation: 65,
      status: "declining",
    });
  });
});
