import type { AccessibilitySnapshot } from "./accessibility";
import type { BottleneckAnalysisSnapshot } from "./bottlenecks";
import type { StoneSupplyChainSnapshot } from "./economy";
import type { FreightMode } from "./economy";
import type { FinanceSnapshot } from "./finances";
import type { DevelopmentSnapshot } from "./development";
import type { Point, ScenarioGeography } from "./geography";
import type { RoadClass, RoadNetwork } from "./roads";
import type { RailNetwork, RailTerminalSite } from "./rail";
import type { SimulationExplanationsSnapshot } from "./explanations";
import type {
  ScenarioProgressSnapshot,
  SimulationTimeSnapshot,
} from "./scenario-progress";

export const TICKS_PER_DAY = 24;

export type SimulationCommand =
  | { readonly type: "advance"; readonly ticks: number }
  | { readonly type: "reset" }
  | { readonly type: "inspect-entity"; readonly entityId: string }
  | {
      readonly type: "build-road";
      readonly start: Point;
      readonly end: Point;
      readonly roadClass?: RoadClass;
    }
  | { readonly type: "upgrade-road"; readonly roadSegmentId: string }
  | { readonly type: "remove-road"; readonly roadSegmentId: string }
  | {
      readonly type: "build-rail-track";
      readonly start: Point;
      readonly end: Point;
    }
  | { readonly type: "remove-rail-track"; readonly railTrackId: string }
  | {
      readonly type: "place-freight-rail-terminal";
      readonly site: RailTerminalSite;
    }
  | {
      readonly type: "remove-freight-rail-terminal";
      readonly railTerminalId: string;
    }
  | {
      readonly type: "set-freight-service-price";
      readonly mode: FreightMode;
      readonly adjustmentHours: number;
    }
  | { readonly type: "issue-emergency-bond" };

export interface SimulationSnapshot {
  readonly seed: string;
  readonly tick: number;
  readonly elapsedDays: number;
  readonly time: SimulationTimeSnapshot;
  readonly geography: ScenarioGeography;
  readonly roadNetwork: RoadNetwork;
  readonly railNetwork: RailNetwork;
  readonly stoneSupplyChain: StoneSupplyChainSnapshot;
  readonly finances: FinanceSnapshot;
  readonly bottlenecks: BottleneckAnalysisSnapshot;
  readonly accessibility: AccessibilitySnapshot;
  readonly development: DevelopmentSnapshot;
  readonly scenarioProgress: ScenarioProgressSnapshot;
  readonly explanations: SimulationExplanationsSnapshot;
}
