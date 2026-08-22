import type { Point } from "./geography";

export type DevelopmentStatus =
  | "stable"
  | "growing"
  | "pressured"
  | "declining";

export interface PendingConstruction {
  readonly id: string;
  readonly locationId: string;
  readonly population: number;
  readonly startedTick: number;
  readonly completesTick: number;
}

export interface DevelopmentLocationSnapshot {
  readonly locationId: string;
  readonly name: string;
  readonly position: Point;
  readonly basePopulation: number;
  readonly growthPopulation: number;
  readonly totalPopulation: number;
  readonly pressure: number;
  readonly status: DevelopmentStatus;
  readonly pendingConstruction: PendingConstruction | null;
}

export interface RegionalDevelopmentDemandSnapshot {
  readonly targetGrowthPopulation: number;
  readonly completedGrowthPopulation: number;
  readonly committedGrowthPopulation: number;
  readonly remainingGrowthPopulation: number;
}

export interface DevelopmentSnapshot {
  readonly demand: RegionalDevelopmentDemandSnapshot;
  readonly locations: readonly DevelopmentLocationSnapshot[];
  readonly lastEvaluationTick: number | null;
  readonly nextEvaluationTick: number;
}
