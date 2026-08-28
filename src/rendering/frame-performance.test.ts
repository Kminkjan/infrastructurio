// @vitest-environment node

import { describe, expect, it } from "vitest";
import { summarizeFramePerformance } from "./frame-performance";

describe("frame performance summaries", () => {
  it("reports stable frame pacing statistics and ignores invalid samples", () => {
    expect(
      summarizeFramePerformance([
        16,
        17,
        15,
        21,
        34,
        Number.NaN,
        -1,
      ]),
    ).toEqual({
      samples: 5,
      averageFrameMs: 20.6,
      p95FrameMs: 34,
      maximumFrameMs: 34,
      averageFps: 48.544,
      framesOver20Ms: 2,
      framesOver33Ms: 1,
    });
  });

  it("does not manufacture a result without samples", () => {
    expect(summarizeFramePerformance([])).toBeUndefined();
  });
});
