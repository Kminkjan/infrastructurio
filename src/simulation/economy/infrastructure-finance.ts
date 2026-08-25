import type {
  CommittedInfrastructureTransaction,
  FinanceSnapshot,
  InfrastructureCostBreakdown,
  InfrastructureTransactionQuote,
  Point,
  RoadClass,
  RoadNetwork,
  RoadSegment,
  ScenarioGeography,
} from "../../shared";

export const STARTING_TREASURY_BALANCE = 60_000;
export const FINISHED_STONE_REVENUE_PER_TON = 25;
export const MAX_FINISHED_STONE_REVENUE_TONS_PER_DAY = 100;
export const EMERGENCY_BOND_PROCEEDS = 15_000;
export const EMERGENCY_BOND_DAILY_PENALTY = 150;
export const EMERGENCY_BOND_ELIGIBILITY_BALANCE = 15_000;
export const ROAD_SALVAGE_RATE = 0.2;

const ROAD_CONSTRUCTION_COST_PER_UNIT: Readonly<Record<RoadClass, number>> =
  Object.freeze({
    local: 6,
    arterial: 16,
    highway: 32,
  });
const ROAD_LAND_COST_PER_UNIT: Readonly<Record<RoadClass, number>> =
  Object.freeze({
    local: 4,
    arterial: 8,
    highway: 14,
  });
const ROAD_CROSSING_COST: Readonly<Record<RoadClass, number>> = Object.freeze({
  local: 1_500,
  arterial: 3_500,
  highway: 7_000,
});
const ROAD_MAINTENANCE_PER_UNIT: Readonly<Record<RoadClass, number>> =
  Object.freeze({
    local: 0.03,
    arterial: 0.08,
    highway: 0.18,
  });
const ROAD_CROSSING_MAINTENANCE: Readonly<Record<RoadClass, number>> =
  Object.freeze({
    local: 15,
    arterial: 35,
    highway: 70,
  });

const GEOMETRY_EPSILON = 1e-8;

export interface FinanceStateSnapshot {
  readonly processedTick: number;
  readonly balance: number;
  readonly totalCapitalSpending: number;
  readonly totalOperatingRevenue: number;
  readonly totalMaintenancePaid: number;
  readonly totalSalvageRevenue: number;
  readonly lastDailyRevenue: number;
  readonly lastDailyMaintenance: number;
  readonly emergencyBondCount: number;
  readonly totalEmergencyPenalties: number;
  readonly lastInfrastructureTransaction:
    | CommittedInfrastructureTransaction
    | null;
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roadLength(segment: Pick<RoadSegment, "start" | "end">): number {
  return Math.hypot(
    segment.end.x - segment.start.x,
    segment.end.y - segment.start.y,
  );
}

function cross(first: Point, second: Point): number {
  return first.x * second.y - first.y * second.x;
}

function intersectionParameter(
  start: Point,
  end: Point,
  edgeStart: Point,
  edgeEnd: Point,
): number | undefined {
  const direction = { x: end.x - start.x, y: end.y - start.y };
  const edgeDirection = {
    x: edgeEnd.x - edgeStart.x,
    y: edgeEnd.y - edgeStart.y,
  };
  const denominator = cross(direction, edgeDirection);
  if (Math.abs(denominator) <= GEOMETRY_EPSILON) {
    return undefined;
  }
  const offset = { x: edgeStart.x - start.x, y: edgeStart.y - start.y };
  const roadParameter = cross(offset, edgeDirection) / denominator;
  const edgeParameter = cross(offset, direction) / denominator;
  return roadParameter >= -GEOMETRY_EPSILON &&
    roadParameter <= 1 + GEOMETRY_EPSILON &&
    edgeParameter >= -GEOMETRY_EPSILON &&
    edgeParameter <= 1 + GEOMETRY_EPSILON
    ? Math.min(1, Math.max(0, roadParameter))
    : undefined;
}

function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current, current += 1
  ) {
    const first = polygon[current]!;
    const second = polygon[previous]!;
    const crossesRay =
      first.y > point.y !== second.y > point.y &&
      point.x <
        ((second.x - first.x) * (point.y - first.y)) /
          (second.y - first.y) +
          first.x;
    if (crossesRay) {
      inside = !inside;
    }
  }
  return inside;
}

function lengthInsidePolygon(
  start: Point,
  end: Point,
  polygon: readonly Point[],
): number {
  const parameters = [0, 1];
  for (let index = 0; index < polygon.length; index += 1) {
    const parameter = intersectionParameter(
      start,
      end,
      polygon[index]!,
      polygon[(index + 1) % polygon.length]!,
    );
    if (parameter !== undefined) {
      parameters.push(parameter);
    }
  }
  const ordered = [...new Set(parameters.map((value) => value.toFixed(10)))]
    .map(Number)
    .sort((first, second) => first - second);
  const totalLength = Math.hypot(end.x - start.x, end.y - start.y);
  let insideLength = 0;
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const from = ordered[index]!;
    const to = ordered[index + 1]!;
    const midpoint = (from + to) / 2;
    if (
      pointInPolygon(
        {
          x: start.x + (end.x - start.x) * midpoint,
          y: start.y + (end.y - start.y) * midpoint,
        },
        polygon,
      )
    ) {
      insideLength += (to - from) * totalLength;
    }
  }
  return insideLength;
}

function riverCrossingCount(
  start: Point,
  end: Point,
  riverPath: readonly Point[],
): number {
  const parameters: number[] = [];
  for (let index = 0; index < riverPath.length - 1; index += 1) {
    const parameter = intersectionParameter(
      start,
      end,
      riverPath[index]!,
      riverPath[index + 1]!,
    );
    if (
      parameter !== undefined &&
      !parameters.some(
        (existing) => Math.abs(existing - parameter) <= GEOMETRY_EPSILON,
      )
    ) {
      parameters.push(parameter);
    }
  }
  return parameters.length;
}

function quote(
  balance: number,
  breakdown: InfrastructureCostBreakdown,
): InfrastructureTransactionQuote {
  const balanceAfter = money(balance - breakdown.netCost);
  return Object.freeze({
    breakdown,
    balanceBefore: balance,
    balanceAfter,
    affordable: breakdown.netCost <= balance,
  });
}

function breakdown(
  transactionKind: InfrastructureCostBreakdown["transactionKind"],
  roadClass: RoadClass,
  length: number,
  baseCost: number,
  landAcquisitionCost: number,
  crossingWorkCost: number,
  salvageCredit: number,
  affectedLandIds: readonly string[],
  crossingCount: number,
): InfrastructureCostBreakdown {
  const roundedBaseCost = money(baseCost);
  const roundedLandCost = money(landAcquisitionCost);
  const roundedCrossingCost = money(crossingWorkCost);
  const roundedSalvage = money(salvageCredit);
  const totalCost = money(
    roundedBaseCost + roundedLandCost + roundedCrossingCost,
  );
  return Object.freeze({
    infrastructureKind: "road",
    transactionKind,
    infrastructureClass: roadClass,
    length: Math.round(length * 1_000) / 1_000,
    baseCost: roundedBaseCost,
    landAcquisitionCost: roundedLandCost,
    crossingWorkCost: roundedCrossingCost,
    totalCost,
    salvageCredit: roundedSalvage,
    netCost: money(totalCost - roundedSalvage),
    affectedLandIds: Object.freeze([...affectedLandIds]),
    riverCrossingCount: crossingCount,
  });
}

export function quoteRoadConstruction(
  balance: number,
  geography: ScenarioGeography,
  segment: Pick<RoadSegment, "roadClass" | "start" | "end">,
): InfrastructureTransactionQuote {
  const length = roadLength(segment);
  const farmlandLength = lengthInsidePolygon(
    segment.start,
    segment.end,
    geography.fertileLand.boundary,
  );
  const crossingCount = riverCrossingCount(
    segment.start,
    segment.end,
    geography.river.path,
  );
  return quote(
    balance,
    breakdown(
      "construction",
      segment.roadClass,
      length,
      length * ROAD_CONSTRUCTION_COST_PER_UNIT[segment.roadClass],
      farmlandLength * ROAD_LAND_COST_PER_UNIT[segment.roadClass],
      crossingCount * ROAD_CROSSING_COST[segment.roadClass],
      0,
      farmlandLength > GEOMETRY_EPSILON ? [geography.fertileLand.id] : [],
      crossingCount,
    ),
  );
}

export function quoteRoadUpgrade(
  balance: number,
  geography: ScenarioGeography,
  segment: RoadSegment,
  targetClass: RoadClass = "highway",
): InfrastructureTransactionQuote {
  const length = roadLength(segment);
  const crossingCount = riverCrossingCount(
    segment.start,
    segment.end,
    geography.river.path,
  );
  const baseRateDifference = Math.max(
    0,
    ROAD_CONSTRUCTION_COST_PER_UNIT[targetClass] -
      ROAD_CONSTRUCTION_COST_PER_UNIT[segment.roadClass],
  );
  const crossingDifference = Math.max(
    0,
    ROAD_CROSSING_COST[targetClass] -
      ROAD_CROSSING_COST[segment.roadClass],
  );
  return quote(
    balance,
    breakdown(
      "upgrade",
      targetClass,
      length,
      length * baseRateDifference,
      0,
      crossingCount * crossingDifference,
      0,
      [],
      crossingCount,
    ),
  );
}

export function quoteRoadRemoval(
  balance: number,
  segment: RoadSegment,
): InfrastructureTransactionQuote {
  const length = roadLength(segment);
  const salvageCredit =
    length * ROAD_CONSTRUCTION_COST_PER_UNIT[segment.roadClass] *
    ROAD_SALVAGE_RATE;
  return quote(
    balance,
    breakdown(
      "removal",
      segment.roadClass,
      length,
      0,
      0,
      0,
      salvageCredit,
      [],
      0,
    ),
  );
}

export function calculateDailyRoadMaintenance(
  geography: ScenarioGeography,
  network: RoadNetwork,
): number {
  return money(
    network.segments.reduce((total, segment) => {
      const crossings = riverCrossingCount(
        segment.start,
        segment.end,
        geography.river.path,
      );
      return (
        total +
        roadLength(segment) * ROAD_MAINTENANCE_PER_UNIT[segment.roadClass] +
        crossings * ROAD_CROSSING_MAINTENANCE[segment.roadClass]
      );
    }, 0),
  );
}

export function createFinanceState(tick: number): FinanceStateSnapshot {
  return Object.freeze({
    processedTick: tick,
    balance: STARTING_TREASURY_BALANCE,
    totalCapitalSpending: 0,
    totalOperatingRevenue: 0,
    totalMaintenancePaid: 0,
    totalSalvageRevenue: 0,
    lastDailyRevenue: 0,
    lastDailyMaintenance: 0,
    emergencyBondCount: 0,
    totalEmergencyPenalties: 0,
    lastInfrastructureTransaction: null,
  });
}

export function validateFinanceState(
  state: FinanceStateSnapshot,
  tick: number,
): FinanceStateSnapshot {
  if (state.processedTick !== tick) {
    throw new RangeError("finance state must match the simulation tick");
  }
  const nonNegativeValues = [
    state.totalCapitalSpending,
    state.totalOperatingRevenue,
    state.totalMaintenancePaid,
    state.totalSalvageRevenue,
    state.lastDailyRevenue,
    state.lastDailyMaintenance,
    state.totalEmergencyPenalties,
  ];
  if (
    !Number.isFinite(state.balance) ||
    nonNegativeValues.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new RangeError("finance values must be finite and totals non-negative");
  }
  if (
    !Number.isSafeInteger(state.emergencyBondCount) ||
    state.emergencyBondCount < 0 ||
    (state.emergencyBondCount === 0 && state.totalEmergencyPenalties > 0)
  ) {
    throw new RangeError("emergency bond state is inconsistent");
  }
  const transaction = state.lastInfrastructureTransaction;
  if (transaction) {
    const { breakdown: cost } = transaction;
    const totalCost = money(
      cost.baseCost + cost.landAcquisitionCost + cost.crossingWorkCost,
    );
    if (
      !Number.isSafeInteger(transaction.tick) ||
      transaction.tick < 0 ||
      transaction.tick > tick ||
      !transaction.affordable ||
      !Number.isFinite(transaction.balanceBefore) ||
      !Number.isFinite(transaction.balanceAfter) ||
      cost.totalCost !== totalCost ||
      cost.netCost !== money(cost.totalCost - cost.salvageCredit) ||
      transaction.balanceAfter !==
        money(transaction.balanceBefore - cost.netCost) ||
      state.totalCapitalSpending < cost.totalCost ||
      state.totalSalvageRevenue < cost.salvageCredit
    ) {
      throw new RangeError("last infrastructure transaction is inconsistent");
    }
  }
  return Object.freeze({
    ...state,
    lastInfrastructureTransaction: transaction
      ? Object.freeze({
          ...transaction,
          breakdown: Object.freeze({
            ...transaction.breakdown,
            affectedLandIds: Object.freeze([
              ...transaction.breakdown.affectedLandIds,
            ]),
          }),
        })
      : null,
  });
}

export function commitInfrastructureTransaction(
  state: FinanceStateSnapshot,
  transactionQuote: InfrastructureTransactionQuote,
  tick: number,
): FinanceStateSnapshot {
  if (transactionQuote.balanceBefore !== state.balance) {
    throw new RangeError("infrastructure quote no longer matches the treasury");
  }
  if (!transactionQuote.affordable) {
    throw new RangeError(
      `Infrastructure costs ${transactionQuote.breakdown.netCost.toFixed(2)} but the treasury has ${state.balance.toFixed(2)}.`,
    );
  }
  const committed = Object.freeze({ ...transactionQuote, tick });
  return Object.freeze({
    ...state,
    balance: transactionQuote.balanceAfter,
    totalCapitalSpending: money(
      state.totalCapitalSpending + transactionQuote.breakdown.totalCost,
    ),
    totalSalvageRevenue: money(
      state.totalSalvageRevenue + transactionQuote.breakdown.salvageCredit,
    ),
    lastInfrastructureTransaction: committed,
  });
}

export function advanceFinanceDay(
  state: FinanceStateSnapshot,
  tick: number,
  finishedStoneDeliveredTons: number,
  geography: ScenarioGeography,
  network: RoadNetwork,
): FinanceStateSnapshot {
  if (!Number.isSafeInteger(tick) || tick <= state.processedTick) {
    throw new RangeError("daily finance tick must advance deterministically");
  }
  const delivered = Math.min(
    MAX_FINISHED_STONE_REVENUE_TONS_PER_DAY,
    Math.max(0, finishedStoneDeliveredTons),
  );
  const revenue = money(delivered * FINISHED_STONE_REVENUE_PER_TON);
  const maintenance = calculateDailyRoadMaintenance(geography, network);
  const penalty =
    state.emergencyBondCount * EMERGENCY_BOND_DAILY_PENALTY;
  return Object.freeze({
    ...state,
    processedTick: tick,
    balance: money(state.balance + revenue - maintenance - penalty),
    totalOperatingRevenue: money(state.totalOperatingRevenue + revenue),
    totalMaintenancePaid: money(state.totalMaintenancePaid + maintenance),
    lastDailyRevenue: revenue,
    lastDailyMaintenance: maintenance,
    totalEmergencyPenalties: money(
      state.totalEmergencyPenalties + penalty,
    ),
  });
}

export function markFinanceProcessed(
  state: FinanceStateSnapshot,
  tick: number,
): FinanceStateSnapshot {
  if (!Number.isSafeInteger(tick) || tick < state.processedTick) {
    throw new RangeError("finance processed tick cannot move backwards");
  }
  return tick === state.processedTick
    ? state
    : Object.freeze({ ...state, processedTick: tick });
}

export function issueEmergencyBond(
  state: FinanceStateSnapshot,
): FinanceStateSnapshot {
  if (state.balance >= EMERGENCY_BOND_ELIGIBILITY_BALANCE) {
    throw new RangeError(
      `Emergency bonds are available below ${EMERGENCY_BOND_ELIGIBILITY_BALANCE.toFixed(2)} treasury balance.`,
    );
  }
  return Object.freeze({
    ...state,
    balance: money(state.balance + EMERGENCY_BOND_PROCEEDS),
    emergencyBondCount: state.emergencyBondCount + 1,
  });
}

export function createFinanceSnapshot(
  state: FinanceStateSnapshot,
  geography: ScenarioGeography,
  network: RoadNetwork,
): FinanceSnapshot {
  return Object.freeze({
    balance: state.balance,
    totalCapitalSpending: state.totalCapitalSpending,
    totalOperatingRevenue: state.totalOperatingRevenue,
    dailyMaintenance: calculateDailyRoadMaintenance(geography, network),
    totalMaintenancePaid: state.totalMaintenancePaid,
    totalSalvageRevenue: state.totalSalvageRevenue,
    lastDailyRevenue: state.lastDailyRevenue,
    lastDailyMaintenance: state.lastDailyMaintenance,
    emergencyFinance: Object.freeze({
      bondAvailable: state.balance < EMERGENCY_BOND_ELIGIBILITY_BALANCE,
      bondsIssued: state.emergencyBondCount,
      bondProceeds: EMERGENCY_BOND_PROCEEDS,
      eligibilityBalance: EMERGENCY_BOND_ELIGIBILITY_BALANCE,
      penaltyPerBondPerDay: EMERGENCY_BOND_DAILY_PENALTY,
      dailyPenalty:
        state.emergencyBondCount * EMERGENCY_BOND_DAILY_PENALTY,
      totalPenaltiesPaid: state.totalEmergencyPenalties,
    }),
    lastInfrastructureTransaction: state.lastInfrastructureTransaction,
  });
}
