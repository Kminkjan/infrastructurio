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
      "inbound-freight",
      "outbound-freight",
      "overloaded-link",
      "overloaded-link",
    ]);
    expect(features.map(({ id }) => id)).toEqual([
      "stone-supply-inbound:road-segment-1:link-1",
      "stone-supply-outbound:road-segment-2:link-1",
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
    ).toEqual(["inbound-freight", "outbound-freight"]);
  });

  it("maps rail freight from the authoritative rail links", () => {
    const simulation = createSimulation("rail-explanation-overlay");
    const geography = simulation.getSnapshot().geography;
    for (const site of ["quarry", "stoneworks", "market"] as const) {
      simulation.dispatch({ type: "place-freight-rail-terminal", site });
    }
    simulation.dispatch({
      type: "build-rail-track",
      start: geography.quarry.position,
      end: geography.stoneworks.position,
    });
    simulation.dispatch({
      type: "build-rail-track",
      start: geography.stoneworks.position,
      end: geography.externalMarketConnection.position,
    });
    const snapshot = simulation.dispatch({ type: "advance", ticks: 24 });
    const features = getBottleneckOverlayFeatures(snapshot);

    expect(snapshot.explanations.freightLegs.map(({ chosenMode }) => chosenMode)).toEqual([
      "rail",
      "rail",
    ]);
    expect(features.map(({ role }) => role)).toEqual([
      "inbound-freight",
      "outbound-freight",
    ]);
    expect(features.every(({ label }) => label.endsWith("by rail"))).toBe(true);
  });
});
