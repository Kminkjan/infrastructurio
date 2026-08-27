// @vitest-environment node

import { describe, expect, it } from "vitest";
import { generateMillfordValley } from "../../scenarios";
import type { RailTrackSegment } from "../../shared";
import {
  createFreightRailTerminalState,
  createRailNetwork,
  findRailRoute,
} from "./rail-network";

const geography = generateMillfordValley("rail-network");

function track(
  id: string,
  start: RailTrackSegment["start"],
  end: RailTrackSegment["end"],
): RailTrackSegment {
  return { id, start, end };
}

describe("rail network", () => {
  it("builds a graph separate from roads and routes compatible terminals deterministically", () => {
    const quarry = createFreightRailTerminalState(geography, "quarry");
    const stoneworks = createFreightRailTerminalState(geography, "stoneworks");
    const tracks = [
      track("rail-track-1", geography.quarry.position, { x: 300, y: 300 }),
      track("rail-track-2", { x: 300, y: 300 }, geography.stoneworks.position),
    ];

    const first = createRailNetwork(tracks, [quarry, stoneworks], geography);
    const second = createRailNetwork(tracks, [quarry, stoneworks], geography);
    const route = findRailRoute(
      first,
      "rail-terminal-quarry",
      "rail-terminal-stoneworks",
    );

    expect(first).toEqual(second);
    expect(findRailRoute(second, quarry.id, stoneworks.id)).toEqual(route);
    expect(route).toMatchObject({
      originTerminalId: quarry.id,
      destinationTerminalId: stoneworks.id,
      linkIds: ["rail-track-1:link-1", "rail-track-2:link-1"],
      capacityTonsPerDay: 240,
    });
    expect(route!.freeFlowTravelTimeHours).toBe(
      route!.trackTravelTimeHours + route!.terminalTransferTimeHours,
    );
  });

  it("splits at-grade track intersections and terminal connections", () => {
    const quarry = createFreightRailTerminalState(geography, "quarry");
    const throughQuarry = track(
      "through-quarry",
      { x: geography.quarry.position.x - 10, y: geography.quarry.position.y },
      { x: geography.quarry.position.x + 10, y: geography.quarry.position.y },
    );
    const crossing = track(
      "crossing",
      { x: geography.quarry.position.x, y: geography.quarry.position.y - 10 },
      { x: geography.quarry.position.x, y: geography.quarry.position.y + 10 },
    );
    const network = createRailNetwork(
      [throughQuarry, crossing],
      [quarry],
      geography,
    );

    expect(network.nodes.filter(({ position }) =>
      position.x === geography.quarry.position.x &&
      position.y === geography.quarry.position.y,
    )).toHaveLength(1);
    expect(network.links).toHaveLength(4);
  });

  it("returns no route when a terminal or required track is absent", () => {
    const terminals = [
      createFreightRailTerminalState(geography, "quarry"),
      createFreightRailTerminalState(geography, "stoneworks"),
    ];
    const connected = createRailNetwork(
      [track("rail-track-1", geography.quarry.position, geography.stoneworks.position)],
      terminals,
      geography,
    );
    const disconnected = createRailNetwork([], terminals, geography);

    expect(findRailRoute(connected, terminals[0]!.id, terminals[1]!.id)).toBeDefined();
    expect(findRailRoute(disconnected, terminals[0]!.id, terminals[1]!.id)).toBeUndefined();
    expect(findRailRoute(connected, "missing", terminals[1]!.id)).toBeUndefined();
  });

  it("rejects duplicate, degenerate, overlapping, and incompatible inputs", () => {
    expect(() => createRailNetwork([
      track("duplicate", { x: 0, y: 0 }, { x: 10, y: 0 }),
      track("duplicate", { x: 0, y: 10 }, { x: 10, y: 10 }),
    ], [], geography)).toThrow("unique");
    expect(() => createRailNetwork([
      track("point", { x: 1, y: 1 }, { x: 1, y: 1 }),
    ], [], geography)).toThrow("distinct endpoints");
    expect(() => createRailNetwork([
      track("first", { x: 0, y: 0 }, { x: 10, y: 0 }),
      track("overlap", { x: 5, y: 0 }, { x: 15, y: 0 }),
    ], [], geography)).toThrow("may not overlap");
    expect(() => createRailNetwork([], [{
      id: "rail-terminal-quarry",
      site: "quarry",
      siteId: "wrong-site",
    }], geography)).toThrow("compatible site");
  });
});
