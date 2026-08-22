import type { AccessibilitySnapshot } from "./accessibility";
import type { AggregateFreightSnapshot } from "./economy";
import type { Point, ScenarioGeography } from "./geography";
import type { RoadNetwork } from "./roads";

export const TICKS_PER_DAY = 24;

export type SimulationCommand =
  | { readonly type: "advance"; readonly ticks: number }
  | { readonly type: "reset" }
  | {
      readonly type: "build-road";
      readonly start: Point;
      readonly end: Point;
    }
  | { readonly type: "remove-road"; readonly roadSegmentId: string };

export interface SimulationSnapshot {
  readonly seed: string;
  readonly tick: number;
  readonly elapsedDays: number;
  readonly geography: ScenarioGeography;
  readonly roadNetwork: RoadNetwork;
  readonly quarryMarketFreight: AggregateFreightSnapshot;
  readonly accessibility: AccessibilitySnapshot;
}
