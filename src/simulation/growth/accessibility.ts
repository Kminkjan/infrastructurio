import type {
  AccessibilityFactor,
  AccessibilityFactorValue,
  AccessibilitySnapshot,
  LocationAccessibility,
  Point,
  RoadNetwork,
} from "../../shared";
import { findRoadRoute } from "../transport/road-network";

const POSITION_EPSILON = 1e-7;
const SCORE_PRECISION = 1_000;

export interface AccessibilityCandidate {
  readonly id: string;
  readonly name: string;
  readonly position: Point;
}

export interface AccessibilityOpportunity {
  readonly id: string;
  readonly factor: AccessibilityFactor;
  readonly position: Point;
  readonly weight: number;
}

export interface AccessibilityModel {
  readonly candidates: readonly AccessibilityCandidate[];
  readonly opportunities: readonly AccessibilityOpportunity[];
  readonly decayCost: number;
}

export interface AccessibilityScorer {
  getSnapshot(): AccessibilitySnapshot;
  updateNetwork(network: RoadNetwork): AccessibilitySnapshot;
}

interface CachedLocation {
  readonly componentFingerprint: string | null;
  readonly opportunityCosts: readonly (number | null)[];
  readonly value: LocationAccessibility;
}

function samePoint(first: Point, second: Point): boolean {
  return (
    Math.abs(first.x - second.x) <= POSITION_EPSILON &&
    Math.abs(first.y - second.y) <= POSITION_EPSILON
  );
}

function validatePoint(position: Point, name: string): void {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new RangeError(`${name} must have finite coordinates`);
  }
}

function validateModel(model: AccessibilityModel): void {
  if (!Number.isFinite(model.decayCost) || model.decayCost <= 0) {
    throw new RangeError("accessibility decay cost must be positive and finite");
  }

  const candidateIds = new Set<string>();
  for (const candidate of model.candidates) {
    if (candidate.id.length === 0 || candidateIds.has(candidate.id)) {
      throw new RangeError(
        "accessibility candidate ids must be non-empty and unique",
      );
    }
    validatePoint(candidate.position, `accessibility candidate ${candidate.id}`);
    candidateIds.add(candidate.id);
  }

  const opportunityIds = new Set<string>();
  for (const opportunity of model.opportunities) {
    if (opportunity.id.length === 0 || opportunityIds.has(opportunity.id)) {
      throw new RangeError(
        "accessibility opportunity ids must be non-empty and unique",
      );
    }
    if (!Number.isFinite(opportunity.weight) || opportunity.weight <= 0) {
      throw new RangeError(
        "accessibility opportunity weights must be positive and finite",
      );
    }
    validatePoint(
      opportunity.position,
      `accessibility opportunity ${opportunity.id}`,
    );
    opportunityIds.add(opportunity.id);
  }
}

function componentFingerprint(
  network: RoadNetwork,
  position: Point,
): string | null {
  const startNode = network.nodes.find((node) =>
    samePoint(node.position, position),
  );
  if (!startNode) {
    return null;
  }

  const linksByNode = new Map<string, typeof network.links>();
  for (const node of network.nodes) {
    linksByNode.set(
      node.id,
      network.links.filter(
        (link) =>
          link.startNodeId === node.id || link.endNodeId === node.id,
      ),
    );
  }

  const visitedNodes = new Set<string>();
  const componentLinks = new Set<string>();
  const pending = [startNode.id];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (nodeId === undefined || visitedNodes.has(nodeId)) {
      continue;
    }
    visitedNodes.add(nodeId);

    for (const link of linksByNode.get(nodeId) ?? []) {
      componentLinks.add(link.id);
      pending.push(
        link.startNodeId === nodeId ? link.endNodeId : link.startNodeId,
      );
    }
  }

  return [...componentLinks]
    .sort((first, second) => first.localeCompare(second))
    .map((linkId) => {
      const link = network.links.find(({ id }) => id === linkId);
      if (!link) {
        return linkId;
      }
      const start = network.nodes.find(({ id }) => id === link.startNodeId);
      const end = network.nodes.find(({ id }) => id === link.endNodeId);
      return [
        link.id,
        link.length,
        link.generalizedCostHours,
        start?.position.x,
        start?.position.y,
        end?.position.x,
        end?.position.y,
      ].join(":");
    })
    .join("|");
}

function factorValue(
  factor: AccessibilityFactor,
  opportunities: readonly AccessibilityOpportunity[],
  opportunityCosts: readonly (number | null)[],
  decayCost: number,
): AccessibilityFactorValue {
  let score = 0;
  let nearestNetworkCost = Number.POSITIVE_INFINITY;
  let reachableOpportunityCount = 0;

  for (let index = 0; index < opportunities.length; index += 1) {
    const opportunity = opportunities[index];
    const routeCost = opportunityCosts[index];
    if (!opportunity || opportunity.factor !== factor || routeCost === null) {
      continue;
    }

    reachableOpportunityCount += 1;
    nearestNetworkCost = Math.min(nearestNetworkCost, routeCost);
    score += opportunity.weight * Math.exp(-routeCost / decayCost);
  }

  return Object.freeze({
    score: Math.round(score * SCORE_PRECISION) / SCORE_PRECISION,
    nearestNetworkCost: Number.isFinite(nearestNetworkCost)
      ? nearestNetworkCost
      : null,
    reachableOpportunityCount,
  });
}

function scoreLocation(
  candidate: AccessibilityCandidate,
  model: AccessibilityModel,
  opportunityCosts: readonly (number | null)[],
): LocationAccessibility {
  return Object.freeze({
    locationId: candidate.id,
    name: candidate.name,
    position: Object.freeze({ ...candidate.position }),
    market: factorValue(
      "market",
      model.opportunities,
      opportunityCosts,
      model.decayCost,
    ),
    labor: factorValue(
      "labor",
      model.opportunities,
      opportunityCosts,
      model.decayCost,
    ),
    resource: factorValue(
      "resource",
      model.opportunities,
      opportunityCosts,
      model.decayCost,
    ),
    service: factorValue(
      "service",
      model.opportunities,
      opportunityCosts,
      model.decayCost,
    ),
  });
}

function opportunityCosts(
  candidate: AccessibilityCandidate,
  opportunities: readonly AccessibilityOpportunity[],
  network: RoadNetwork,
): readonly (number | null)[] {
  return Object.freeze(
    opportunities.map(
      (opportunity) =>
        findRoadRoute(network, candidate.position, opportunity.position)
          ?.generalizedCostHours ?? null,
    ),
  );
}

function sameCosts(
  first: readonly (number | null)[],
  second: readonly (number | null)[],
): boolean {
  return first.length === second.length && first.every((cost, index) => {
    const other = second[index];
    return (
      cost === other ||
      (cost !== null &&
        other !== null &&
        Math.abs(cost - other) <= POSITION_EPSILON)
    );
  });
}

export function createAccessibilityScorer(
  model: AccessibilityModel,
  initialNetwork: RoadNetwork,
): AccessibilityScorer {
  validateModel(model);
  let cache = new Map<string, CachedLocation>();
  let currentSnapshot: AccessibilitySnapshot;

  function updateNetwork(network: RoadNetwork): AccessibilitySnapshot {
    const nextCache = new Map<string, CachedLocation>();
    const locations: LocationAccessibility[] = [];
    const invalidatedLocationIds: string[] = [];

    for (const candidate of model.candidates) {
      const fingerprint = componentFingerprint(network, candidate.position);
      const previous = cache.get(candidate.id);
      let costs = previous?.opportunityCosts;
      let value = previous?.value;

      if (!previous || previous.componentFingerprint !== fingerprint) {
        const nextCosts = opportunityCosts(
          candidate,
          model.opportunities,
          network,
        );
        if (!previous || !sameCosts(previous.opportunityCosts, nextCosts)) {
          costs = nextCosts;
          value = scoreLocation(candidate, model, nextCosts);
          invalidatedLocationIds.push(candidate.id);
        }
      }
      if (!costs || !value) {
        throw new Error("accessibility cache did not produce a location value");
      }
      nextCache.set(candidate.id, {
        componentFingerprint: fingerprint,
        opportunityCosts: costs,
        value,
      });
      locations.push(value);
    }

    cache = nextCache;
    currentSnapshot = Object.freeze({
      locations: Object.freeze(locations),
      lastNetworkUpdateInvalidatedLocationIds: Object.freeze(
        invalidatedLocationIds,
      ),
    });
    return currentSnapshot;
  }

  updateNetwork(initialNetwork);
  return {
    getSnapshot() {
      return currentSnapshot;
    },
    updateNetwork,
  };
}
