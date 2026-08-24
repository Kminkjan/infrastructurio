import {
  TICKS_PER_DAY,
  type AggregateFreightSnapshot,
  type FreightLimitingFactor,
  type RoadRoute,
  type ScenarioGeography,
  type StoneSupplyChainSnapshot,
  type StoneworksLimitingFactor,
} from "../../shared";

export const SUPPLY_CHAIN_UPDATE_INTERVAL_TICKS = TICKS_PER_DAY;
export const QUARRY_DAILY_OUTPUT_TONS = 120;
export const STONEWORKS_INPUT_STORAGE_TONS = 240;
export const STONEWORKS_PROCESSING_TONS_PER_DAY = 100;
export const STONEWORKS_OUTPUT_STORAGE_TONS = 160;
export const MARKET_DAILY_DEMAND_TONS = 100;
export const STONEWORKS_MAX_LABOR_OPPORTUNITY = 40;
export const FULL_VOLUME_ROUTE_COST = 16;
export const MAXIMUM_VIABLE_ROUTE_COST = 32;

export interface StoneSupplyChainStateSnapshot {
  readonly processedTick: number;
  readonly lastUpdateTick: number | null;
  readonly nextUpdateTick: number;
  readonly inputInventoryTons: number;
  readonly finishedStoneInventoryTons: number;
  readonly inboundAvailableTonsPerDay: number;
  readonly inboundRequestedTonsPerDay: number;
  readonly inboundShippedTonsPerDay: number;
  readonly inboundLimitingFactor: FreightLimitingFactor;
  readonly processedTonsPerDay: number;
  readonly stoneworksLimitingFactor: StoneworksLimitingFactor;
  readonly outboundAvailableTonsPerDay: number;
  readonly outboundRequestedTonsPerDay: number;
  readonly outboundShippedTonsPerDay: number;
  readonly outboundLimitingFactor: FreightLimitingFactor;
}

interface FreightAssignment {
  readonly shippedTonsPerDay: number;
  readonly limitingFactor: FreightLimitingFactor;
}

function roundTons(value: number): number {
  return Math.round(value * 10) / 10;
}

function routeShare(route: RoadRoute | undefined): number {
  if (!route || route.generalizedCostHours >= MAXIMUM_VIABLE_ROUTE_COST) {
    return 0;
  }
  return route.generalizedCostHours <= FULL_VOLUME_ROUTE_COST
    ? 1
    : (MAXIMUM_VIABLE_ROUTE_COST - route.generalizedCostHours) /
        (MAXIMUM_VIABLE_ROUTE_COST - FULL_VOLUME_ROUTE_COST);
}

function assignFreight(
  availableTonsPerDay: number,
  requestedTonsPerDay: number,
  route: RoadRoute | undefined,
  availableFactor: FreightLimitingFactor,
  requestedFactor: FreightLimitingFactor,
): FreightAssignment {
  if (!route) {
    return { shippedTonsPerDay: 0, limitingFactor: "no-route" };
  }
  const share = routeShare(route);
  if (share === 0) {
    return { shippedTonsPerDay: 0, limitingFactor: "route-cost" };
  }

  const unconstrained = Math.min(availableTonsPerDay, requestedTonsPerDay);
  const shippedTonsPerDay = roundTons(unconstrained * share);
  if (shippedTonsPerDay < unconstrained) {
    return { shippedTonsPerDay, limitingFactor: "route-cost" };
  }
  return {
    shippedTonsPerDay,
    limitingFactor:
      availableTonsPerDay <= requestedTonsPerDay
        ? availableFactor
        : requestedFactor,
  };
}

function nextDailyBoundary(tick: number): number {
  return (Math.floor(tick / SUPPLY_CHAIN_UPDATE_INTERVAL_TICKS) + 1) *
    SUPPLY_CHAIN_UPDATE_INTERVAL_TICKS;
}

export function createStoneSupplyChainState(
  tick: number,
): StoneSupplyChainStateSnapshot {
  return Object.freeze({
    processedTick: tick,
    lastUpdateTick: null,
    nextUpdateTick: nextDailyBoundary(tick),
    inputInventoryTons: 0,
    finishedStoneInventoryTons: 0,
    inboundAvailableTonsPerDay: QUARRY_DAILY_OUTPUT_TONS,
    inboundRequestedTonsPerDay: STONEWORKS_INPUT_STORAGE_TONS,
    inboundShippedTonsPerDay: 0,
    inboundLimitingFactor: "no-route",
    processedTonsPerDay: 0,
    stoneworksLimitingFactor: "input-shortage",
    outboundAvailableTonsPerDay: 0,
    outboundRequestedTonsPerDay: MARKET_DAILY_DEMAND_TONS,
    outboundShippedTonsPerDay: 0,
    outboundLimitingFactor: "inventory",
  });
}

function finiteInRange(
  value: number,
  name: string,
  maximum = Number.POSITIVE_INFINITY,
): void {
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} is outside its valid range`);
  }
}

export function validateStoneSupplyChainState(
  state: StoneSupplyChainStateSnapshot,
  simulationTick: number,
): StoneSupplyChainStateSnapshot {
  if (
    !Number.isSafeInteger(state.processedTick) ||
    state.processedTick !== simulationTick ||
    (state.lastUpdateTick !== null &&
      (!Number.isSafeInteger(state.lastUpdateTick) ||
        state.lastUpdateTick > simulationTick)) ||
    !Number.isSafeInteger(state.nextUpdateTick) ||
    state.nextUpdateTick <= simulationTick ||
    state.nextUpdateTick % SUPPLY_CHAIN_UPDATE_INTERVAL_TICKS !== 0
  ) {
    throw new RangeError("saved supply-chain cadence is inconsistent");
  }
  finiteInRange(
    state.inputInventoryTons,
    "stoneworks input inventory",
    STONEWORKS_INPUT_STORAGE_TONS,
  );
  finiteInRange(
    state.finishedStoneInventoryTons,
    "stoneworks finished inventory",
    STONEWORKS_OUTPUT_STORAGE_TONS,
  );
  for (const [name, value] of [
    ["inbound available", state.inboundAvailableTonsPerDay],
    ["inbound requested", state.inboundRequestedTonsPerDay],
    ["inbound shipped", state.inboundShippedTonsPerDay],
    ["processed", state.processedTonsPerDay],
    ["outbound available", state.outboundAvailableTonsPerDay],
    ["outbound requested", state.outboundRequestedTonsPerDay],
    ["outbound shipped", state.outboundShippedTonsPerDay],
  ] as const) {
    finiteInRange(value, name);
  }
  return Object.freeze({ ...state });
}

export function advanceStoneSupplyChainDay(
  state: StoneSupplyChainStateSnapshot,
  updateTick: number,
  inboundRoute: RoadRoute | undefined,
  outboundRoute: RoadRoute | undefined,
): StoneSupplyChainStateSnapshot {
  if (updateTick !== state.nextUpdateTick) {
    throw new RangeError("supply chain must advance at its next daily boundary");
  }

  const inboundAvailableTonsPerDay = QUARRY_DAILY_OUTPUT_TONS;
  const inboundRequestedTonsPerDay = roundTons(
    STONEWORKS_INPUT_STORAGE_TONS - state.inputInventoryTons,
  );
  const inbound = assignFreight(
    inboundAvailableTonsPerDay,
    inboundRequestedTonsPerDay,
    inboundRoute,
    "production",
    "input-storage",
  );
  const inputAvailable = roundTons(
    state.inputInventoryTons + inbound.shippedTonsPerDay,
  );
  const outputRoom = roundTons(
    STONEWORKS_OUTPUT_STORAGE_TONS - state.finishedStoneInventoryTons,
  );
  const processedTonsPerDay = roundTons(
    Math.min(
      inputAvailable,
      STONEWORKS_PROCESSING_TONS_PER_DAY,
      outputRoom,
    ),
  );
  const stoneworksLimitingFactor: StoneworksLimitingFactor =
    inputAvailable < STONEWORKS_PROCESSING_TONS_PER_DAY
      ? "input-shortage"
      : outputRoom < STONEWORKS_PROCESSING_TONS_PER_DAY
        ? "output-storage"
        : "processing-capacity";

  const outboundAvailableTonsPerDay = roundTons(
    state.finishedStoneInventoryTons + processedTonsPerDay,
  );
  const outboundRequestedTonsPerDay = MARKET_DAILY_DEMAND_TONS;
  const outbound = assignFreight(
    outboundAvailableTonsPerDay,
    outboundRequestedTonsPerDay,
    outboundRoute,
    "inventory",
    "market-demand",
  );

  return Object.freeze({
    processedTick: updateTick,
    lastUpdateTick: updateTick,
    nextUpdateTick: updateTick + SUPPLY_CHAIN_UPDATE_INTERVAL_TICKS,
    inputInventoryTons: roundTons(
      inputAvailable - processedTonsPerDay,
    ),
    finishedStoneInventoryTons: roundTons(
      outboundAvailableTonsPerDay - outbound.shippedTonsPerDay,
    ),
    inboundAvailableTonsPerDay,
    inboundRequestedTonsPerDay,
    inboundShippedTonsPerDay: inbound.shippedTonsPerDay,
    inboundLimitingFactor: inbound.limitingFactor,
    processedTonsPerDay,
    stoneworksLimitingFactor,
    outboundAvailableTonsPerDay,
    outboundRequestedTonsPerDay,
    outboundShippedTonsPerDay: outbound.shippedTonsPerDay,
    outboundLimitingFactor: outbound.limitingFactor,
  });
}

export function markStoneSupplyChainProcessed(
  state: StoneSupplyChainStateSnapshot,
  targetTick: number,
): StoneSupplyChainStateSnapshot {
  if (
    !Number.isSafeInteger(targetTick) ||
    targetTick < state.processedTick ||
    targetTick >= state.nextUpdateTick
  ) {
    throw new RangeError("supply-chain target tick is outside its cadence");
  }
  return targetTick === state.processedTick
    ? state
    : Object.freeze({ ...state, processedTick: targetTick });
}

function freightReason(
  factor: FreightLimitingFactor,
  commodity: "raw granite" | "finished stone",
  routeCost: number | null,
): string {
  switch (factor) {
    case "no-route":
      return `No connected road route can carry ${commodity}.`;
    case "route-cost":
      return routeCost === null
        ? `No viable route can carry ${commodity}.`
        : `Route cost at the last daily update limited ${commodity} shipments.`;
    case "production":
      return "Quarry output is the limit on inbound granite.";
    case "input-storage":
      return "Available stoneworks input storage limits inbound granite.";
    case "inventory":
      return "Finished-stone inventory limits outbound shipments.";
    case "market-demand":
      return "External market demand limits finished-stone shipments.";
  }
}

function effectiveFreight(
  factor: FreightLimitingFactor,
  shippedTonsPerDay: number,
  route: RoadRoute | undefined,
): Pick<AggregateFreightSnapshot, "shippedTonsPerDay" | "limitingFactor"> {
  if (!route) {
    return { shippedTonsPerDay: 0, limitingFactor: "no-route" };
  }
  if (routeShare(route) === 0) {
    return { shippedTonsPerDay: 0, limitingFactor: "route-cost" };
  }
  return { shippedTonsPerDay, limitingFactor: factor };
}

export function createStoneSupplyChainSnapshot(
  geography: ScenarioGeography,
  state: StoneSupplyChainStateSnapshot,
  inboundRoute: RoadRoute | undefined,
  outboundRoute: RoadRoute | undefined,
): StoneSupplyChainSnapshot {
  const inbound = effectiveFreight(
    state.inboundLimitingFactor,
    state.inboundShippedTonsPerDay,
    inboundRoute,
  );
  const outbound = effectiveFreight(
    state.outboundLimitingFactor,
    state.outboundShippedTonsPerDay,
    outboundRoute,
  );
  const laborOpportunity = roundTons(
    (state.processedTonsPerDay / STONEWORKS_PROCESSING_TONS_PER_DAY) *
      STONEWORKS_MAX_LABOR_OPPORTUNITY,
  );
  const industryReason =
    state.stoneworksLimitingFactor === "input-shortage"
      ? "Available raw-granite input limits processing."
      : state.stoneworksLimitingFactor === "output-storage"
        ? "Finished-stone storage space limits processing."
        : "Daily stoneworks processing capacity is fully used.";

  return Object.freeze({
    updateIntervalTicks: SUPPLY_CHAIN_UPDATE_INTERVAL_TICKS,
    lastUpdateTick: state.lastUpdateTick,
    nextUpdateTick: state.nextUpdateTick,
    inboundFreight: Object.freeze({
      id: "stone-supply-inbound",
      commodity: "raw-granite",
      originId: geography.quarry.id,
      destinationId: geography.stoneworks.id,
      availableTonsPerDay: state.inboundAvailableTonsPerDay,
      requestedTonsPerDay: state.inboundRequestedTonsPerDay,
      shippedTonsPerDay: inbound.shippedTonsPerDay,
      route: inboundRoute ?? null,
      routeCost: inboundRoute?.generalizedCostHours ?? null,
      limitingFactor: inbound.limitingFactor,
      limitingReason: freightReason(
        inbound.limitingFactor,
        "raw granite",
        inboundRoute?.generalizedCostHours ?? null,
      ),
    }),
    stoneworks: Object.freeze({
      id: geography.stoneworks.id,
      name: geography.stoneworks.name,
      active: state.processedTonsPerDay > 0,
      inputStorageCapacityTons: STONEWORKS_INPUT_STORAGE_TONS,
      inputInventoryTons: state.inputInventoryTons,
      processingCapacityTonsPerDay: STONEWORKS_PROCESSING_TONS_PER_DAY,
      processedTonsPerDay: state.processedTonsPerDay,
      outputStorageCapacityTons: STONEWORKS_OUTPUT_STORAGE_TONS,
      finishedStoneInventoryTons: state.finishedStoneInventoryTons,
      laborOpportunity,
      limitingFactor: state.stoneworksLimitingFactor,
      limitingReason: industryReason,
    }),
    outboundFreight: Object.freeze({
      id: "stone-supply-outbound",
      commodity: "finished-stone",
      originId: geography.stoneworks.id,
      destinationId: geography.externalMarketConnection.id,
      availableTonsPerDay: state.outboundAvailableTonsPerDay,
      requestedTonsPerDay: state.outboundRequestedTonsPerDay,
      shippedTonsPerDay: outbound.shippedTonsPerDay,
      route: outboundRoute ?? null,
      routeCost: outboundRoute?.generalizedCostHours ?? null,
      limitingFactor: outbound.limitingFactor,
      limitingReason: freightReason(
        outbound.limitingFactor,
        "finished stone",
        outboundRoute?.generalizedCostHours ?? null,
      ),
    }),
  });
}
