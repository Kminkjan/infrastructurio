// @vitest-environment node

import { describe, expect, it } from "vitest";
import { generateMillfordValley } from "../../scenarios";
import type { RoadSegment } from "../../shared";
import { createRoadNetwork } from "../transport/road-network";
import {
  createFreightRailTerminalState,
  createRailNetwork,
} from "../transport/rail-network";
import {
  EMERGENCY_BOND_DAILY_PENALTY,
  EMERGENCY_BOND_ELIGIBILITY_BALANCE,
  EMERGENCY_BOND_PROCEEDS,
  FINISHED_STONE_REVENUE_PER_TON,
  ROAD_SALVAGE_RATE,
  STARTING_TREASURY_BALANCE,
  advanceFinanceDay,
  calculateDailyRailMaintenance,
  calculateDailyRoadMaintenance,
  createFinanceState,
  issueEmergencyBond,
  quoteRoadConstruction,
  quoteRoadRemoval,
  quoteRoadUpgrade,
  quoteFreightRailTerminalConstruction,
  quoteRailTrackConstruction,
  quoteRailTrackRemoval,
} from "./infrastructure-finance";

const geography = generateMillfordValley("finance-costs");

function segment(
  id: string,
  roadClass: RoadSegment["roadClass"],
  start: RoadSegment["start"],
  end: RoadSegment["end"],
): RoadSegment {
  return Object.freeze({ id, roadClass, start, end });
}

describe("infrastructure finance rules", () => {
  it("derives construction cost from length, class, land, and river work", () => {
    const outsideArterial = quoteRoadConstruction(
      STARTING_TREASURY_BALANCE,
      geography,
      segment("outside", "arterial", { x: 100, y: 50 }, { x: 200, y: 50 }),
    );
    const farmlandArterial = quoteRoadConstruction(
      STARTING_TREASURY_BALANCE,
      geography,
      segment("farmland", "arterial", { x: 600, y: 180 }, { x: 700, y: 180 }),
    );
    const farmlandHighway = quoteRoadConstruction(
      STARTING_TREASURY_BALANCE,
      geography,
      segment("farmland-highway", "highway", { x: 600, y: 180 }, { x: 700, y: 180 }),
    );
    const riverRoad = quoteRoadConstruction(
      STARTING_TREASURY_BALANCE,
      geography,
      segment("river", "arterial", { x: 300, y: 200 }, { x: 300, y: 500 }),
    );

    expect(outsideArterial.breakdown).toMatchObject({
      length: 100,
      baseCost: 1_600,
      landAcquisitionCost: 0,
      crossingWorkCost: 0,
    });
    expect(farmlandArterial.breakdown.landAcquisitionCost).toBeGreaterThan(0);
    expect(farmlandArterial.breakdown.affectedLandIds).toEqual([
      geography.fertileLand.id,
    ]);
    expect(farmlandHighway.breakdown.baseCost).toBeGreaterThan(
      farmlandArterial.breakdown.baseCost,
    );
    expect(farmlandHighway.breakdown.landAcquisitionCost).toBeGreaterThan(
      farmlandArterial.breakdown.landAcquisitionCost,
    );
    expect(riverRoad.breakdown).toMatchObject({
      riverCrossingCount: 1,
      crossingWorkCost: 3_500,
    });
    const riverUpgrade = quoteRoadUpgrade(
      STARTING_TREASURY_BALANCE,
      geography,
      segment("river", "arterial", { x: 300, y: 200 }, { x: 300, y: 500 }),
    );
    expect(riverUpgrade.breakdown).toMatchObject({
      baseCost: 4_800,
      landAcquisitionCost: 0,
      riverCrossingCount: 1,
      crossingWorkCost: 3_500,
    });
  });

  it("salvages only twenty percent of current-class base road work", () => {
    const road = segment(
      "road",
      "arterial",
      { x: 600, y: 180 },
      { x: 700, y: 180 },
    );
    const construction = quoteRoadConstruction(
      STARTING_TREASURY_BALANCE,
      geography,
      road,
    );
    const removal = quoteRoadRemoval(1_000, road);

    expect(removal.breakdown.salvageCredit).toBe(
      construction.breakdown.baseCost * ROAD_SALVAGE_RATE,
    );
    expect(removal.breakdown.landAcquisitionCost).toBe(0);
    expect(removal.breakdown.crossingWorkCost).toBe(0);
    expect(removal.balanceAfter).toBeGreaterThan(removal.balanceBefore);
  });

  it("bounds finished-stone revenue and charges maintenance each daily step", () => {
    const road = segment(
      "maintained",
      "arterial",
      { x: 100, y: 50 },
      { x: 200, y: 50 },
    );
    const network = createRoadNetwork([road]);
    const maintenance = calculateDailyRoadMaintenance(geography, network);
    const after = advanceFinanceDay(
      createFinanceState(0),
      24,
      1_000,
      geography,
      network,
    );

    expect(after.lastDailyRevenue).toBe(100 * FINISHED_STONE_REVENUE_PER_TON);
    expect(after.lastDailyMaintenance).toBe(maintenance);
    expect(after.balance).toBe(
      STARTING_TREASURY_BALANCE + after.lastDailyRevenue - maintenance,
    );
  });

  it("uses the shared treasury and land-cost contract for rail infrastructure", () => {
    const track = {
      id: "rail-track-1",
      start: { x: 600, y: 180 },
      end: { x: 700, y: 180 },
    };
    const construction = quoteRailTrackConstruction(
      STARTING_TREASURY_BALANCE,
      geography,
      track,
    );
    const terminal = quoteFreightRailTerminalConstruction(
      construction.balanceAfter,
    );
    const removal = quoteRailTrackRemoval(terminal.balanceAfter, track);
    const network = createRailNetwork(
      [track],
      [createFreightRailTerminalState(geography, "quarry")],
      geography,
    );

    expect(construction.breakdown).toMatchObject({
      infrastructureKind: "rail",
      infrastructureClass: "track",
      baseCost: 2_800,
      landAcquisitionCost: 1_200,
      affectedLandIds: [geography.fertileLand.id],
    });
    expect(terminal.breakdown).toMatchObject({
      infrastructureKind: "rail",
      infrastructureClass: "freight-terminal",
      baseCost: 5_000,
    });
    expect(removal.breakdown.salvageCredit).toBe(560);
    expect(calculateDailyRailMaintenance(network)).toBe(49);
  });

  it("limits emergency bonds to low balances and compounds their daily penalty", () => {
    expect(() => issueEmergencyBond(createFinanceState(0))).toThrow(
      "available below",
    );
    const recoveryState = Object.freeze({
      ...createFinanceState(0),
      balance: 0,
    });
    const issued = issueEmergencyBond(recoveryState);
    expect(issued.balance).toBe(
      EMERGENCY_BOND_PROCEEDS,
    );
    expect(() => issueEmergencyBond(issued)).toThrow("available below");

    const after = advanceFinanceDay(
      issued,
      24,
      0,
      geography,
      createRoadNetwork([]),
    );
    expect(after.totalEmergencyPenalties).toBe(
      EMERGENCY_BOND_DAILY_PENALTY,
    );
    expect(after.balance).toBe(
      issued.balance - EMERGENCY_BOND_DAILY_PENALTY,
    );
    expect(after.balance).toBeLessThan(EMERGENCY_BOND_ELIGIBILITY_BALANCE);
    const issuedAgain = issueEmergencyBond(after);
    expect(issuedAgain.emergencyBondCount).toBe(2);
    const afterTwoBonds = advanceFinanceDay(
      issuedAgain,
      48,
      0,
      geography,
      createRoadNetwork([]),
    );
    expect(
      afterTwoBonds.totalEmergencyPenalties - after.totalEmergencyPenalties,
    ).toBe(EMERGENCY_BOND_DAILY_PENALTY * 2);
  });
});
