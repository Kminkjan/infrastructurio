import type { RoadRoute } from "./roads";

export type FreightCommodity = "raw-granite" | "finished-stone";

export type FreightLimitingFactor =
  | "no-route"
  | "route-cost"
  | "production"
  | "input-storage"
  | "inventory"
  | "market-demand";

export type StoneworksLimitingFactor =
  | "input-shortage"
  | "processing-capacity"
  | "output-storage";

export interface AggregateFreightSnapshot {
  readonly id: "stone-supply-inbound" | "stone-supply-outbound";
  readonly commodity: FreightCommodity;
  readonly originId: string;
  readonly destinationId: string;
  readonly availableTonsPerDay: number;
  readonly requestedTonsPerDay: number;
  readonly shippedTonsPerDay: number;
  readonly route: RoadRoute | null;
  readonly routeCost: number | null;
  readonly limitingFactor: FreightLimitingFactor;
  readonly limitingReason: string;
}

export interface StoneworksSnapshot {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly inputStorageCapacityTons: number;
  readonly inputInventoryTons: number;
  readonly processingCapacityTonsPerDay: number;
  readonly processedTonsPerDay: number;
  readonly outputStorageCapacityTons: number;
  readonly finishedStoneInventoryTons: number;
  readonly laborOpportunity: number;
  readonly limitingFactor: StoneworksLimitingFactor;
  readonly limitingReason: string;
}

export interface StoneSupplyChainSnapshot {
  readonly updateIntervalTicks: number;
  readonly lastUpdateTick: number | null;
  readonly nextUpdateTick: number;
  readonly inboundFreight: AggregateFreightSnapshot;
  readonly stoneworks: StoneworksSnapshot;
  readonly outboundFreight: AggregateFreightSnapshot;
}
