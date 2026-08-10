import type {
  Point,
  RoadLink,
  RoadNetwork,
  RoadNode,
  RoadRoute,
  RoadSegment,
} from "../../shared";

const EPSILON = 1e-7;

interface Breakpoint {
  readonly parameter: number;
  readonly position: Point;
}

function cross(first: Point, second: Point): number {
  return first.x * second.y - first.y * second.x;
}

function subtract(first: Point, second: Point): Point {
  return { x: first.x - second.x, y: first.y - second.y };
}

function dot(first: Point, second: Point): number {
  return first.x * second.x + first.y * second.y;
}

function pointAt(segment: RoadSegment, parameter: number): Point {
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * parameter,
    y: segment.start.y + (segment.end.y - segment.start.y) * parameter,
  };
}

function parameterOnSegment(segment: RoadSegment, position: Point): number {
  const direction = subtract(segment.end, segment.start);
  return (
    dot(subtract(position, segment.start), direction) /
    dot(direction, direction)
  );
}

function samePoint(first: Point, second: Point): boolean {
  return (
    Math.abs(first.x - second.x) <= EPSILON &&
    Math.abs(first.y - second.y) <= EPSILON
  );
}

function segmentIntersection(
  first: RoadSegment,
  second: RoadSegment,
): Point | undefined {
  const firstDirection = subtract(first.end, first.start);
  const secondDirection = subtract(second.end, second.start);
  const betweenStarts = subtract(second.start, first.start);
  const denominator = cross(firstDirection, secondDirection);

  if (Math.abs(denominator) <= EPSILON) {
    if (Math.abs(cross(betweenStarts, firstDirection)) > EPSILON) {
      return undefined;
    }

    const firstLengthSquared = dot(firstDirection, firstDirection);
    const secondStart = dot(betweenStarts, firstDirection) / firstLengthSquared;
    const secondEnd =
      dot(subtract(second.end, first.start), firstDirection) /
      firstLengthSquared;
    const overlapStart = Math.max(0, Math.min(secondStart, secondEnd));
    const overlapEnd = Math.min(1, Math.max(secondStart, secondEnd));

    if (overlapEnd < overlapStart - EPSILON) {
      return undefined;
    }
    if (overlapEnd - overlapStart > EPSILON) {
      throw new RangeError("road segments may not overlap");
    }

    return pointAt(first, Math.min(1, Math.max(0, overlapStart)));
  }

  const firstParameter = cross(betweenStarts, secondDirection) / denominator;
  const secondParameter = cross(betweenStarts, firstDirection) / denominator;
  if (
    firstParameter < -EPSILON ||
    firstParameter > 1 + EPSILON ||
    secondParameter < -EPSILON ||
    secondParameter > 1 + EPSILON
  ) {
    return undefined;
  }

  return pointAt(first, Math.min(1, Math.max(0, firstParameter)));
}

function freezePoint(position: Point): Point {
  return Object.freeze({ x: position.x, y: position.y });
}

function freezeSegment(segment: RoadSegment): RoadSegment {
  return Object.freeze({
    id: segment.id,
    start: freezePoint(segment.start),
    end: freezePoint(segment.end),
  });
}

export function createRoadNetwork(
  inputSegments: readonly RoadSegment[] = [],
): RoadNetwork {
  const segmentIds = new Set<string>();
  for (const segment of inputSegments) {
    if (segment.id.length === 0 || segmentIds.has(segment.id)) {
      throw new RangeError("road segment ids must be non-empty and unique");
    }
    if (
      !Number.isFinite(segment.start.x) ||
      !Number.isFinite(segment.start.y) ||
      !Number.isFinite(segment.end.x) ||
      !Number.isFinite(segment.end.y) ||
      samePoint(segment.start, segment.end)
    ) {
      throw new RangeError("road segments require two finite, distinct endpoints");
    }
    segmentIds.add(segment.id);
  }

  const segments = inputSegments.map(freezeSegment);
  const breakpoints = segments.map((segment) => [
    { parameter: 0, position: segment.start },
    { parameter: 1, position: segment.end },
  ] as Breakpoint[]);

  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < segments.length;
      secondIndex += 1
    ) {
      const first = segments[firstIndex];
      const second = segments[secondIndex];
      if (!first || !second) {
        continue;
      }

      const position = segmentIntersection(first, second);
      if (!position) {
        continue;
      }

      breakpoints[firstIndex]?.push({
        parameter: parameterOnSegment(first, position),
        position,
      });
      breakpoints[secondIndex]?.push({
        parameter: parameterOnSegment(second, position),
        position,
      });
    }
  }

  const nodes: RoadNode[] = [];
  const links: RoadLink[] = [];

  function nodeFor(position: Point): RoadNode {
    const existing = nodes.find((node) => samePoint(node.position, position));
    if (existing) {
      return existing;
    }

    const node = Object.freeze({
      id: `road-node-${nodes.length + 1}`,
      position: freezePoint(position),
    });
    nodes.push(node);
    return node;
  }

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    if (!segment) {
      continue;
    }

    const ordered = (breakpoints[segmentIndex] ?? [])
      .sort((first, second) => first.parameter - second.parameter)
      .filter(
        (breakpoint, index, values) =>
          index === 0 ||
          Math.abs(
            breakpoint.parameter - (values[index - 1]?.parameter ?? 0),
          ) > EPSILON,
      );

    for (let index = 0; index < ordered.length - 1; index += 1) {
      const start = ordered[index];
      const end = ordered[index + 1];
      if (!start || !end || samePoint(start.position, end.position)) {
        continue;
      }

      const startNode = nodeFor(start.position);
      const endNode = nodeFor(end.position);
      links.push(
        Object.freeze({
          id: `${segment.id}:link-${index + 1}`,
          roadSegmentId: segment.id,
          startNodeId: startNode.id,
          endNodeId: endNode.id,
          length: Math.hypot(
            end.position.x - start.position.x,
            end.position.y - start.position.y,
          ),
        }),
      );
    }
  }

  return Object.freeze({
    segments: Object.freeze(segments),
    nodes: Object.freeze(nodes),
    links: Object.freeze(links),
  });
}

export function findRoadRoute(
  network: RoadNetwork,
  start: Point,
  end: Point,
): RoadRoute | undefined {
  const startNode = network.nodes.find((node) => samePoint(node.position, start));
  const endNode = network.nodes.find((node) => samePoint(node.position, end));
  if (!startNode || !endNode) {
    return undefined;
  }
  if (startNode.id === endNode.id) {
    return Object.freeze({
      nodeIds: Object.freeze([startNode.id]),
      linkIds: Object.freeze([]),
      length: 0,
    });
  }

  const adjacency = new Map<
    string,
    { readonly link: RoadLink; readonly nodeId: string }[]
  >();
  for (const link of network.links) {
    const fromStart = adjacency.get(link.startNodeId) ?? [];
    fromStart.push({ link, nodeId: link.endNodeId });
    adjacency.set(link.startNodeId, fromStart);
    const fromEnd = adjacency.get(link.endNodeId) ?? [];
    fromEnd.push({ link, nodeId: link.startNodeId });
    adjacency.set(link.endNodeId, fromEnd);
  }
  for (const connections of adjacency.values()) {
    connections.sort((first, second) =>
      first.link.id.localeCompare(second.link.id),
    );
  }

  const distances = new Map<string, number>([[startNode.id, 0]]);
  const previous = new Map<
    string,
    { readonly nodeId: string; readonly linkId: string }
  >();
  const unvisited = new Set(network.nodes.map((node) => node.id));

  while (unvisited.size > 0) {
    let current: string | undefined;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const nodeId of unvisited) {
      const distance = distances.get(nodeId) ?? Number.POSITIVE_INFINITY;
      if (
        distance < currentDistance - EPSILON ||
        (Math.abs(distance - currentDistance) <= EPSILON &&
          (current === undefined || nodeId.localeCompare(current) < 0))
      ) {
        current = nodeId;
        currentDistance = distance;
      }
    }

    if (current === undefined || !Number.isFinite(currentDistance)) {
      break;
    }
    unvisited.delete(current);
    if (current === endNode.id) {
      break;
    }

    for (const connection of adjacency.get(current) ?? []) {
      if (!unvisited.has(connection.nodeId)) {
        continue;
      }
      const nextDistance = currentDistance + connection.link.length;
      if (
        nextDistance <
        (distances.get(connection.nodeId) ?? Infinity) - EPSILON
      ) {
        distances.set(connection.nodeId, nextDistance);
        previous.set(connection.nodeId, {
          nodeId: current,
          linkId: connection.link.id,
        });
      }
    }
  }

  const length = distances.get(endNode.id);
  if (length === undefined) {
    return undefined;
  }

  const nodeIds = [endNode.id];
  const linkIds: string[] = [];
  let current = endNode.id;
  while (current !== startNode.id) {
    const step = previous.get(current);
    if (!step) {
      return undefined;
    }
    linkIds.push(step.linkId);
    nodeIds.push(step.nodeId);
    current = step.nodeId;
  }

  nodeIds.reverse();
  linkIds.reverse();
  return Object.freeze({
    nodeIds: Object.freeze(nodeIds),
    linkIds: Object.freeze(linkIds),
    length,
  });
}
