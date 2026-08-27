import type { FreightLimitingFactor, FreightMode, StoneworksLimitingFactor } from "./economy";
import type { InfrastructureTransactionKind } from "./finances";
import type { ScenarioSuccessConditionsSnapshot } from "./scenario-progress";

export type ExplanationUnit =
  | "tons"
  | "tons/day"
  | "hours"
  | "access points"
  | "currency"
  | "currency/day"
  | "links"
  | "residents";

export interface AuthoritativeValueExplanation {
  readonly label: string;
  readonly value: number;
  readonly unit: ExplanationUnit;
}

export interface FreightServiceExplanation {
  readonly mode: FreightMode;
  readonly status: "chosen" | "alternative" | "unavailable";
  readonly generalizedCostHours: number | null;
  readonly costDifferenceFromChosenHours: number | null;
  readonly capacityTonsPerDay: number;
  readonly freeFlowTravelTimeHours: number | null;
  readonly congestionDelayHours: number;
  readonly terminalHandlingTimeHours: number;
  readonly accessEgressTimeHours: number;
  readonly priceAdjustmentHours: number;
  readonly routeLinkIds: readonly string[];
  readonly reason: string;
}

export interface FreightLegExplanation {
  readonly legId: string;
  readonly actorName: string;
  readonly commodityName: string;
  readonly origin: { readonly id: string; readonly name: string };
  readonly destination: { readonly id: string; readonly name: string };
  readonly chosenMode: FreightMode | null;
  readonly routeLinkIds: readonly string[];
  readonly routeGeneralizedCostHours: number | null;
  readonly limitingFactor: FreightLimitingFactor;
  readonly limitingReason: string;
  readonly limitingValues: readonly AuthoritativeValueExplanation[];
  readonly services: readonly FreightServiceExplanation[];
  readonly nextAssignmentTick: number;
  readonly choiceCanChangeBecause: string;
}

export interface ProductionExplanation {
  readonly siteId: string;
  readonly siteName: string;
  readonly limitingFactor: StoneworksLimitingFactor;
  readonly limitingReason: string;
  readonly limitingValues: readonly AuthoritativeValueExplanation[];
}

export interface FinanceEffectsExplanation {
  readonly balance: number;
  readonly latestCapitalTransaction: {
    readonly tick: number;
    readonly kind: InfrastructureTransactionKind;
    readonly baseConstruction: number;
    readonly landAcquisition: number;
    readonly crossingWork: number;
    readonly salvageCredit: number;
    readonly netTreasuryEffect: number;
  } | null;
  readonly roadAndCrossingMaintenancePerDay: number;
  readonly railMaintenancePerDay: number;
  readonly totalMaintenancePerDay: number;
  readonly lastOperatingRevenue: number;
  readonly totalOperatingRevenue: number;
  readonly emergencyProceedsReceived: number;
  readonly emergencyPenaltyPerDay: number;
  readonly totalEmergencyPenaltiesPaid: number;
}

export interface DevelopmentConsequenceExplanation {
  readonly locationId: string;
  readonly name: string;
  readonly baselineTick: number | null;
  readonly baselineAccessibility: number;
  readonly currentAccessibility: number;
  readonly change: number;
  readonly direction: "gain" | "loss" | "unchanged";
}

export type ConsequenceForecastKind =
  | "traffic-assignment"
  | "economy-and-finance"
  | "development";

export interface ConsequenceForecastEntry {
  readonly kind: ConsequenceForecastKind;
  readonly tick: number;
  readonly inTicks: number;
  readonly summary: string;
  readonly values: readonly AuthoritativeValueExplanation[];
}

export interface SimulationExplanationsSnapshot {
  readonly freightLegs: readonly FreightLegExplanation[];
  readonly production: ProductionExplanation;
  readonly finance: FinanceEffectsExplanation;
  readonly developmentSinceIntervention: readonly DevelopmentConsequenceExplanation[];
  readonly objectiveDecision: {
    readonly conditions: ScenarioSuccessConditionsSnapshot;
    readonly values: readonly AuthoritativeValueExplanation[];
  };
  readonly consequenceForecast: readonly ConsequenceForecastEntry[];
}
