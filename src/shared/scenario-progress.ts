export type ScenarioObjectiveId =
  | "inspect-network"
  | "activate-supply-chain"
  | "observe-pressure"
  | "intervene"
  | "stabilize";

export interface ScenarioObjectiveSnapshot {
  readonly id: ScenarioObjectiveId;
  readonly title: string;
  readonly guidance: string;
  readonly complete: boolean;
  readonly progressLabel: string;
}

export interface ScenarioSuccessConditionsSnapshot {
  readonly bothLegsServed: boolean;
  readonly bridgeRelievedOrFreightShifted: boolean;
  readonly infrastructureGrowthCompleted: boolean;
  readonly financesMaintainable: boolean;
}

export type ScenarioInterventionChoice =
  | "bridge-upgrade"
  | "road-bypass"
  | "rail-shift"
  | "combined";

export interface ScenarioAccessibilityChange {
  readonly locationId: string;
  readonly name: string;
  readonly initialScore: number;
  readonly finalScore: number;
  readonly change: number;
}

export interface ScenarioEndingSummary {
  readonly completedTick: number;
  readonly intervention: ScenarioInterventionChoice;
  readonly totalCapitalSpending: number;
  readonly totalMaintenancePaid: number;
  readonly dailyMaintenance: number;
  readonly roadFreightTonsPerDay: number;
  readonly railFreightTonsPerDay: number;
  readonly roadFreightShare: number;
  readonly railFreightShare: number;
  readonly bridgeStatus: "relieved" | "unused" | "removed";
  readonly bridgeAssignedTonsPerDay: number;
  readonly bridgeCapacityTonsPerDay: number;
  readonly accessibilityChanges: readonly ScenarioAccessibilityChange[];
}

export interface ScenarioProgressSnapshot {
  readonly objectives: readonly ScenarioObjectiveSnapshot[];
  readonly activeObjectiveId: ScenarioObjectiveId | null;
  readonly inspectedEntityIds: readonly string[];
  readonly successfulDays: number;
  readonly requiredSuccessfulDays: number;
  readonly successConditions: ScenarioSuccessConditionsSnapshot;
  readonly success: boolean;
  readonly ending: ScenarioEndingSummary | null;
}

export interface SimulationTimeSnapshot {
  readonly trafficUpdateIntervalTicks: number;
  readonly economyUpdateIntervalTicks: number;
  readonly developmentUpdateIntervalTicks: number;
  readonly nextTrafficUpdateTick: number;
  readonly nextEconomyUpdateTick: number;
  readonly nextMaintenanceUpdateTick: number;
  readonly nextDevelopmentUpdateTick: number;
}
