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

export type DevelopmentAccessFactor =
  | "market"
  | "labor"
  | "resource"
  | "service";

export type DevelopmentDecisionOutcome =
  | "not-evaluated"
  | "selected"
  | "not-selected"
  | "not-viable"
  | "regional-demand-met";

export interface DevelopmentAccessFactorExplanation {
  readonly factor: DevelopmentAccessFactor;
  readonly accessScore: number;
  readonly weight: number;
  readonly contributionPoints: number;
  readonly nearestNetworkCost: number | null;
  readonly reachableOpportunityCount: number;
  readonly bestAlternativeLocationId: string | null;
  readonly bestAlternativeName: string | null;
  readonly differenceFromBestAlternativePoints: number | null;
}

export interface DevelopmentTransportExplanation {
  readonly marketNetworkCost: number | null;
  readonly bestAlternativeLocationId: string | null;
  readonly bestAlternativeName: string | null;
  readonly bestAlternativeMarketNetworkCost: number | null;
}

export interface DevelopmentLandExplanation {
  readonly costPoints: number;
  readonly cheapestAlternativeLocationId: string | null;
  readonly cheapestAlternativeName: string | null;
  readonly differenceFromCheapestAlternativePoints: number | null;
}

export interface DevelopmentDecisionExplanation {
  readonly outcome: DevelopmentDecisionOutcome;
  readonly selectionWeight: number;
  readonly selectionShare: number;
  readonly selectedLocationId: string | null;
  readonly selectedLocationName: string | null;
  readonly accessFactors: readonly DevelopmentAccessFactorExplanation[];
  readonly transport: DevelopmentTransportExplanation;
  readonly land: DevelopmentLandExplanation;
  readonly strongestPositiveFactor: DevelopmentAccessFactorExplanation | null;
  readonly strongestNegativeFactor: DevelopmentLandExplanation;
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
  readonly decision: DevelopmentDecisionExplanation;
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
