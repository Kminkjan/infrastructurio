import { describe, expect, it } from "vitest";
import type { TrackPlan } from "../core/sim/api";
import { HINT_LINE, buildTooltip, formatGrade, formatHeight, gradeLevel, splitReason } from "./format";

function plan(overrides: Partial<TrackPlan> = {}): TrackPlan {
  return {
    pieces: [],
    fit: "one-bend",
    end: { node: { q: 1, r: 0, zMm: 6000 }, heading: 0 },
    snapped: null,
    counts: { new: 8, reused: 2 },
    lengthMm: 214_400,
    minRadiusM: 180,
    maxGradePermille: 12,
    speedLimitMms: 12_500,
    label: "R 180 m · 45 km/h · 1.2%",
    note: null,
    ...overrides,
  };
}

describe("tooltip text", () => {
  it("writes the issue's three lines", () => {
    const tip = buildTooltip({ plan: plan(), endHeightMm: 6000, rejection: null, precision: false, anchor: null });
    expect(tip.lines).toEqual([
      "Pieces: 8 new, 2 reused",
      "Length 214 m · Grade 1.2 % · Min radius 180 m · End height +6 m",
      "Hold Ctrl (⌥ on Mac) for precision · [ ] change height",
    ]);
    expect(tip.metrics?.gradeLevel).toBe("green");
    expect(tip.invalid).toBeNull();
    expect(tip.hint).toBe(HINT_LINE);
  });

  it("adds \"Can't build: <reason>\" and the fix hint for a rejection", () => {
    const tip = buildTooltip({
      plan: plan(),
      endHeightMm: 0,
      rejection: { message: "Tracks A and B come 2.10 m apart, but need 4.0 m (or 6.5 m of height difference); move the tracks apart." },
      precision: false,
      anchor: null,
    });
    expect(tip.invalid).toEqual({
      reason: "Tracks A and B come 2.10 m apart, but need 4.0 m (or 6.5 m of height difference)",
      fix: "Move the tracks apart.",
    });
    expect(tip.lines.slice(2)).toEqual([
      "Can't build: Tracks A and B come 2.10 m apart, but need 4.0 m (or 6.5 m of height difference)",
      "Move the tracks apart.",
      HINT_LINE,
    ]);
  });

  it("adds the planner's live label in precision mode", () => {
    const tip = buildTooltip({ plan: plan(), endHeightMm: 0, rejection: null, precision: true, anchor: null });
    expect(tip.precision).toBe("Precision: R 180 m · 45 km/h · 1.2% · wheel radius · Q/E end heading");
    expect(tip.lines.at(-2)).toBe(tip.precision);
  });

  it("colours the grade green ≤ 1.5 %, amber up to the 3.5 % maximum, red above it", () => {
    expect(gradeLevel(0)).toBe("green");
    expect(gradeLevel(15)).toBe("green");
    expect(gradeLevel(15.1)).toBe("amber");
    expect(gradeLevel(30)).toBe("amber");
    expect(gradeLevel(35)).toBe("amber");
    expect(gradeLevel(35.1)).toBe("red");
    expect(gradeLevel(-40)).toBe("red");
  });

  it("formats grades and signed heights", () => {
    expect(formatGrade(12)).toBe("1.2 %");
    expect(formatGrade(35)).toBe("3.5 %");
    expect(formatHeight(6000)).toBe("+6 m");
    expect(formatHeight(500)).toBe("+0.5 m");
    expect(formatHeight(-2000)).toBe("−2 m");
    expect(formatHeight(40)).toBe("0 m");
  });

  it("splits a message without a fix into a reason only", () => {
    expect(splitReason({ message: "Nothing to undo." })).toEqual({ reason: "Nothing to undo", fix: null });
  });
});
