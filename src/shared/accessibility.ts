import type { Point } from "./geography";

export type AccessibilityFactor =
  | "market"
  | "labor"
  | "resource"
  | "service";

export interface AccessibilityFactorValue {
  readonly score: number;
  readonly nearestNetworkCost: number | null;
  readonly reachableOpportunityCount: number;
}

export interface LocationAccessibility {
  readonly locationId: string;
  readonly name: string;
  readonly position: Point;
  readonly market: AccessibilityFactorValue;
  readonly labor: AccessibilityFactorValue;
  readonly resource: AccessibilityFactorValue;
  readonly service: AccessibilityFactorValue;
}

export interface AccessibilitySnapshot {
  readonly locations: readonly LocationAccessibility[];
  readonly lastNetworkUpdateInvalidatedLocationIds: readonly string[];
}
