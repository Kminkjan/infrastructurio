// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createSimulation } from "../simulation";
import { getBottleneckOverlayFeatures } from "./bottleneck-overlay";

describe("bottleneck map overlay", () => {
  it("maps the authoritative affected route and overloaded bridge to deterministic lines", () => {
    const simulation = createSimulation("millford-valley-foundation");
    const geography = simulation.getSnapshot().geography;
    const snapshot = simulation.dispatch({
      type: "build-road",
      start: geography.quarry.position,
      end: geography.externalMarketConnection.position,
    });

    expect(getBottleneckOverlayFeatures(snapshot)).toEqual([
      {
        id: "affected-flow:road-segment-1:link-1",
        role: "affected-flow",
        start: geography.quarry.position,
        end: geography.externalMarketConnection.position,
        label: "Granite freight affected by the current route choice",
      },
      {
        id: "bottleneck:road-segment-1:link-1",
        role: "overloaded-link",
        start: geography.quarry.position,
        end: geography.externalMarketConnection.position,
        label: "Overloaded Millford bridge: 125% of practical capacity",
      },
    ]);
  });

  it("clears the overload line once an intervention removes the bottleneck", () => {
    const simulation = createSimulation("millford-valley-foundation");
    const geography = simulation.getSnapshot().geography;
    simulation.dispatch({
      type: "build-road",
      start: geography.quarry.position,
      end: geography.externalMarketConnection.position,
    });
    const upgraded = simulation.dispatch({
      type: "upgrade-road",
      roadSegmentId: "road-segment-1",
    });

    expect(
      getBottleneckOverlayFeatures(upgraded).map(({ role }) => role),
    ).toEqual(["affected-flow"]);
  });
});
