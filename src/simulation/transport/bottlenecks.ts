import type {
  AggregateFreightSnapshot,
  BottleneckAnalysisSnapshot,
  Point,
  RoadNetwork,
  ScenarioGeography,
} from "../../shared";
import type { RoadTrafficStateSnapshot } from "./road-traffic";

const EPSILON = 1e-7;

function pointInsideCrossing(
  point: Point,
  geography: ScenarioGeography,
): boolean {
  const { center, width, height } = geography.crossingArea;
  return (
    point.x >= center.x - width / 2 - EPSILON &&
    point.x <= center.x + width / 2 + EPSILON &&
    point.y >= center.y - height / 2 - EPSILON &&
    point.y <= center.y + height / 2 + EPSILON
  );
}

function orientation(first: Point, second: Point, third: Point): number {
  return (
    (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x)
  );
}

function intersects(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
): boolean {
  const firstSideStart = orientation(firstStart, firstEnd, secondStart);
  const firstSideEnd = orientation(firstStart, firstEnd, secondEnd);
  const secondSideStart = orientation(secondStart, secondEnd, firstStart);
  const secondSideEnd = orientation(secondStart, secondEnd, firstEnd);
  const boundingBoxesOverlap =
    Math.max(
      Math.min(firstStart.x, firstEnd.x),
      Math.min(secondStart.x, secondEnd.x),
    ) <=
      Math.min(
        Math.max(firstStart.x, firstEnd.x),
        Math.max(secondStart.x, secondEnd.x),
      ) +
        EPSILON &&
    Math.max(
      Math.min(firstStart.y, firstEnd.y),
      Math.min(secondStart.y, secondEnd.y),
    ) <=
      Math.min(
        Math.max(firstStart.y, firstEnd.y),
        Math.max(secondStart.y, secondEnd.y),
      ) +
        EPSILON;
  return (
    boundingBoxesOverlap &&
    firstSideStart * firstSideEnd <= EPSILON &&
    secondSideStart * secondSideEnd <= EPSILON
  );
}

function crossesMillfordConstraint(
  start: Point,
  end: Point,
  geography: ScenarioGeography,
): boolean {
  if (
    pointInsideCrossing(start, geography) ||
    pointInsideCrossing(end, geography)
  ) {
    return true;
  }
  const { center, width, height } = geography.crossingArea;
  const left = center.x - width / 2;
  const right = center.x + width / 2;
  const top = center.y - height / 2;
  const bottom = center.y + height / 2;
  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  return corners.some((corner, index) =>
    intersects(start, end, corner, corners[(index + 1) % corners.length]!),
  );
}

export function createBottleneckAnalysis(
  geography: ScenarioGeography,
  roadNetwork: RoadNetwork,
  roadTraffic: RoadTrafficStateSnapshot,
  freight: AggregateFreightSnapshot,
): BottleneckAnalysisSnapshot {
  const affectedRouteLinkIds = freight.route?.linkIds ?? [];
  const routeLinkIds = new Set(affectedRouteLinkIds);
  const roadBottlenecks = roadNetwork.links
    .filter(
      (link) =>
        link.assignedFlowUnitsPerDay > link.capacityUnitsPerDay + EPSILON,
    )
    .map((link) => {
      const start = roadNetwork.nodes.find(
        ({ id }) => id === link.startNodeId,
      );
      const end = roadNetwork.nodes.find(({ id }) => id === link.endNodeId);
      if (!start || !end) {
        throw new RangeError(`road link ${link.id} has missing endpoint nodes`);
      }
      const isMillfordBridge = crossesMillfordConstraint(
        start.position,
        end.position,
        geography,
      );
      const affectedFlows = routeLinkIds.has(link.id)
        ? [
            Object.freeze({
              id: "quarry-market-granite" as const,
              commodity: "granite" as const,
              originName: geography.quarry.name,
              destinationName: geography.externalMarketConnection.name,
              demandUnitsPerDay: freight.demandTonsPerDay,
              assignedUnitsPerDay: link.assignedFlowUnitsPerDay,
            }),
          ]
        : [];

      return Object.freeze({
        id: `bottleneck:${link.id}`,
        name: isMillfordBridge
          ? "Overloaded Millford bridge"
          : "Overloaded road link",
        roadSegmentId: link.roadSegmentId,
        linkId: link.id,
        roadClass: link.roadClass,
        isMillfordBridge,
        demand: Object.freeze({
          assignedUnitsPerDay: link.assignedFlowUnitsPerDay,
          excessUnitsPerDay:
            link.assignedFlowUnitsPerDay - link.capacityUnitsPerDay,
        }),
        capacity: Object.freeze({
          practicalUnitsPerDay: link.capacityUnitsPerDay,
          volumeCapacityRatio:
            link.assignedFlowUnitsPerDay / link.capacityUnitsPerDay,
        }),
        routeChoice: Object.freeze({
          routeGeneralizedCostHours: freight.route?.generalizedCostHours ?? 0,
          routeLinkCount: freight.route?.linkIds.length ?? 0,
          lastAssignmentTick: roadTraffic.lastAssignmentTick,
          nextAssignmentTick: roadTraffic.nextAssignmentTick,
        }),
        freeFlowTravelTimeHours: link.freeFlowTravelTimeHours,
        congestionDelayHours: link.congestionDelayHours,
        affectedFlows: Object.freeze(affectedFlows),
      });
    });

  return Object.freeze({
    roadBottlenecks: Object.freeze(roadBottlenecks),
    affectedRouteLinkIds: Object.freeze([...affectedRouteLinkIds]),
  });
}
