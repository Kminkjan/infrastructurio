import type {
  AccessibilitySnapshot,
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
}

export interface DevelopmentModel {
  readonly candidates: readonly DevelopmentCandidate[];
  readonly regionalGrowthDemand: number;
  readonly evaluationIntervalTicks: number;
  readonly constructionDelayTicks: number;
  readonly projectPopulation: number;
  readonly declinePopulation: number;
  readonly viabilityThreshold: number;
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
  if (!Number.isFinite(model.viabilityThreshold)) {
    throw new RangeError("viability threshold must be finite");
  }
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

export function developmentPressure(
  accessibility: AccessibilitySnapshot,
  locationId: string,
  model: DevelopmentModel,
): number {
  const location = locationAccessibility(accessibility, locationId);
  if (!location) {
    return -model.viabilityThreshold;
  }

  const score =
    location.market.score * model.accessWeights.market +
    location.labor.score * model.accessWeights.labor +
    location.resource.score * model.accessWeights.resource +
    location.service.score * model.accessWeights.service;
  return (
    Math.round((score - model.viabilityThreshold) * PRESSURE_PRECISION) /
    PRESSURE_PRECISION
  );
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
): DevelopmentCandidate | undefined {
  const weighted = model.candidates
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
        });
      }),
    ),
    lastEvaluationTick: state.lastEvaluationTick,
    nextEvaluationTick: state.nextEvaluationTick,
  });
}
