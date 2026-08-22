import type {
  AccessibilitySnapshot,
  DevelopmentAccessFactor,
  DevelopmentAccessFactorExplanation,
  DevelopmentDecisionExplanation,
  DevelopmentDecisionOutcome,
  DevelopmentSnapshot,
  LocationAccessibility,
  PendingConstruction,
  Point,
} from "../../shared";

const PRESSURE_PRECISION = 1_000;

export interface DevelopmentCandidate {
  readonly id: string;
  readonly name: string;
  readonly position: Point;
  readonly basePopulation: number;
  readonly landCostPoints: number;
}

export interface DevelopmentModel {
  readonly candidates: readonly DevelopmentCandidate[];
  readonly regionalGrowthDemand: number;
  readonly evaluationIntervalTicks: number;
  readonly constructionDelayTicks: number;
  readonly projectPopulation: number;
  readonly declinePopulation: number;
  readonly accessWeights: Readonly<{
    market: number;
    labor: number;
    resource: number;
    service: number;
  }>;
}

export interface DevelopmentLocationState {
  readonly locationId: string;
  readonly growthPopulation: number;
}

export interface DevelopmentStateSnapshot {
  readonly processedTick: number;
  readonly evaluationNumber: number;
  readonly lastEvaluationTick: number | null;
  readonly nextEvaluationTick: number;
  readonly nextConstructionNumber: number;
  readonly locations: readonly DevelopmentLocationState[];
  readonly pendingConstruction: readonly PendingConstruction[];
}

function safeNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function positiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function validateModel(model: DevelopmentModel): void {
  positiveSafeInteger(model.regionalGrowthDemand, "regional growth demand");
  positiveSafeInteger(model.evaluationIntervalTicks, "evaluation interval");
  positiveSafeInteger(model.constructionDelayTicks, "construction delay");
  positiveSafeInteger(model.projectPopulation, "project population");
  positiveSafeInteger(model.declinePopulation, "decline population");
  for (const weight of Object.values(model.accessWeights)) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(
        "development access weights must be non-negative and finite",
      );
    }
  }

  const candidateIds = new Set<string>();
  for (const candidate of model.candidates) {
    if (candidate.id.length === 0 || candidateIds.has(candidate.id)) {
      throw new RangeError(
        "development candidate ids must be non-empty and unique",
      );
    }
    if (
      !Number.isFinite(candidate.position.x) ||
      !Number.isFinite(candidate.position.y)
    ) {
      throw new RangeError("development candidate positions must be finite");
    }
    safeNonNegativeInteger(candidate.basePopulation, "base population");
    if (
      !Number.isFinite(candidate.landCostPoints) ||
      candidate.landCostPoints < 0
    ) {
      throw new RangeError("land cost must be non-negative and finite");
    }
    candidateIds.add(candidate.id);
  }
}

function freezeState(
  state: DevelopmentStateSnapshot,
): DevelopmentStateSnapshot {
  return Object.freeze({
    ...state,
    locations: Object.freeze(
      state.locations.map((location) => Object.freeze({ ...location })),
    ),
    pendingConstruction: Object.freeze(
      state.pendingConstruction.map((project) =>
        Object.freeze({ ...project }),
      ),
    ),
  });
}

export function validateDevelopmentState(
  model: DevelopmentModel,
  input: DevelopmentStateSnapshot,
): DevelopmentStateSnapshot {
  validateModel(model);
  safeNonNegativeInteger(input.processedTick, "development processed tick");
  safeNonNegativeInteger(
    input.evaluationNumber,
    "development evaluation number",
  );
  if (input.lastEvaluationTick !== null) {
    safeNonNegativeInteger(input.lastEvaluationTick, "last evaluation tick");
    if (input.lastEvaluationTick > input.processedTick) {
      throw new RangeError("last evaluation tick cannot be in the future");
    }
  }
  positiveSafeInteger(input.nextEvaluationTick, "next evaluation tick");
  if (input.nextEvaluationTick <= input.processedTick) {
    throw new RangeError("next evaluation tick must be after processed tick");
  }
  positiveSafeInteger(input.nextConstructionNumber, "next construction number");

  const candidateIds = new Set(model.candidates.map(({ id }) => id));
  if (input.locations.length !== model.candidates.length) {
    throw new RangeError("development state must include every candidate");
  }
  const stateLocationIds = new Set<string>();
  for (const location of input.locations) {
    if (
      !candidateIds.has(location.locationId) ||
      stateLocationIds.has(location.locationId)
    ) {
      throw new RangeError(
        "development state has an unknown or duplicate location",
      );
    }
    safeNonNegativeInteger(location.growthPopulation, "growth population");
    stateLocationIds.add(location.locationId);
  }

  const projectIds = new Set<string>();
  const pendingLocationIds = new Set<string>();
  for (const project of input.pendingConstruction) {
    if (
      project.id.length === 0 ||
      projectIds.has(project.id) ||
      !candidateIds.has(project.locationId)
    ) {
      throw new RangeError("pending construction has invalid identity");
    }
    positiveSafeInteger(project.population, "construction population");
    safeNonNegativeInteger(project.startedTick, "construction start tick");
    positiveSafeInteger(project.completesTick, "construction completion tick");
    if (
      project.startedTick > input.processedTick ||
      project.completesTick <= input.processedTick ||
      project.completesTick <= project.startedTick
    ) {
      throw new RangeError("pending construction has invalid timing");
    }
    if (pendingLocationIds.has(project.locationId)) {
      throw new RangeError(
        "a development location cannot have multiple pending projects",
      );
    }
    projectIds.add(project.id);
    pendingLocationIds.add(project.locationId);
  }

  const committed =
    input.locations.reduce(
      (total, location) => total + location.growthPopulation,
      0,
    ) +
    input.pendingConstruction.reduce(
      (total, project) => total + project.population,
      0,
    );
  if (committed > model.regionalGrowthDemand) {
    throw new RangeError("development exceeds regional growth demand");
  }

  return freezeState(input);
}

export function createDevelopmentState(
  model: DevelopmentModel,
  processedTick = 0,
): DevelopmentStateSnapshot {
  validateModel(model);
  safeNonNegativeInteger(processedTick, "development processed tick");
  const nextEvaluationTick =
    (Math.floor(processedTick / model.evaluationIntervalTicks) + 1) *
    model.evaluationIntervalTicks;

  return validateDevelopmentState(model, {
    processedTick,
    evaluationNumber: 0,
    lastEvaluationTick: null,
    nextEvaluationTick,
    nextConstructionNumber: 1,
    locations: model.candidates.map(({ id }) => ({
      locationId: id,
      growthPopulation: 0,
    })),
    pendingConstruction: [],
  });
}

function locationAccessibility(
  accessibility: AccessibilitySnapshot,
  locationId: string,
): LocationAccessibility | undefined {
  return accessibility.locations.find(
    (location) => location.locationId === locationId,
  );
}

const ACCESS_FACTORS: readonly DevelopmentAccessFactor[] = [
  "market",
  "labor",
  "resource",
  "service",
];

function candidateFor(
  model: DevelopmentModel,
  locationId: string,
): DevelopmentCandidate | undefined {
  return model.candidates.find(({ id }) => id === locationId);
}

function factorContribution(
  accessibility: AccessibilitySnapshot,
  locationId: string,
  model: DevelopmentModel,
  factor: DevelopmentAccessFactor,
): number {
  return (
    (locationAccessibility(accessibility, locationId)?.[factor].score ?? 0) *
    model.accessWeights[factor]
  );
}

export function developmentPressure(
  accessibility: AccessibilitySnapshot,
  locationId: string,
  model: DevelopmentModel,
): number {
  const location = locationAccessibility(accessibility, locationId);
  const candidate = candidateFor(model, locationId);
  if (!candidate) {
    return 0;
  }
  if (!location) {
    return -candidate.landCostPoints;
  }

  const score = ACCESS_FACTORS.reduce(
    (total, factor) =>
      total + factorContribution(accessibility, locationId, model, factor),
    0,
  );
  return (
    Math.round((score - candidate.landCostPoints) * PRESSURE_PRECISION) /
    PRESSURE_PRECISION
  );
}

function bestAlternative(
  model: DevelopmentModel,
  locationId: string,
  value: (candidate: DevelopmentCandidate) => number | null,
  preferLower = false,
): { candidate: DevelopmentCandidate; value: number } | undefined {
  const alternatives = model.candidates
    .filter(({ id }) => id !== locationId)
    .map((candidate) => ({ candidate, value: value(candidate) }))
    .filter(
      (entry): entry is { candidate: DevelopmentCandidate; value: number } =>
        entry.value !== null,
    );
  alternatives.sort((first, second) => {
    const difference = preferLower
      ? first.value - second.value
      : second.value - first.value;
    return difference || first.candidate.id.localeCompare(second.candidate.id);
  });
  return alternatives[0];
}

function accessFactorExplanation(
  accessibility: AccessibilitySnapshot,
  locationId: string,
  model: DevelopmentModel,
  factor: DevelopmentAccessFactor,
): DevelopmentAccessFactorExplanation {
  const value = locationAccessibility(accessibility, locationId)?.[factor];
  const contributionPoints = factorContribution(
    accessibility,
    locationId,
    model,
    factor,
  );
  const alternative = bestAlternative(model, locationId, (candidate) =>
    factorContribution(accessibility, candidate.id, model, factor),
  );
  return Object.freeze({
    factor,
    accessScore: value?.score ?? 0,
    weight: model.accessWeights[factor],
    contributionPoints,
    nearestNetworkCost: value?.nearestNetworkCost ?? null,
    reachableOpportunityCount: value?.reachableOpportunityCount ?? 0,
    bestAlternativeLocationId: alternative?.candidate.id ?? null,
    bestAlternativeName: alternative?.candidate.name ?? null,
    differenceFromBestAlternativePoints:
      alternative === undefined ? null : contributionPoints - alternative.value,
  });
}

function decisionOutcome(
  state: DevelopmentStateSnapshot,
  pressure: number,
  selectedLocationId: string | null,
  remainingGrowthPopulation: number,
  locationId: string,
): DevelopmentDecisionOutcome {
  if (state.lastEvaluationTick === null) {
    return "not-evaluated";
  }
  if (remainingGrowthPopulation === 0 && selectedLocationId === null) {
    return "regional-demand-met";
  }
  if (pressure <= 0) {
    return "not-viable";
  }
  return selectedLocationId === locationId ? "selected" : "not-selected";
}

function createDecisionExplanation(
  state: DevelopmentStateSnapshot,
  model: DevelopmentModel,
  accessibility: AccessibilitySnapshot,
  locationId: string,
  remainingGrowthPopulation: number,
): DevelopmentDecisionExplanation {
  const candidate = candidateFor(model, locationId);
  if (!candidate) {
    throw new Error(`unknown development candidate ${locationId}`);
  }
  const accessFactors = Object.freeze(
    ACCESS_FACTORS.map((factor) =>
      accessFactorExplanation(accessibility, locationId, model, factor),
    ),
  );
  const strongestPositiveFactor = accessFactors.every(
    ({ contributionPoints }) => contributionPoints <= 0,
  )
    ? null
    : accessFactors.reduce((strongest, factor) =>
        factor.contributionPoints > strongest.contributionPoints
          ? factor
          : strongest,
      );
  const selectionWeight = Math.max(
    0,
    developmentPressure(accessibility, locationId, model),
  );
  const totalSelectionWeight = model.candidates.reduce(
    (total, entry) =>
      total + Math.max(0, developmentPressure(accessibility, entry.id, model)),
    0,
  );
  const selectedProject = state.pendingConstruction.find(
    ({ startedTick }) => startedTick === state.lastEvaluationTick,
  );
  const selected = selectedProject
    ? candidateFor(model, selectedProject.locationId)
    : undefined;
  const marketCost = locationAccessibility(accessibility, locationId)?.market
    .nearestNetworkCost ?? null;
  const transportAlternative = bestAlternative(
    model,
    locationId,
    (entry) =>
      locationAccessibility(accessibility, entry.id)?.market
        .nearestNetworkCost ?? null,
    true,
  );
  const landAlternative = bestAlternative(
    model,
    locationId,
    (entry) => entry.landCostPoints,
    true,
  );
  const land = Object.freeze({
    costPoints: candidate.landCostPoints,
    cheapestAlternativeLocationId: landAlternative?.candidate.id ?? null,
    cheapestAlternativeName: landAlternative?.candidate.name ?? null,
    differenceFromCheapestAlternativePoints:
      landAlternative === undefined
        ? null
        : candidate.landCostPoints - landAlternative.value,
  });

  return Object.freeze({
    outcome: decisionOutcome(
      state,
      selectionWeight,
      selected?.id ?? null,
      remainingGrowthPopulation,
      locationId,
    ),
    selectionWeight,
    selectionShare:
      totalSelectionWeight === 0 ? 0 : selectionWeight / totalSelectionWeight,
    selectedLocationId: selected?.id ?? null,
    selectedLocationName: selected?.name ?? null,
    accessFactors,
    transport: Object.freeze({
      marketNetworkCost: marketCost,
      bestAlternativeLocationId: transportAlternative?.candidate.id ?? null,
      bestAlternativeName: transportAlternative?.candidate.name ?? null,
      bestAlternativeMarketNetworkCost: transportAlternative?.value ?? null,
    }),
    land,
    strongestPositiveFactor,
    strongestNegativeFactor: land,
  });
}

function seededUnitValue(seed: string, evaluationNumber: number): number {
  const value = `${seed}:development:${evaluationNumber}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash += 0x6d2b79f5;
  hash = Math.imul(hash ^ (hash >>> 15), hash | 1);
  hash ^= hash + Math.imul(hash ^ (hash >>> 7), hash | 61);
  return ((hash ^ (hash >>> 14)) >>> 0) / 0x1_0000_0000;
}

function chooseCandidate(
  model: DevelopmentModel,
  accessibility: AccessibilitySnapshot,
  seed: string,
  evaluationNumber: number,
  unavailableLocationIds: ReadonlySet<string>,
): DevelopmentCandidate | undefined {
  const weighted = model.candidates
    .filter(({ id }) => !unavailableLocationIds.has(id))
    .map((candidate) => ({
      candidate,
      weight: Math.max(
        0,
        developmentPressure(accessibility, candidate.id, model),
      ),
    }))
    .filter(({ weight }) => weight > 0);
  const totalWeight = weighted.reduce(
    (total, entry) => total + entry.weight,
    0,
  );
  let selection = seededUnitValue(seed, evaluationNumber) * totalWeight;
  for (const entry of weighted) {
    selection -= entry.weight;
    if (selection < 0) {
      return entry.candidate;
    }
  }
  return weighted.at(-1)?.candidate;
}

function reconcilePendingConstruction(
  state: DevelopmentStateSnapshot,
  model: DevelopmentModel,
  accessibility: AccessibilitySnapshot,
): DevelopmentStateSnapshot {
  const pendingConstruction = state.pendingConstruction.filter(
    ({ locationId }) =>
      developmentPressure(accessibility, locationId, model) > 0,
  );
  return pendingConstruction.length === state.pendingConstruction.length
    ? state
    : freezeState({ ...state, pendingConstruction });
}

export function updateDevelopmentAccess(
  state: DevelopmentStateSnapshot,
  model: DevelopmentModel,
  accessibility: AccessibilitySnapshot,
): DevelopmentStateSnapshot {
  return reconcilePendingConstruction(state, model, accessibility);
}

function evaluateDevelopment(
  state: DevelopmentStateSnapshot,
  model: DevelopmentModel,
  accessibility: AccessibilitySnapshot,
  seed: string,
  evaluationTick: number,
): DevelopmentStateSnapshot {
  const completedByLocation = new Map(
    state.locations.map((location) => [
      location.locationId,
      location.growthPopulation,
    ]),
  );
  const stillPending: PendingConstruction[] = [];
  for (const project of state.pendingConstruction) {
    if (project.completesTick <= evaluationTick) {
      completedByLocation.set(
        project.locationId,
        (completedByLocation.get(project.locationId) ?? 0) +
          project.population,
      );
    } else {
      stillPending.push(project);
    }
  }

  for (const candidate of model.candidates) {
    const population = completedByLocation.get(candidate.id) ?? 0;
    if (
      population > 0 &&
      developmentPressure(accessibility, candidate.id, model) <= 0
    ) {
      completedByLocation.set(
        candidate.id,
        Math.max(0, population - model.declinePopulation),
      );
    }
  }

  let nextConstructionNumber = state.nextConstructionNumber;
  const completedGrowthPopulation = [...completedByLocation.values()].reduce(
    (total, population) => total + population,
    0,
  );
  const pendingGrowthPopulation = stillPending.reduce(
    (total, project) => total + project.population,
    0,
  );
  const remainingDemand = Math.max(
    0,
    model.regionalGrowthDemand -
      completedGrowthPopulation -
      pendingGrowthPopulation,
  );
  const selected = chooseCandidate(
    model,
    accessibility,
    seed,
    state.evaluationNumber,
    new Set(stillPending.map(({ locationId }) => locationId)),
  );
  if (selected && remainingDemand > 0) {
    stillPending.push(
      Object.freeze({
        id: `construction-${nextConstructionNumber}`,
        locationId: selected.id,
        population: Math.min(model.projectPopulation, remainingDemand),
        startedTick: evaluationTick,
        completesTick: evaluationTick + model.constructionDelayTicks,
      }),
    );
    nextConstructionNumber += 1;
  }

  return validateDevelopmentState(model, {
    processedTick: evaluationTick,
    evaluationNumber: state.evaluationNumber + 1,
    lastEvaluationTick: evaluationTick,
    nextEvaluationTick: evaluationTick + model.evaluationIntervalTicks,
    nextConstructionNumber,
    locations: model.candidates.map(({ id }) => ({
      locationId: id,
      growthPopulation: completedByLocation.get(id) ?? 0,
    })),
    pendingConstruction: stillPending,
  });
}

export function advanceDevelopment(
  input: DevelopmentStateSnapshot,
  model: DevelopmentModel,
  accessibility: AccessibilitySnapshot,
  seed: string,
  targetTick: number,
): DevelopmentStateSnapshot {
  let state = validateDevelopmentState(model, input);
  safeNonNegativeInteger(targetTick, "development target tick");
  if (targetTick < state.processedTick) {
    throw new RangeError("development cannot advance backwards");
  }

  state = reconcilePendingConstruction(state, model, accessibility);
  while (state.nextEvaluationTick <= targetTick) {
    state = evaluateDevelopment(
      state,
      model,
      accessibility,
      seed,
      state.nextEvaluationTick,
    );
  }

  return freezeState({ ...state, processedTick: targetTick });
}

export function createDevelopmentSnapshot(
  state: DevelopmentStateSnapshot,
  model: DevelopmentModel,
  accessibility: AccessibilitySnapshot,
): DevelopmentSnapshot {
  const pendingByLocation = new Map(
    state.pendingConstruction.map((project) => [project.locationId, project]),
  );
  const completedGrowthPopulation = state.locations.reduce(
    (total, location) => total + location.growthPopulation,
    0,
  );
  const pendingGrowthPopulation = state.pendingConstruction.reduce(
    (total, project) => total + project.population,
    0,
  );
  const committedGrowthPopulation =
    completedGrowthPopulation + pendingGrowthPopulation;

  return Object.freeze({
    demand: Object.freeze({
      targetGrowthPopulation: model.regionalGrowthDemand,
      completedGrowthPopulation,
      committedGrowthPopulation,
      remainingGrowthPopulation:
        model.regionalGrowthDemand - committedGrowthPopulation,
    }),
    locations: Object.freeze(
      model.candidates.map((candidate) => {
        const location = state.locations.find(
          ({ locationId }) => locationId === candidate.id,
        );
        const growthPopulation = location?.growthPopulation ?? 0;
        const pressure = developmentPressure(
          accessibility,
          candidate.id,
          model,
        );
        const pendingConstruction =
          pendingByLocation.get(candidate.id) ?? null;
        const status = pendingConstruction
          ? ("growing" as const)
          : pressure <= 0
            ? growthPopulation > 0
              ? ("declining" as const)
              : ("pressured" as const)
            : ("stable" as const);
        return Object.freeze({
          locationId: candidate.id,
          name: candidate.name,
          position: candidate.position,
          basePopulation: candidate.basePopulation,
          growthPopulation,
          totalPopulation: candidate.basePopulation + growthPopulation,
          pressure,
          status,
          pendingConstruction,
          decision: createDecisionExplanation(
            state,
            model,
            accessibility,
            candidate.id,
            model.regionalGrowthDemand - committedGrowthPopulation,
          ),
        });
      }),
    ),
    lastEvaluationTick: state.lastEvaluationTick,
    nextEvaluationTick: state.nextEvaluationTick,
  });
}
