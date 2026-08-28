// @vitest-environment node

import { describe, expect, it } from "vitest";
import { OLD_MILLFORD_BRIDGE_ROAD_ID } from "../scenarios";
import {
  completeM3Playtest,
  createM3LateScenario,
  createM3TargetScaleFixture,
  M3_MAX_COMPLETION_DAYS,
  type M3PlaytestVariant,
} from "./m3-release-fixture";
import {
  createSaveGame,
  deserializeSaveGame,
  restoreSaveGame,
  serializeSaveGame,
} from "../persistence";

const variants: readonly M3PlaytestVariant[] = [
  "bridge-upgrade",
  "highway-bypass",
  "rail-shift",
];

describe("M3 release gate", () => {
  it.each(variants)("completes the %s playtest without recovery finance", (variant) => {
    const result = completeM3Playtest(variant);

    expect(result.pressured.bottlenecks.roadBottlenecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roadSegmentId: OLD_MILLFORD_BRIDGE_ROAD_ID }),
      ]),
    );
    expect(result.ending.intervention).toBe(
      variant === "highway-bypass" ? "road-bypass" : variant,
    );
    expect(result.completed.scenarioProgress.successConditions).toEqual({
      bothLegsServed: true,
      bridgeRelievedOrFreightShifted: true,
      infrastructureGrowthCompleted: true,
      financesMaintainable: true,
    });
    expect(result.completed.finances.emergencyFinance.bondsIssued).toBe(0);
    expect(result.elapsedDays).toBeLessThanOrEqual(M3_MAX_COMPLETION_DAYS);
    expect(result.playerActions).toBeLessThanOrEqual(24);
  });

  it("keeps the three viable interventions economically distinct", () => {
    const results = variants.map((variant) => completeM3Playtest(variant));
    const byVariant = new Map(results.map((result) => [result.variant, result]));
    const bridgeResult = byVariant.get("bridge-upgrade")!;
    const bypassResult = byVariant.get("highway-bypass")!;
    const railResult = byVariant.get("rail-shift")!;
    const bridge = bridgeResult.ending;
    const bypass = bypassResult.ending;
    const rail = railResult.ending;

    expect(new Set(results.map(({ ending }) => ending.totalCapitalSpending)).size).toBe(3);
    expect(new Set(results.map(({ ending }) => ending.dailyMaintenance)).size).toBe(3);
    expect(bridge.railFreightTonsPerDay).toBe(0);
    expect(bypass.railFreightTonsPerDay).toBe(0);
    expect(rail.railFreightTonsPerDay).toBeGreaterThan(0);
    expect(rail.totalCapitalSpending).toBeGreaterThan(bridge.totalCapitalSpending);
    expect(
      bypassResult.simulation.getState().finances?.lastInfrastructureTransaction
        ?.breakdown,
    ).toMatchObject({
      infrastructureKind: "road",
      infrastructureClass: "highway",
      affectedLandIds: ["fertile-land-eastbank"],
      riverCrossingCount: 1,
    });
    expect(
      railResult.simulation.getState().finances?.lastInfrastructureTransaction
        ?.breakdown,
    ).toMatchObject({
      infrastructureKind: "rail",
      infrastructureClass: "track",
      affectedLandIds: ["fertile-land-eastbank"],
      riverCrossingCount: 1,
    });
  });

  it.each(variants)("preserves a late %s state and deterministic ending", (variant) => {
    const late = createM3LateScenario(variant);
    const serialized = serializeSaveGame(createSaveGame(late.simulation));
    const restored = restoreSaveGame(deserializeSaveGame(serialized));

    expect(restored.getState()).toEqual(late.simulation.getState());
    const originalSnapshot = late.simulation.getSnapshot();
    const restoredSnapshot = restored.getSnapshot();
    expect(restoredSnapshot.roadNetwork).toEqual(originalSnapshot.roadNetwork);
    expect(restoredSnapshot.railNetwork).toEqual(originalSnapshot.railNetwork);
    expect(restoredSnapshot.stoneSupplyChain).toEqual(originalSnapshot.stoneSupplyChain);
    expect(restoredSnapshot.finances).toEqual(originalSnapshot.finances);
    expect(restoredSnapshot.development).toEqual(originalSnapshot.development);
    expect(restoredSnapshot.scenarioProgress).toEqual(originalSnapshot.scenarioProgress);
    const command = { type: "advance", ticks: 48 } as const;
    const restoredEnding = restored.dispatch(command);
    const originalEnding = late.simulation.dispatch(command);
    expect(restoredEnding.scenarioProgress).toEqual(originalEnding.scenarioProgress);
    expect(restoredEnding.stoneSupplyChain).toEqual(originalEnding.stoneSupplyChain);
    expect(restoredEnding.finances).toEqual(originalEnding.finances);
    expect(restoredEnding.roadNetwork).toEqual(originalEnding.roadNetwork);
    expect(restoredEnding.railNetwork).toEqual(originalEnding.railNetwork);
    expect(restored.getSnapshot().scenarioProgress.ending).not.toBeNull();
  });

  it("covers the densest expected M3 rendering and simulation state", () => {
    const fixture = createM3TargetScaleFixture();

    expect(fixture.roadSegmentCount).toBeGreaterThanOrEqual(12);
    expect(fixture.roadLinkCount).toBeGreaterThan(fixture.roadSegmentCount);
    expect(fixture.railTrackCount).toBeGreaterThanOrEqual(6);
    expect(fixture.railLinkCount).toBeGreaterThanOrEqual(fixture.railTrackCount);
    expect(fixture.snapshot.railNetwork.terminals).toHaveLength(3);
    expect(fixture.snapshot.stoneSupplyChain.inboundFreight.shippedTonsPerDay).toBeGreaterThan(0);
    expect(fixture.snapshot.stoneSupplyChain.outboundFreight.shippedTonsPerDay).toBeGreaterThan(0);
    expect(fixture.developmentMarkCount).toBeGreaterThan(0);
    expect(fixture.overlayFeatureCount).toBeGreaterThan(0);
    expect(fixture.representativeVehicleCount).toBe(10);
  });
});
