import { describe, expect, it } from "vitest";
import { type TrackPlan, createSim } from "../core/sim/api";
import { HINT_LINE, STRAIGHT_HINT_LINE, buildTooltip, formatGrade, formatHeight, formatHeld, formatHeldOffEnd, formatStructures, gradeLevel, heightLimitText, splitReason } from "./format";
import { planPointOfNode } from "./picks";

function plan(overrides: Partial<TrackPlan> = {}): TrackPlan {
  return {
    // The steepest piece sets the grade: 60 mm over a 5 m straight is 12‰.
    pieces: [{ kind: "straight", from: { q: 0, r: 0, zMm: 0 }, heading: 0, z1Mm: 60 }],
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

  it("rounds the grade once, from the pieces, so the metrics line and the precision label agree", () => {
    // One secondary straight (8,660 mm) rising 108 mm: 12.47‰. The plan's maxGradePermille is already
    // rounded to 12.5‰; rounding that again would read 1.3 % beside the label's 1.2%.
    const sim = createSim({ terrain: { seed: "d3-format", columns: 60, rows: 52 } });
    const planned = sim.planTrack({ from: { q: 20, r: 20, zMm: 0 }, fromHeading: 1, to: planPointOfNode(21, 21), dzMm: 108, magnetism: false });
    expect(planned.pieces).toHaveLength(1);
    expect(planned.maxGradePermille).toBe(12.5);
    expect(planned.label).toBe("Straight · 60 km/h · 1.2%");
    const tip = buildTooltip({ plan: planned, endHeightMm: 108, rejection: null, precision: true, anchor: null });
    expect(tip.metrics?.grade).toBe("Grade 1.2 %");
    expect(tip.metrics?.gradeLevel).toBe("green");
    expect(tip.precision).toBe("Precision: Straight · 60 km/h · 1.2% · wheel radius · Q/E end heading");
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

  it("names the structure when a plan is not all ground (D4), and always for a straight line", () => {
    expect(formatStructures("follow", ["ground", "ground"])).toBeNull();
    expect(formatStructures("follow", ["ground", "bridge", "tunnel", "bridge"])).toBe("Structure: 2 bridge, 1 tunnel, 1 ground");
    expect(formatStructures("straight", ["bridge", "bridge"])).toBe("Structure: bridge");
    expect(formatStructures("straight", ["tunnel"])).toBe("Structure: tunnel");
    // A straight line says so even when every piece is ground.
    expect(formatStructures("straight", ["ground"])).toBe("Structure: ground");
    expect(formatStructures("follow", [])).toBeNull();
  });

  it("says where the 3.5 % limit holds a Straight line's end, rounded as the end height is (owner decision 2026-09-28)", () => {
    expect(formatHeld(-11_200)).toBe("End held 11.2 m below the ground by the 3.5 % limit");
    expect(formatHeld(4000)).toBe("End held 4 m above the ground by the 3.5 % limit");
    expect(formatHeld(300, "water")).toBe("End held 0.3 m above the water by the 3.5 % limit");
    expect(formatHeld(40)).toBe("End held at the ground by the 3.5 % limit");
    // The same tenths as the metrics line's end height, halves included: −11.25 m reads −11.2 m in both.
    for (const mm of [-11_250, -11_249, 13_250, 13_249, -50, 50, -51]) {
      const height = formatHeight(mm);
      const held = formatHeld(mm);
      if (height === "0 m") expect(held).toContain("at the ground");
      else expect(held).toContain(` ${height.slice(1)} ${height.startsWith("+") ? "above" : "below"} the ground`);
    }
    expect(heightLimitText(formatHeld(-11_200))).toBe("Height unchanged: end held 11.2 m below the ground by the 3.5 % limit.");
  });

  it("says how far the limit holds a line off the track end it is aimed at (verification fix, 2026-09-29)", () => {
    expect(formatHeldOffEnd(-7670, { q: 30, r: 10 })).toBe("End held 7.7 m below the track end at (30, 10) by the 3.5 % limit");
    expect(formatHeldOffEnd(4000, { q: -2, r: 7 })).toBe("End held 4 m above the track end at (-2, 7) by the 3.5 % limit");
    expect(heightLimitText(formatHeldOffEnd(-7670, { q: 30, r: 10 }))).toBe("Height unchanged: end held 7.7 m below the track end at (30, 10) by the 3.5 % limit.");
  });

  it("puts the held-end line under the metrics, in the tooltip and the announcement", () => {
    const held = formatHeld(-11_200);
    const tip = buildTooltip({ plan: plan(), endHeightMm: -11_200, rejection: null, precision: false, anchor: null, structure: "Structure: 7 tunnel, 9 ground", mode: "straight", held });
    expect(tip.held).toBe(held);
    expect(tip.lines).toEqual([
      "Pieces: 8 new, 2 reused",
      "Structure: 7 tunnel, 9 ground",
      "Length 214 m · Grade 1.2 % · Min radius 180 m · End height −11.2 m",
      held,
      STRAIGHT_HINT_LINE,
    ]);
    // Nothing to hold when nothing fits, and no line without one.
    expect(buildTooltip({ plan: plan({ fit: "none", pieces: [], end: null, note: "Drag farther to lay track" }), endHeightMm: 0, rejection: null, precision: false, anchor: null, held }).held).toBeNull();
    expect(buildTooltip({ plan: plan(), endHeightMm: 0, rejection: null, precision: false, anchor: null }).held).toBeNull();
  });
});
