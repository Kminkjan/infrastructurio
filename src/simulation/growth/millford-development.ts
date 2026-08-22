import { TICKS_PER_DAY, type ScenarioGeography } from "../../shared";
import type { DevelopmentModel } from "./development";

const DAYS_PER_EVALUATION = 7;

export function createMillfordDevelopmentModel(
  geography: ScenarioGeography,
): DevelopmentModel {
  const candidateAssumptions = [
    { basePopulation: 60, landCostPoints: 35 },
    { basePopulation: 40, landCostPoints: 35 },
  ];
  if (geography.settlementSeeds.length !== candidateAssumptions.length) {
    throw new RangeError("Millford development requires two settlement seeds");
  }

  return Object.freeze({
    candidates: Object.freeze(
      geography.settlementSeeds.map((settlement, index) =>
        Object.freeze({
          id: settlement.id,
          name: settlement.name,
          position: settlement.position,
          ...candidateAssumptions[index]!,
        }),
      ),
    ),
    regionalGrowthDemand: 100,
    evaluationIntervalTicks: TICKS_PER_DAY * DAYS_PER_EVALUATION,
    constructionDelayTicks: TICKS_PER_DAY * DAYS_PER_EVALUATION,
    projectPopulation: 10,
    declinePopulation: 5,
    accessWeights: Object.freeze({
      market: 0.35,
      labor: 0.3,
      resource: 0.2,
      service: 0.15,
    }),
  });
}
