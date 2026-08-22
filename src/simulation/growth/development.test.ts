// @vitest-environment node

import { describe, expect, it } from "vitest";
import type {
  AccessibilityFactorValue,
  AccessibilitySnapshot,
} from "../../shared";
import {
  advanceDevelopment,
  createDevelopmentSnapshot,
  createDevelopmentState,
  updateDevelopmentAccess,
  type DevelopmentModel,
} from "./development";

function factor(score: number): AccessibilityFactorValue {
  return {
    score,
    nearestNetworkCost: score > 0 ? 1 : null,
    reachableOpportunityCount: score > 0 ? 1 : 0,
  };
}

function accessibility(
  scores: Readonly<Record<string, number>>,
): AccessibilitySnapshot {
  return {
    locations: Object.entries(scores).map(([locationId, score], index) => ({
      locationId,
      name: locationId,
      position: { x: index * 10, y: 0 },
      market: factor(score),
      labor: factor(score),
      resource: factor(score),
      service: factor(score),
    })),
    lastNetworkUpdateInvalidatedLocationIds: [],
  };
}

function model(regionalGrowthDemand = 30): DevelopmentModel {
  return {
    candidates: [
      {
        id: "higher-access",
        name: "Higher access",
        position: { x: 0, y: 0 },
        basePopulation: 20,
      },
      {
        id: "lower-access",
        name: "Lower access",
        position: { x: 10, y: 0 },
        basePopulation: 10,
      },
    ],
    regionalGrowthDemand,
    evaluationIntervalTicks: 10,
    constructionDelayTicks: 10,
    projectPopulation: 10,
    declinePopulation: 5,
    viabilityThreshold: 10,
    accessWeights: {
      market: 0.35,
      labor: 0.3,
      resource: 0.2,
      service: 0.15,
    },
  };
}

describe("development growth", () => {
  it("bounds committed growth by regional demand and completes construction after a delay", () => {
    const developmentModel = model(25);
    const access = accessibility({
      "higher-access": 80,
      "lower-access": 30,
    });
    const initial = createDevelopmentState(developmentModel);

    const scheduled = advanceDevelopment(
      initial,
      developmentModel,
      access,
      "bounded-growth",
      10,
    );
    const scheduledSnapshot = createDevelopmentSnapshot(
      scheduled,
      developmentModel,
      access,
    );
    expect(scheduledSnapshot.demand).toMatchObject({
      targetGrowthPopulation: 25,
      completedGrowthPopulation: 0,
      committedGrowthPopulation: 10,
      remainingGrowthPopulation: 15,
    });
    expect(scheduledSnapshot.locations.some(({ status }) => status === "growing"))
      .toBe(true);

    const beforeCompletion = advanceDevelopment(
      scheduled,
      developmentModel,
      access,
      "bounded-growth",
      19,
    );
    expect(
      createDevelopmentSnapshot(beforeCompletion, developmentModel, access)
        .demand.completedGrowthPopulation,
    ).toBe(0);

    const complete = advanceDevelopment(
      beforeCompletion,
      developmentModel,
      access,
      "bounded-growth",
      200,
    );
    expect(createDevelopmentSnapshot(complete, developmentModel, access).demand)
      .toEqual({
        targetGrowthPopulation: 25,
        completedGrowthPopulation: 25,
        committedGrowthPopulation: 25,
        remainingGrowthPopulation: 0,
      });
  });

  it("lets multiple viable locations compete through reproducible seeded weights", () => {
    const developmentModel = model(10);
    const access = accessibility({
      "higher-access": 80,
      "lower-access": 30,
    });
    const selectedBySeed = Array.from({ length: 24 }, (_, index) => {
      const seed = `competition-${index}`;
      const first = advanceDevelopment(
        createDevelopmentState(developmentModel),
        developmentModel,
        access,
        seed,
        10,
      );
      const replay = advanceDevelopment(
        createDevelopmentState(developmentModel),
        developmentModel,
        access,
        seed,
        10,
      );
      expect(replay).toEqual(first);
      return first.pendingConstruction[0]?.locationId;
    });

    expect(new Set(selectedBySeed)).toEqual(
      new Set(["higher-access", "lower-access"]),
    );
    expect(
      selectedBySeed.filter((id) => id === "higher-access").length,
    ).toBeGreaterThan(
      selectedBySeed.filter((id) => id === "lower-access").length,
    );
  });

  it("turns lost access into pressure and gradual decline instead of disappearance", () => {
    const developmentModel = model(30);
    const viable = accessibility({
      "higher-access": 80,
      "lower-access": 0,
    });
    const grown = advanceDevelopment(
      createDevelopmentState(developmentModel),
      developmentModel,
      viable,
      "decline",
      20,
    );
    expect(
      createDevelopmentSnapshot(grown, developmentModel, viable).locations[0],
    ).toMatchObject({
      growthPopulation: 10,
      totalPopulation: 30,
      status: "growing",
    });

    const inaccessible = accessibility({
      "higher-access": 0,
      "lower-access": 0,
    });
    const pressured = updateDevelopmentAccess(
      grown,
      developmentModel,
      inaccessible,
    );
    expect(
      createDevelopmentSnapshot(pressured, developmentModel, inaccessible)
        .locations[0],
    ).toMatchObject({
      growthPopulation: 10,
      totalPopulation: 30,
      status: "declining",
      pendingConstruction: null,
    });

    const declined = advanceDevelopment(
      pressured,
      developmentModel,
      inaccessible,
      "decline",
      30,
    );
    expect(
      createDevelopmentSnapshot(declined, developmentModel, inaccessible)
        .locations[0],
    ).toMatchObject({
      basePopulation: 20,
      growthPopulation: 5,
      totalPopulation: 25,
      status: "declining",
    });
  });
});
