export type InfrastructureKind = "road" | "rail";
export type InfrastructureTransactionKind =
  | "construction"
  | "upgrade"
  | "removal";

export interface InfrastructureCostBreakdown {
  readonly infrastructureKind: InfrastructureKind;
  readonly transactionKind: InfrastructureTransactionKind;
  readonly infrastructureClass: string;
  readonly length: number;
  readonly baseCost: number;
  readonly landAcquisitionCost: number;
  readonly crossingWorkCost: number;
  readonly totalCost: number;
  readonly salvageCredit: number;
  readonly netCost: number;
  readonly affectedLandIds: readonly string[];
  readonly riverCrossingCount: number;
}

export interface InfrastructureTransactionQuote {
  readonly breakdown: InfrastructureCostBreakdown;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
  readonly affordable: boolean;
}

export interface CommittedInfrastructureTransaction
  extends InfrastructureTransactionQuote {
  readonly tick: number;
}

export interface EmergencyFinanceSnapshot {
  readonly bondAvailable: boolean;
  readonly bondsIssued: number;
  readonly bondProceeds: number;
  readonly eligibilityBalance: number;
  readonly penaltyPerBondPerDay: number;
  readonly dailyPenalty: number;
  readonly totalPenaltiesPaid: number;
}

export interface FinanceSnapshot {
  readonly balance: number;
  readonly totalCapitalSpending: number;
  readonly totalOperatingRevenue: number;
  readonly dailyMaintenance: number;
  readonly totalMaintenancePaid: number;
  readonly totalSalvageRevenue: number;
  readonly lastDailyRevenue: number;
  readonly lastDailyMaintenance: number;
  readonly emergencyFinance: EmergencyFinanceSnapshot;
  readonly lastInfrastructureTransaction:
    | CommittedInfrastructureTransaction
    | null;
}
