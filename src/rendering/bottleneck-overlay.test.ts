// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createSimulation } from "../simulation";
import { getBottleneckOverlayFeatures } from "./bottleneck-overlay";

function activeChain() {
  const simulation = createSimulation("millford-valley-foundation");
  const geography = simulation.getSnapshot().geography;
  simulation.dispatch({
    type: "build-road",
    start: geography.quarry.position,
    end: geography.stoneworks.position,
  });
  simulation.dispatch({
    type: "build-road",
    start: geography.stoneworks.position,
    end: geography.externalMarketConnection.position,
  });
  return {
    simulation,
    geography,
    snapshot: simulation.dispatch({ type: "advance", ticks: 24 }),
  };
}

describe("bottleneck map overlay", () => {
  it("maps both authoritative freight routes and their overloaded links", () => {
    const { snapshot } = activeChain();
    const features = getBottleneckOverlayFeatures(snapshot);

    expect(features.map(({ role }) => role)).toEqual([
      "affected-flow",
      "affected-flow",
      "overloaded-link",
      "overloaded-link",
    ]);
    expect(features.map(({ id }) => id)).toEqual([
      "affected-flow:road-segment-1:link-1",
      "affected-flow:road-segment-2:link-1",
      "bottleneck:road-segment-1:link-1",
      "bottleneck:road-segment-2:link-1",
    ]);
  });

  it("retains affected routes after upgrades remove both overloads", () => {
    const { simulation } = activeChain();
    simulation.dispatch({ type: "upgrade-road", roadSegmentId: "road-segment-1" });
    const upgraded = simulation.dispatch({
      type: "upgrade-road",
      roadSegmentId: "road-segment-2",
    });

    expect(
      getBottleneckOverlayFeatures(upgraded).map(({ role }) => role),
    ).toEqual(["affected-flow", "affected-flow"]);
  });
});
