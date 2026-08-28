export interface FramePerformanceSummary {
  readonly samples: number;
  readonly averageFrameMs: number;
  readonly p95FrameMs: number;
  readonly maximumFrameMs: number;
  readonly averageFps: number;
  readonly framesOver20Ms: number;
  readonly framesOver33Ms: number;
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export function summarizeFramePerformance(
  samples: readonly number[],
): FramePerformanceSummary | undefined {
  const finiteSamples = samples.filter(
    (sample) => Number.isFinite(sample) && sample >= 0,
  );
  if (finiteSamples.length === 0) return undefined;
  const ordered = [...finiteSamples].sort((first, second) => first - second);
  const averageFrameMs =
    finiteSamples.reduce((total, sample) => total + sample, 0) /
    finiteSamples.length;
  return Object.freeze({
    samples: finiteSamples.length,
    averageFrameMs: rounded(averageFrameMs),
    p95FrameMs: rounded(ordered[Math.ceil(ordered.length * 0.95) - 1]!),
    maximumFrameMs: rounded(ordered.at(-1)!),
    averageFps: rounded(1_000 / averageFrameMs),
    framesOver20Ms: finiteSamples.filter((sample) => sample > 20).length,
    framesOver33Ms: finiteSamples.filter((sample) => sample > 33).length,
  });
}
