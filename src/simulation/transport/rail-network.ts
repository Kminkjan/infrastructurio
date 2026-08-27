import type {
  FreightRailTerminalSnapshot,
  FreightRailTerminalState,
  Point,
  RailLink,
  RailNetwork,
  RailNode,
  RailRoute,
  RailTerminalSite,
  RailTrackSegment,
  RailTrackSnapshot,
  ScenarioGeography,
} from "../../shared";
import {
  FREIGHT_RAIL_TERMINAL_CAPACITY_TONS_PER_DAY,
  FREIGHT_RAIL_TERMINAL_TRANSFER_TIME_HOURS,
  RAIL_TRACK_CAPACITY_TONS_PER_DAY,
  RAIL_TRACK_SPEED_MAP_UNITS_PER_HOUR,
  freightRailTerminalSnapshotEconomics,
  railTrackSnapshotEconomics,
} from "../economy/infrastructure-finance";

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

function samePoint(first: Point, second: Point): boolean {
  return (
    Math.abs(first.x - second.x) <= EPSILON &&
    Math.abs(first.y - second.y) <= EPSILON
  );
}

function pointAt(segment: RailTrackSegment, parameter: number): Point {
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * parameter,
    y: segment.start.y + (segment.end.y - segment.start.y) * parameter,
  };
}

function parameterOnSegment(
  segment: RailTrackSegment,
  position: Point,
): number {
  const direction = subtract(segment.end, segment.start);
  return (
    dot(subtract(position, segment.start), direction) /
    dot(direction, direction)
  );
}

function pointOnSegment(segment: RailTrackSegment, point: Point): boolean {
  const parameter = parameterOnSegment(segment, point);
  return (
    parameter >= -EPSILON &&
    parameter <= 1 + EPSILON &&
    Math.abs(
      cross(subtract(point, segment.start), subtract(segment.end, segment.start)),
    ) <= EPSILON
  );
}

function segmentIntersection(
  first: RailTrackSegment,
  second: RailTrackSegment,
): Point | undefined {
  const firstDirection = subtract(first.end, first.start);
  const secondDirection = subtract(second.end, second.start);
  const betweenStarts = subtract(second.start, first.start);
  const denominator = cross(firstDirection, secondDirection);

  if (Math.abs(denominator) <= EPSILON) {
    if (Math.abs(cross(betweenStarts, firstDirection)) > EPSILON) {
      return undefined;
    }
    const lengthSquared = dot(firstDirection, firstDirection);
    const secondStart = dot(betweenStarts, firstDirection) / lengthSquared;
    const secondEnd =
      dot(subtract(second.end, first.start), firstDirection) / lengthSquared;
    const overlapStart = Math.max(0, Math.min(secondStart, secondEnd));
    const overlapEnd = Math.min(1, Math.max(secondStart, secondEnd));
    if (overlapEnd < overlapStart - EPSILON) {
      return undefined;
    }
    if (overlapEnd - overlapStart > EPSILON) {
      throw new RangeError("rail tracks may not overlap");
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

function terminalSite(
  geography: ScenarioGeography,
  site: RailTerminalSite,
): { readonly siteId: string; readonly name: string; readonly position: Point } {
  switch (site) {
    case "quarry":
      return {
        siteId: geography.quarry.id,
        name: `${geography.quarry.name} freight terminal`,
        position: geography.quarry.position,
      };
    case "stoneworks":
      return {
        siteId: geography.stoneworks.id,
        name: `${geography.stoneworks.name} freight terminal`,
        position: geography.stoneworks.position,
      };
    case "market":
      return {
        siteId: geography.externalMarketConnection.id,
        name: `${geography.externalMarketConnection.name} freight terminal`,
        position: geography.externalMarketConnection.position,
      };
    default:
      throw new RangeError(`unsupported freight rail terminal site: ${String(site)}`);
  }
}

export function createFreightRailTerminalState(
  geography: ScenarioGeography,
  site: RailTerminalSite,
): FreightRailTerminalState {
  const compatibleSite = terminalSite(geography, site);
  return Object.freeze({
    id: `rail-terminal-${site}`,
    site,
    siteId: compatibleSite.siteId,
  });
}

function createTerminalSnapshot(
  geography: ScenarioGeography,
  terminal: FreightRailTerminalState,
): FreightRailTerminalSnapshot {
  const compatibleSite = terminalSite(geography, terminal.site);
  if (
    terminal.id !== `rail-terminal-${terminal.site}` ||
    terminal.siteId !== compatibleSite.siteId
  ) {
    throw new RangeError("rail terminal does not match its compatible site");
  }
  return Object.freeze({
    ...terminal,
    name: compatibleSite.name,
    position: freezePoint(compatibleSite.position),
    capacityTonsPerDay: FREIGHT_RAIL_TERMINAL_CAPACITY_TONS_PER_DAY,
    freeFlowTransferTimeHours: FREIGHT_RAIL_TERMINAL_TRANSFER_TIME_HOURS,
    ...freightRailTerminalSnapshotEconomics(),
  });
}

export function createRailNetwork(
  inputTracks: readonly RailTrackSegment[] = [],
  inputTerminals: readonly FreightRailTerminalState[] = [],
  geography: ScenarioGeography,
): RailNetwork {
  const trackIds = new Set<string>();
  for (const track of inputTracks) {
    if (track.id.length === 0 || trackIds.has(track.id)) {
      throw new RangeError("rail track ids must be non-empty and unique");
    }
    if (
      !Number.isFinite(track.start.x) ||
      !Number.isFinite(track.start.y) ||
      !Number.isFinite(track.end.x) ||
      !Number.isFinite(track.end.y) ||
      samePoint(track.start, track.end)
    ) {
      throw new RangeError("rail tracks require two finite, distinct endpoints");
    }
    trackIds.add(track.id);
  }
  const terminalIds = new Set<string>();
  const terminalSites = new Set<RailTerminalSite>();
  for (const terminal of inputTerminals) {
    if (
      terminal.id.length === 0 ||
      terminalIds.has(terminal.id) ||
      terminalSites.has(terminal.site)
    ) {
      throw new RangeError("rail terminals must have unique ids and sites");
    }
    terminalIds.add(terminal.id);
    terminalSites.add(terminal.site);
  }

  const terminals = inputTerminals.map((terminal) =>
    createTerminalSnapshot(geography, terminal),
  );
  const tracks: RailTrackSnapshot[] = inputTracks.map((track) => {
    const start = freezePoint(track.start);
    const end = freezePoint(track.end);
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    return Object.freeze({
      id: track.id,
      start,
      end,
      length,
      capacityTonsPerDay: RAIL_TRACK_CAPACITY_TONS_PER_DAY,
      freeFlowTravelTimeHours: length / RAIL_TRACK_SPEED_MAP_UNITS_PER_HOUR,
      ...railTrackSnapshotEconomics(geography, { start, end }),
    });
  });
  const breakpoints = tracks.map((track) => [
    { parameter: 0, position: track.start },
    { parameter: 1, position: track.end },
  ] as Breakpoint[]);

  for (let firstIndex = 0; firstIndex < tracks.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < tracks.length;
      secondIndex += 1
    ) {
      const first = tracks[firstIndex]!;
      const second = tracks[secondIndex]!;
      const position = segmentIntersection(first, second);
      if (!position) {
        continue;
      }
      breakpoints[firstIndex]!.push({
        parameter: parameterOnSegment(first, position),
        position,
      });
      breakpoints[secondIndex]!.push({
        parameter: parameterOnSegment(second, position),
        position,
      });
    }
  }

  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
    const track = tracks[trackIndex]!;
    for (const terminal of terminals) {
      if (pointOnSegment(track, terminal.position)) {
        breakpoints[trackIndex]!.push({
          parameter: parameterOnSegment(track, terminal.position),
          position: terminal.position,
        });
      }
    }
  }

  const nodes: RailNode[] = [];
  const links: RailLink[] = [];
  function nodeFor(position: Point): RailNode {
    const existing = nodes.find((node) => samePoint(node.position, position));
    if (existing) {
      return existing;
    }
    const node = Object.freeze({
      id: `rail-node-${nodes.length + 1}`,
      position: freezePoint(position),
    });
    nodes.push(node);
    return node;
  }

  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
    const track = tracks[trackIndex]!;
    const ordered = breakpoints[trackIndex]!
      .sort((first, second) => first.parameter - second.parameter)
      .filter(
        (breakpoint, index, values) =>
          index === 0 ||
          Math.abs(
            breakpoint.parameter - (values[index - 1]?.parameter ?? 0),
          ) > EPSILON,
      );
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const start = ordered[index]!;
      const end = ordered[index + 1]!;
      if (samePoint(start.position, end.position)) {
        continue;
      }
      const startNode = nodeFor(start.position);
      const endNode = nodeFor(end.position);
      const length = Math.hypot(
        end.position.x - start.position.x,
        end.position.y - start.position.y,
      );
      links.push(
        Object.freeze({
          id: `${track.id}:link-${index + 1}`,
          railTrackId: track.id,
          startNodeId: startNode.id,
          endNodeId: endNode.id,
          length,
          capacityTonsPerDay: track.capacityTonsPerDay,
          freeFlowTravelTimeHours:
            length / RAIL_TRACK_SPEED_MAP_UNITS_PER_HOUR,
        }),
      );
    }
  }

  return Object.freeze({
    tracks: Object.freeze(tracks),
    terminals: Object.freeze(terminals),
    nodes: Object.freeze(nodes),
    links: Object.freeze(links),
  });
}

export function findRailRoute(
  network: RailNetwork,
  originTerminalId: string,
  destinationTerminalId: string,
): RailRoute | undefined {
  const origin = network.terminals.find(({ id }) => id === originTerminalId);
  const destination = network.terminals.find(
    ({ id }) => id === destinationTerminalId,
  );
  if (!origin || !destination || origin.id === destination.id) {
    return undefined;
  }
  const startNode = network.nodes.find((node) =>
    samePoint(node.position, origin.position),
  );
  const endNode = network.nodes.find((node) =>
    samePoint(node.position, destination.position),
  );
  if (!startNode || !endNode) {
    return undefined;
  }

  const adjacency = new Map<
    string,
    { readonly link: RailLink; readonly nodeId: string }[]
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
  const unvisited = new Set(network.nodes.map(({ id }) => id));
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
      const nextDistance =
        currentDistance + connection.link.freeFlowTravelTimeHours;
      if (
        nextDistance <
        (distances.get(connection.nodeId) ?? Number.POSITIVE_INFINITY) - EPSILON
      ) {
        distances.set(connection.nodeId, nextDistance);
        previous.set(connection.nodeId, {
          nodeId: current,
          linkId: connection.link.id,
        });
      }
    }
  }
  if (!distances.has(endNode.id)) {
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

  const links = linkIds.map(
    (linkId) => network.links.find(({ id }) => id === linkId)!,
  );
  const length = links.reduce((total, link) => total + link.length, 0);
  const trackTravelTimeHours = links.reduce(
    (total, link) => total + link.freeFlowTravelTimeHours,
    0,
  );
  const terminalTransferTimeHours =
    origin.freeFlowTransferTimeHours + destination.freeFlowTransferTimeHours;
  return Object.freeze({
    originTerminalId: origin.id,
    destinationTerminalId: destination.id,
    nodeIds: Object.freeze(nodeIds),
    linkIds: Object.freeze(linkIds),
    length,
    trackTravelTimeHours,
    terminalTransferTimeHours,
    freeFlowTravelTimeHours:
      trackTravelTimeHours + terminalTransferTimeHours,
    capacityTonsPerDay: Math.min(
      origin.capacityTonsPerDay,
      destination.capacityTonsPerDay,
      ...links.map(({ capacityTonsPerDay }) => capacityTonsPerDay),
    ),
  });
}
