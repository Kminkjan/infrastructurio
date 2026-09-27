import { describe, expect, it } from "vitest";
import { createSim } from "../sim/api";

const TERRAIN = { seed: "d3-planner", columns: 60, rows: 52 } as const;

/**
 * D3 contract tests: the shape of a plan and that the command carries it. The
 * full planner's drag-case table replaces the stub cases here.
 */
describe("planTrack contract", () => {
  it("plans straights along the drag, counts new and reused by key, and leaves the track unchanged", () => {
    const sim = createSim({ terrain: TERRAIN });
    const drag = { from: { q: 5, r: 5, zMm: 0 }, to: { xMm: 5000 * (9 + 2.5), yMm: 2500 * 1.7320508075688772 * 5 }, dzMm: 0, magnetism: true };
    const plan = sim.planTrack(drag);
    expect(plan.fit).toBe("straight");
    expect(plan.pieces.length).toBe(4);
    expect(plan.counts).toEqual({ new: 4, reused: 0 });
    expect(plan.end).toEqual({ node: { q: 9, r: 5, zMm: 0 }, heading: 0 });
    expect(plan.label).toBe("Straight · 60 km/h · 0.0%");
    expect(sim.network().rev).toBe(0);

    const built = sim.execute({ type: "build-track", pieces: plan.pieces, structure: "auto" });
    expect(built.ok).toBe(true);
    expect(sim.planTrack(drag).counts).toEqual({ new: 0, reused: 4 });
  });

  it("returns an empty plan with a note when the drag is too short", () => {
    const sim = createSim({ terrain: TERRAIN });
    const plan = sim.planTrack({ from: { q: 5, r: 5, zMm: 0 }, to: { xMm: 5000 * 5 + 2500 * 5 + 100, yMm: 2500 * 1.7320508075688772 * 5 }, dzMm: 0, magnetism: true });
    expect(plan.fit).toBe("none");
    expect(plan.pieces).toEqual([]);
    expect(plan.note).not.toBeNull();
  });
});
