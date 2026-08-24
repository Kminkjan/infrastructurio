// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { RoadRoute } from "../../shared";
import {
  FULL_VOLUME_ROUTE_COST,
  MAXIMUM_VIABLE_ROUTE_COST,
  STONEWORKS_INPUT_STORAGE_TONS,
  STONEWORKS_OUTPUT_STORAGE_TONS,
  advanceStoneSupplyChainDay,
  createStoneSupplyChainState,
} from "./stone-supply-chain";

function route(cost = FULL_VOLUME_ROUTE_COST): RoadRoute {
  return {
    nodeIds: ["origin", "destination"],
    linkIds: ["road"],
    length: cost * 60,
    freeFlowTravelTimeHours: cost,
    congestionDelayHours: 0,
    generalizedCostHours: cost,
  };
}

function nextDay(
  state: ReturnType<typeof createStoneSupplyChainState>,
  inbound: RoadRoute | undefined,
  outbound: RoadRoute | undefined,
) {
  return advanceStoneSupplyChainDay(
    state,
    state.nextUpdateTick,
    inbound,
    outbound,
  );
}

describe("Millford stone supply chain", () => {
  it("stays dormant without a viable inbound route", () => {
    const state = nextDay(createStoneSupplyChainState(0), undefined, route());

    expect(state).toMatchObject({
      inputInventoryTons: 0,
      finishedStoneInventoryTons: 0,
      inboundShippedTonsPerDay: 0,
      inboundLimitingFactor: "no-route",
      processedTonsPerDay: 0,
      stoneworksLimitingFactor: "input-shortage",
      outboundShippedTonsPerDay: 0,
      outboundLimitingFactor: "inventory",
    });
  });

  it("moves raw granite, processes it, and exports only available finished stone", () => {
    const state = nextDay(createStoneSupplyChainState(0), route(), route());

    expect(state).toMatchObject({
      inputInventoryTons: 20,
      finishedStoneInventoryTons: 0,
      inboundShippedTonsPerDay: 120,
      inboundLimitingFactor: "production",
      processedTonsPerDay: 100,
      stoneworksLimitingFactor: "processing-capacity",
      outboundAvailableTonsPerDay: 100,
      outboundShippedTonsPerDay: 100,
      outboundLimitingFactor: "inventory",
    });
  });

  it("bounds both inventories and exposes storage and market-demand limits", () => {
    let state = createStoneSupplyChainState(0);
    for (let day = 0; day < 3; day += 1) {
      state = nextDay(state, route(), undefined);
    }
    expect(state).toMatchObject({
      inputInventoryTons: 200,
      finishedStoneInventoryTons: STONEWORKS_OUTPUT_STORAGE_TONS,
      processedTonsPerDay: 0,
      stoneworksLimitingFactor: "output-storage",
    });

    state = nextDay(state, route(), route());
    expect(state).toMatchObject({
      inputInventoryTons: STONEWORKS_INPUT_STORAGE_TONS,
      inboundShippedTonsPerDay: 40,
      inboundLimitingFactor: "input-storage",
      outboundShippedTonsPerDay: 100,
      outboundLimitingFactor: "market-demand",
    });
    expect(state.finishedStoneInventoryTons).toBeLessThanOrEqual(
      STONEWORKS_OUTPUT_STORAGE_TONS,
    );
  });

  it("exposes route cost as a deterministic limit on either leg", () => {
    const costly = route(
      FULL_VOLUME_ROUTE_COST +
        (MAXIMUM_VIABLE_ROUTE_COST - FULL_VOLUME_ROUTE_COST) / 2,
    );
    const state = nextDay(createStoneSupplyChainState(0), costly, route());

    expect(state).toMatchObject({
      inboundShippedTonsPerDay: 60,
      inboundLimitingFactor: "route-cost",
      processedTonsPerDay: 60,
      stoneworksLimitingFactor: "input-shortage",
      outboundShippedTonsPerDay: 60,
      outboundLimitingFactor: "inventory",
    });
  });

  it("replays identical daily state transitions", () => {
    let first = createStoneSupplyChainState(0);
    let second = createStoneSupplyChainState(0);
    for (let day = 0; day < 12; day += 1) {
      first = nextDay(first, route(), day < 4 ? undefined : route());
      second = nextDay(second, route(), day < 4 ? undefined : route());
    }
    expect(second).toEqual(first);
  });
});
