import type {
  AggregateFreightSnapshot,
  Point,
  RoadNetwork,
} from "../shared";

export const TONS_PER_REPRESENTATIVE_VEHICLE = 20;
export const REPRESENTATIVE_VEHICLE_SPEED = 90;

interface RouteSegment {
  readonly start: Point;
  readonly end: Point;
  readonly startDistance: number;
  readonly length: number;
}

export interface RepresentativeFreightTrafficPlan {
  readonly key: string;
  readonly vehicleCount: number;
  readonly routeLength: number;
  readonly travelDurationSeconds: number;
  readonly segments: readonly RouteSegment[];
}

export interface RepresentativeFreightVehicleSample {
  readonly id: string;
  readonly position: Point;
  readonly rotation: number;
  readonly progress: number;
}

function routeSegments(points: readonly Point[]): readonly RouteSegment[] {
  const segments: RouteSegment[] = [];
  let startDistance = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) {
      continue;
    }

    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length === 0) {
      continue;
    }

    segments.push({ start, end, startDistance, length });
    startDistance += length;
  }

  return segments;
}

function routeMatchesNetwork(
  freight: AggregateFreightSnapshot,
  roadNetwork: RoadNetwork,
): boolean {
  const route = freight.route;
  if (!route || route.nodeIds.length !== route.linkIds.length + 1) {
    return false;
  }

  const links = new Map(roadNetwork.links.map((link) => [link.id, link]));
  return route.linkIds.every((linkId, index) => {
    const link = links.get(linkId);
    const startNodeId = route.nodeIds[index];
    const endNodeId = route.nodeIds[index + 1];
    return (
      link !== undefined &&
      ((link.startNodeId === startNodeId && link.endNodeId === endNodeId) ||
        (link.startNodeId === endNodeId && link.endNodeId === startNodeId))
    );
  });
}

export function createRepresentativeFreightTrafficPlan(
  freight: AggregateFreightSnapshot,
  roadNetwork: RoadNetwork,
): RepresentativeFreightTrafficPlan | undefined {
  if (
    freight.shippedTonsPerDay <= 0 ||
    !Number.isFinite(freight.shippedTonsPerDay) ||
    !routeMatchesNetwork(freight, roadNetwork)
  ) {
    return undefined;
  }

  const nodes = new Map(
    roadNetwork.nodes.map((node) => [node.id, node.position]),
  );
  const points = freight.route?.nodeIds.map((nodeId) => nodes.get(nodeId));
  if (!points || points.some((point) => point === undefined)) {
    return undefined;
  }

  const definedPoints = points as readonly Point[];
  const segments = routeSegments(definedPoints);
  const routeLength = segments.reduce(
    (total, segment) => total + segment.length,
    0,
  );
  if (routeLength === 0) {
    return undefined;
  }

  const vehicleCount = Math.ceil(
    freight.shippedTonsPerDay / TONS_PER_REPRESENTATIVE_VEHICLE,
  );
  const routeKey = freight.route?.linkIds.join(",") ?? "";
  const geometryKey = definedPoints
    .map(({ x, y }) => `${x}:${y}`)
    .join(";");

  return {
    key: `${routeKey}|${geometryKey}|${freight.shippedTonsPerDay}`,
    vehicleCount,
    routeLength,
    travelDurationSeconds: routeLength / REPRESENTATIVE_VEHICLE_SPEED,
    segments,
  };
}

function samplePosition(
  plan: RepresentativeFreightTrafficPlan,
  progress: number,
): Pick<RepresentativeFreightVehicleSample, "position" | "rotation"> {
  const distance = progress * plan.routeLength;
  const segment =
    plan.segments.find(
      (candidate) =>
        distance < candidate.startDistance + candidate.length,
    ) ?? plan.segments[plan.segments.length - 1];

  if (!segment) {
    return { position: { x: 0, y: 0 }, rotation: 0 };
  }

  const segmentProgress = Math.min(
    1,
    Math.max(0, (distance - segment.startDistance) / segment.length),
  );
  return {
    position: {
      x: segment.start.x + (segment.end.x - segment.start.x) * segmentProgress,
      y: segment.start.y + (segment.end.y - segment.start.y) * segmentProgress,
    },
    rotation: Math.atan2(
      segment.end.y - segment.start.y,
      segment.end.x - segment.start.x,
    ),
  };
}

export function sampleRepresentativeFreightVehicles(
  plan: RepresentativeFreightTrafficPlan,
  elapsedSeconds: number,
): readonly RepresentativeFreightVehicleSample[] {
  const elapsed = Math.max(
    0,
    Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0,
  );
  const cycle = elapsed / plan.travelDurationSeconds;

  return Array.from({ length: plan.vehicleCount }, (_, slot) => {
    const phase = cycle + slot / plan.vehicleCount;
    const trip = Math.floor(phase);
    const progress = phase - trip;
    const { position, rotation } = samplePosition(plan, progress);

    return {
      id: `representative-freight-${slot}-trip-${trip}`,
      position,
      rotation,
      progress,
    };
  });
}
