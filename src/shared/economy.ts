import type { RoadRoute } from "./roads";

export type FreightLimitingFactor =
  | "no-route"
  | "route-cost"
  | "production"
  | "demand";

export interface AggregateFreightSnapshot {
  readonly commodity: "granite";
  readonly producerId: string;
  readonly marketId: string;
  readonly productionTonsPerDay: number;
  readonly demandTonsPerDay: number;
  readonly shippedTonsPerDay: number;
  readonly route: RoadRoute | null;
  readonly routeCost: number | null;
  readonly limitingFactor: FreightLimitingFactor;
  readonly limitingReason: string;
}
