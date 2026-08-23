import type {
  AggregateFreightSnapshot,
  RoadRoute,
  ScenarioGeography,
} from "../../shared";

export const QUARRY_DAILY_OUTPUT_TONS = 120;
export const MARKET_DAILY_DEMAND_TONS = 100;
export const FULL_VOLUME_ROUTE_COST = 16;
export const MAXIMUM_VIABLE_ROUTE_COST = 32;

interface FreightAssignmentInput {
  readonly producerId: string;
  readonly marketId: string;
  readonly productionTonsPerDay: number;
  readonly demandTonsPerDay: number;
  readonly route: RoadRoute | undefined;
}

function nonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }

  return value;
}

function roundTons(value: number): number {
  return Math.round(value * 10) / 10;
}

export function assignAggregateFreight({
  producerId,
  marketId,
  productionTonsPerDay: productionInput,
  demandTonsPerDay: demandInput,
  route,
}: FreightAssignmentInput): AggregateFreightSnapshot {
  const productionTonsPerDay = nonNegativeFinite(
    productionInput,
    "daily production",
  );
  const demandTonsPerDay = nonNegativeFinite(demandInput, "daily demand");

  if (!route) {
    return Object.freeze({
      commodity: "granite",
      producerId,
      marketId,
      productionTonsPerDay,
      demandTonsPerDay,
      shippedTonsPerDay: 0,
      route: null,
      routeCost: null,
      limitingFactor: "no-route",
      limitingReason: "No connected road route reaches the external market.",
    });
  }

  const routeCost = nonNegativeFinite(
    route.generalizedCostHours,
    "route cost",
  );
  if (routeCost >= MAXIMUM_VIABLE_ROUTE_COST) {
    return Object.freeze({
      commodity: "granite",
      producerId,
      marketId,
      productionTonsPerDay,
      demandTonsPerDay,
      shippedTonsPerDay: 0,
      route,
      routeCost,
      limitingFactor: "route-cost",
      limitingReason: `The ${routeCost.toFixed(1)}-hour route costs too much to serve.`,
    });
  }

  const availableTonsPerDay = Math.min(
    productionTonsPerDay,
    demandTonsPerDay,
  );
  const routeShare =
    routeCost <= FULL_VOLUME_ROUTE_COST
      ? 1
      : (MAXIMUM_VIABLE_ROUTE_COST - routeCost) /
        (MAXIMUM_VIABLE_ROUTE_COST - FULL_VOLUME_ROUTE_COST);
  const routeLimitedTonsPerDay = roundTons(availableTonsPerDay * routeShare);
  const shippedTonsPerDay = Math.min(
    availableTonsPerDay,
    routeLimitedTonsPerDay,
  );

  if (shippedTonsPerDay < availableTonsPerDay) {
    return Object.freeze({
      commodity: "granite",
      producerId,
      marketId,
      productionTonsPerDay,
      demandTonsPerDay,
      shippedTonsPerDay,
      route,
      routeCost,
      limitingFactor: "route-cost",
      limitingReason: `Congested route cost limits shipments to ${shippedTonsPerDay} tons per day.`,
    });
  }

  const productionLimited = productionTonsPerDay < demandTonsPerDay;
  return Object.freeze({
    commodity: "granite",
    producerId,
    marketId,
    productionTonsPerDay,
    demandTonsPerDay,
    shippedTonsPerDay,
    route,
    routeCost,
    limitingFactor: productionLimited ? "production" : "demand",
    limitingReason: productionLimited
      ? "Quarry output is the limit on daily shipments."
      : "External market demand is the limit on daily shipments.",
  });
}

export function createQuarryMarketFreight(
  geography: ScenarioGeography,
  route: RoadRoute | undefined,
): AggregateFreightSnapshot {
  return assignAggregateFreight({
    producerId: geography.quarry.id,
    marketId: geography.externalMarketConnection.id,
    productionTonsPerDay: QUARRY_DAILY_OUTPUT_TONS,
    demandTonsPerDay: MARKET_DAILY_DEMAND_TONS,
    route,
  });
}
