// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createSaveGame, serializeSaveGame } from "../persistence";
import { restoreSimulation, type Simulation } from "../simulation";
import { createM3TargetScaleFixture } from "./m3-release-fixture";

const SAMPLE_COUNT = 25;

interface TimingSummary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function summarize(samples: readonly number[]): TimingSummary {
  const sorted = [...samples].sort((first, second) => first - second);
  const percentile95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
  return Object.freeze({
    medianMs: rounded(sorted[Math.floor(sorted.length / 2)]!),
    p95Ms: rounded(percentile95),
    maximumMs: rounded(sorted.at(-1)!),
  });
}

function measure(operation: () => void): TimingSummary {
  operation();
  const samples = Array.from({ length: SAMPLE_COUNT }, () => {
    const start = performance.now();
    operation();
    return performance.now() - start;
  });
  return summarize(samples);
}

function measureRestored(
  simulation: Simulation,
  operation: (copy: Simulation) => void,
): TimingSummary {
  const state = simulation.getState();
  return measure(() => operation(restoreSimulation(state)));
}

describe("M3 target-scale measurements", () => {
  it("profiles headless stepping, assignment, snapshots, and serialization", () => {
    const fixture = createM3TargetScaleFixture();
    const runtimeProcess = (
      globalThis as typeof globalThis & {
        readonly process: {
          readonly platform: string;
          readonly arch: string;
          readonly version: string;
        };
      }
    ).process;
    const metrics = Object.freeze({
      reference: Object.freeze({
        runtime: `${runtimeProcess.platform} ${runtimeProcess.arch} / Node ${runtimeProcess.version}`,
        samples: SAMPLE_COUNT,
        roads: fixture.roadSegmentCount,
        roadLinks: fixture.roadLinkCount,
        railTracks: fixture.railTrackCount,
        railLinks: fixture.railLinkCount,
        terminals: fixture.snapshot.railNetwork.terminals.length,
        developmentMarks: fixture.developmentMarkCount,
        overlays: fixture.overlayFeatureCount,
        representativeVehicles: fixture.representativeVehicleCount,
      }),
      oneTickStep: measureRestored(fixture.simulation, (simulation) => {
        simulation.dispatch({ type: "advance", ticks: 1 });
      }),
      eightTickRouteAssignment: measureRestored(
        fixture.simulation,
        (simulation) => {
          simulation.dispatch({ type: "advance", ticks: 8 });
        },
      ),
      sevenDaySustainedRun: measureRestored(
        fixture.simulation,
        (simulation) => {
          simulation.dispatch({ type: "advance", ticks: 24 * 7 });
        },
      ),
      snapshot: measure(() => {
        fixture.simulation.getSnapshot();
      }),
      serializeSave: measure(() => {
        serializeSaveGame(createSaveGame(fixture.simulation));
      }),
    });

    console.info(`M3_PERFORMANCE ${JSON.stringify(metrics)}`);
    for (const timing of [
      metrics.oneTickStep,
      metrics.eightTickRouteAssignment,
      metrics.sevenDaySustainedRun,
      metrics.snapshot,
      metrics.serializeSave,
    ]) {
      expect(timing.medianMs).toBeGreaterThanOrEqual(0);
      expect(timing.p95Ms).toBeLessThan(250);
    }
  });
});
