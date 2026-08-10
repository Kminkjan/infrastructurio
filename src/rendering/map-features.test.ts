// @vitest-environment node

import { describe, expect, it } from "vitest";
import { generateMillfordValley } from "../scenarios";
import { getSelectableMapFeatures, toMapSelection } from "./map-features";

describe("selectable map features", () => {
  it("maps infrastructure, resources, and settlements from scenario data", () => {
    const geography = generateMillfordValley("selection-test");
    const features = getSelectableMapFeatures(geography);

    expect(features.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "fertile-land-eastbank", kind: "resource" },
      { id: "crossing-millford", kind: "infrastructure" },
      { id: "market-connection-east", kind: "infrastructure" },
      { id: "quarry-granite-ridge", kind: "resource" },
      { id: "settlement-millford", kind: "settlement" },
      { id: "settlement-eastbank", kind: "settlement" },
    ]);
    expect(new Set(features.map(({ id }) => id)).size).toBe(features.length);
  });

  it("exposes presentation-safe inspector data without hit geometry", () => {
    const feature = getSelectableMapFeatures(
      generateMillfordValley("selection-test"),
    )[1];

    expect(feature && toMapSelection(feature)).toEqual({
      id: "crossing-millford",
      name: "Millford Crossing",
      kind: "infrastructure",
      description: "Constrained river crossing",
    });
  });
});
