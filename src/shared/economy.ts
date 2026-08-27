import type { RailRoute } from "./rail";
import type { RoadRoute } from "./roads";

export type FreightCommodity = "raw-granite" | "finished-stone";
export type FreightMode = "road" | "rail";

export type FreightRoute =
  | (RoadRoute & { readonly mode: "road" })
  | (RailRoute & { readonly mode: "rail" });

export interface FreightServiceCandidateSnapshot {
  readonly mode: FreightMode;
  readonly viable: boolean;
  readonly assignedTonsPerDay: number;
  readonly generalizedCostHours: number | null;
  readonly capacityTonsPerDay: number;
  readonly freeFlowTravelTimeHours: number | null;
  readonly congestionDelayHours: number;
  readonly terminalHandlingTimeHours: number;
  readonly accessEgressTimeHours: number;
  readonly priceAdjustmentHours: number;
  readonly route: FreightRoute | null;
  readonly reason: string;
}

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
  readonly demandTonsPerDay: number;
  readonly assignedTonsPerDay: number;
  readonly shippedTonsPerDay: number;
  readonly chosenMode: FreightMode | null;
  readonly route: FreightRoute | null;
  readonly routeCost: number | null;
  readonly serviceCandidates: readonly FreightServiceCandidateSnapshot[];
  readonly serviceChoiceReason: string;
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
