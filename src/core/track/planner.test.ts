import { describe, expect, it } from "vitest";
import { forAll, pick, shuffled } from "../../../tests/support/forall";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { randomChain, randomNode } from "../../../tests/support/trackGen";
import { type NodeRef, type PieceSpec, resolvePiece } from "../geometry/piece";
import { type RadiusClassM, type ShiftSide, type Turn, RADIUS_CLASSES_M } from "../geometry/templates";
import { type Heading, HEADINGS, SQRT3, nearestNode, opposite, rotateHeading, stepOf } from "../lattice";
import { createSim } from "../sim/api";
import { type Command, type Result, type World, createWorld } from "../sim/world";
import { type Terrain, isWaterAt, nodeOfOffset, offsetOfNode, terrainBoundsM } from "../terrain";
import type { Prng } from "../util/prng";
import {
  type Candidate,
  type Drag,
  MAGNET_RANGE_NODES,
  type PlanFit,
  type PlanPointMm,
  type TrackPlan,
  apportionMm,
  compareCandidates,
} from "./planner";

const TERRAIN = { seed: "d3-planner", columns: 60, rows: 52 } as const;

/**
 * D3 contract tests: the shape of a plan and that the command carries it,
 * through the public `Sim`.
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
    expect(plan.end).toBeNull();
    expect(plan.note).toBe("Drag farther to lay track");
  });

  it("freezes the plan it returns", () => {
    const plan = createSim({ terrain: TERRAIN }).planTrack({ from: { q: 5, r: 5, zMm: 0 }, fromHeading: 0, to: { xMm: 60_000, yMm: 30_000 }, dzMm: 0, magnetism: true });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.pieces)).toBe(true);
    expect(plan.pieces.every((p) => Object.isFrozen(p))).toBe(true);
    expect(Object.isFrozen(plan.end)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The drag-case table. A flat 200 × 174-node map at 20 m with no water, and
// track at 20 m, so D4's terrain rules will see ground-level track.

const Z = 20_000;
const SIZE = { columns: 200, rows: 174 } as const;

function flatTerrain(size: { columns: number; rows: number } = SIZE): Terrain {
  return makeTerrain(size.columns, size.rows, () => 200);
}

function build(pieces: readonly PieceSpec[]): Command {
  return { type: "build-track", pieces, structure: "auto" };
}

function expectOk(result: Result): Extract<Result, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason.code}: ${result.reason.message}`);
  return result;
}

function world(setup: readonly PieceSpec[] = [], terrain = flatTerrain()): World {
  const w = createWorld(terrain);
  if (setup.length > 0) expectOk(w.run(build(setup), true));
  return w;
}

/** The plan position of node (q, r) in mm, plus an offset. */
function at(q: number, r: number, dxMm = 0, dyMm = 0): PlanPointMm {
  return { xMm: 2500 * (2 * q + r) + dxMm, yMm: 2500 * SQRT3 * r + dyMm };
}

function node(q: number, r: number, zMm = Z): NodeRef {
  return { q, r, zMm };
}

function straights(q: number, r: number, heading: Heading, count: number, zMm = Z): PieceSpec[] {
  const s = stepOf(heading);
  return Array.from({ length: count }, (_, i) => ({ kind: "straight", from: node(q + s.q * i, r + s.r * i, zMm), heading, z1Mm: zMm }));
}

function curve(q: number, r: number, heading: Heading, turn: Turn, radiusM: RadiusClassM, variant: number, zMm = Z, z1Mm = zMm): PieceSpec {
  return { kind: "curve", from: node(q, r, zMm), heading, turn, radiusM, variant, z1Mm };
}

function shift(q: number, r: number, heading: Heading, side: ShiftSide, zMm = Z, z1Mm = zMm): PieceSpec {
  return { kind: "shift", from: node(q, r, zMm), heading, side, z1Mm };
}

/** Straights with explicit node heights: heights[i] → heights[i + 1]. */
function climbing(q: number, r: number, heading: Heading, heights: readonly number[]): PieceSpec[] {
  const s = stepOf(heading);
  return heights.slice(0, -1).map((z, i) => ({ kind: "straight", from: node(q + s.q * i, r + s.r * i, z), heading, z1Mm: heights[i + 1] ?? z }));
}

/** An east-running line on row 60, q 100–110: buffer ends (100, 60) (west, arrive heading 0) and (110, 60) (east, arrive heading 6). */
const LINE = straights(100, 60, 0, 10);

interface DragCase {
  readonly name: string;
  readonly setup?: readonly PieceSpec[];
  readonly drag: Drag;
  readonly fit: PlanFit;
  readonly pieces: readonly PieceSpec[];
  readonly end: { readonly node: NodeRef; readonly heading: Heading };
  readonly snapped?: NodeRef;
  readonly label: string;
  readonly lengthMm: number;
}

const CASES: readonly DragCase[] = [
  {
    name: "straight: a collinear pointer needs straights only",
    drag: { from: node(40, 40), to: at(48, 40, 700, 900), dzMm: 0, magnetism: true },
    fit: "straight",
    pieces: straights(40, 40, 0, 8),
    end: { node: node(48, 40), heading: 0 },
    label: "Straight · 60 km/h · 0.0%",
    lengthMm: 40_000,
  },
  {
    name: "straight: a free start takes the heading nearest the drag (secondary, 90°)",
    drag: { from: node(40, 40), to: at(37, 46), dzMm: 0, magnetism: true },
    fit: "straight",
    pieces: straights(40, 40, 3, 3),
    end: { node: node(37, 46), heading: 3 },
    label: "Straight · 60 km/h · 0.0%",
    lengthMm: 25_980,
  },
  {
    // Δ = (15, 8); R 120's offset (11, 4) leaves (4, 4) = 4 secondary steps, R 180's (16, 6) would need n = −3.
    name: "one-bend: 30° left at the largest radius that closes (R 120)",
    drag: { from: node(40, 40), fromHeading: 0, to: at(55, 48), dzMm: 0, magnetism: true },
    fit: "one-bend",
    pieces: [curve(40, 40, 0, 1, 120, 0), ...straights(51, 44, 1, 4)],
    end: { node: node(55, 48), heading: 1 },
    label: "R 120 m · 35 km/h · 0.0%",
    lengthMm: 102_805,
  },
  {
    name: "one-bend: a free start leaves on the nearest heading (30° for a 20° drag) and bends right onto the node",
    drag: { from: node(40, 40), to: at(40, 40, 94_000, 34_200), dzMm: 0, magnetism: true },
    fit: "one-bend",
    pieces: [...straights(40, 40, 1, 4), curve(44, 44, 1, -1, 120, 0)],
    end: { node: node(55, 48), heading: 0 },
    label: "R 120 m · 35 km/h · 0.0%",
    lengthMm: 102_805,
  },
  {
    name: "one-bend: the radius cap (90 m) gives the largest radius under it",
    drag: { from: node(40, 40), fromHeading: 0, to: at(55, 48), dzMm: 0, magnetism: true, radiusCapM: 90 },
    fit: "one-bend",
    pieces: [...straights(40, 40, 0, 2), curve(42, 40, 0, 1, 90, 0), ...straights(50, 43, 1, 5)],
    end: { node: node(55, 48), heading: 1 },
    label: "R 90 m · 30 km/h · 0.0%",
    lengthMm: 103_174,
  },
  {
    // The same node closes as 60° at R 60 in 148.55 m and 90° at R 60 in 171.34 m (checked below).
    name: "one-bend: the larger radius beats a shorter fit (90° at R 90, 158.46 m)",
    drag: { from: node(40, 40), fromHeading: 0, to: at(40, 40, 100_000, 100_000), dzMm: 0, magnetism: true },
    fit: "one-bend",
    pieces: [...straights(40, 40, 0, 1), curve(41, 40, 0, 3, 90, 0), ...straights(49, 61, 3, 1)],
    end: { node: node(48, 63), heading: 3 },
    label: "R 90 m · 30 km/h · 0.0%",
    lengthMm: 158_464,
  },
  {
    // The alternative, 2 straights + 90° at R 60, is 104.87 m (checked below).
    name: "one-bend: at equal radius the shorter fit wins (60° at R 60, 98.55 m)",
    drag: { from: node(40, 40), fromHeading: 0, to: at(47, 54), dzMm: 0, magnetism: true },
    fit: "one-bend",
    pieces: [curve(40, 40, 0, 2, 60, 0), ...straights(47, 47, 2, 7)],
    end: { node: node(47, 54), heading: 2 },
    label: "R 60 m · 25 km/h · 0.0%",
    lengthMm: 98_550,
  },
  {
    name: "shift: one row left on a primary heading, the shift placed first",
    drag: { from: node(40, 40), fromHeading: 0, to: at(52, 41), dzMm: 0, magnetism: true },
    fit: "shift",
    pieces: [shift(40, 40, 0, "left"), ...straights(47, 41, 0, 5)],
    end: { node: node(52, 41), heading: 0 },
    label: "Shift · 30 km/h · 0.0%",
    lengthMm: 62_832,
  },
  {
    name: "shift: 5 m right on a secondary heading",
    drag: { from: node(40, 40), fromHeading: 1, to: at(48, 46), dzMm: 0, magnetism: true },
    fit: "shift",
    pieces: [shift(40, 40, 1, "right"), ...straights(46, 44, 1, 2)],
    end: { node: node(48, 46), heading: 1 },
    label: "Shift · 30 km/h · 0.0%",
    lengthMm: 61_005,
  },
  {
    name: "precision: an explicit radius class (R 60) replaces the largest one (R 120)",
    drag: { from: node(40, 40), fromHeading: 0, to: at(55, 48), dzMm: 0, magnetism: false, precision: { radiusM: 60 } },
    fit: "one-bend",
    pieces: [...straights(40, 40, 0, 3), curve(43, 40, 0, 1, 60, 0), ...straights(49, 42, 1, 6)],
    end: { node: node(55, 48), heading: 1 },
    label: "R 60 m · 25 km/h · 0.0%",
    lengthMm: 103_543,
  },
  {
    name: "precision: an explicit end heading (60°) where the default turns 30°",
    drag: { from: node(40, 40), fromHeading: 0, to: at(55, 48), dzMm: 0, magnetism: false, precision: { radiusM: 60, endHeading: 2 } },
    fit: "one-bend",
    pieces: [...straights(40, 40, 0, 8), curve(48, 40, 0, 2, 60, 0), ...straights(55, 47, 2, 1)],
    end: { node: node(55, 48), heading: 2 },
    label: "R 60 m · 25 km/h · 0.0%",
    lengthMm: 108_550,
  },
  {
    name: "precision: a pointer on a port joins it (heading fixed) without snapping",
    setup: LINE,
    drag: { from: node(70, 40), fromHeading: 1, to: at(100, 60), dzMm: 0, magnetism: false, precision: { radiusM: 180 } },
    fit: "one-bend",
    pieces: [...straights(70, 40, 1, 14), curve(84, 54, 1, -1, 180, 0)],
    end: { node: node(100, 60), heading: 0 },
    label: "R 180 m · 45 km/h · 0.0%",
    lengthMm: 220_988,
  },
  {
    // 1,000 / 7 = 142.86: floors of 142, and the 6 leftover mm go to the earliest of the equal remainders.
    name: "elevation: +1,000 mm over seven straights, largest remainder",
    drag: { from: node(40, 40), fromHeading: 0, to: at(47, 40), dzMm: 1000, magnetism: true },
    fit: "straight",
    pieces: climbing(40, 40, 0, [20_000, 20_143, 20_286, 20_429, 20_572, 20_715, 20_858, 21_000]),
    end: { node: node(47, 40, 21_000), heading: 0 },
    label: "Straight · 60 km/h · 2.9%",
    lengthMm: 35_000,
  },
  {
    name: "elevation: −1,000 mm mirrors the climb",
    drag: { from: node(40, 40), fromHeading: 0, to: at(47, 40), dzMm: -1000, magnetism: true },
    fit: "straight",
    pieces: climbing(40, 40, 0, [20_000, 19_857, 19_714, 19_571, 19_428, 19_285, 19_142, 19_000]),
    end: { node: node(47, 40, 19_000), heading: 0 },
    label: "Straight · 60 km/h · 2.9%",
    lengthMm: 35_000,
  },
  {
    // Shares of 1,500 over 5,000 + 5,000 + 5,000 + 127,100 mm: floors 52, 52, 52, 1,341; the 3 leftover mm go to
    // the straights (remainder 110,800 each) before the curve (93,900).
    name: "elevation: pieces share the rise by length (3 × 5 m + a 127.1 m curve, +1,500 mm)",
    drag: { from: node(40, 40), fromHeading: 0, to: at(40, 40, 120_000, 60_000), dzMm: 1500, magnetism: false, precision: { radiusM: 120, endHeading: 2 } },
    fit: "one-bend",
    pieces: [...climbing(40, 40, 0, [20_000, 20_053, 20_106, 20_159]), curve(43, 40, 0, 2, 120, 0, 20_159, 21_500)],
    end: { node: node(57, 54, 21_500), heading: 2 },
    label: "R 120 m · 35 km/h · 1.1%",
    lengthMm: 142_100,
  },
  {
    name: "two-bend: an S into a port 12 rows over (two R 180 bends, bends first)",
    setup: LINE,
    drag: { from: node(40, 72), fromHeading: 0, to: at(100, 60, 1000, 800), dzMm: 0, magnetism: true },
    fit: "two-bend",
    pieces: [curve(40, 72, 0, -1, 180, 0), curve(62, 66, 11, 1, 180, 0), ...straights(84, 60, 0, 16)],
    end: { node: node(100, 60), heading: 0 },
    snapped: node(100, 60),
    label: "R 180 m · 45 km/h · 0.0%",
    lengthMm: 279_496,
  },
  {
    // A 173.2 m lateral offset rules out R 90 + R 90 (at least 180 m).
    name: "two-bend: a U-turn into the far port (R 90, then R 60)",
    setup: LINE,
    drag: { from: node(80, 100), fromHeading: 0, to: at(110, 60), dzMm: 0, magnetism: true },
    fit: "two-bend",
    pieces: [...straights(80, 100, 0, 4), curve(84, 100, 0, -3, 90, 1), ...straights(113, 78, 9, 2), curve(115, 74, 9, -3, 60, 0)],
    end: { node: node(110, 60), heading: 6 },
    snapped: node(110, 60),
    label: "R 60 m · 25 km/h · 0.0%",
    lengthMm: 278_824,
  },
  {
    name: "two-bend: two shifts to the same side into a port two rows over",
    setup: LINE,
    drag: { from: node(70, 58), fromHeading: 0, to: at(100, 60), dzMm: 0, magnetism: true },
    fit: "two-bend",
    pieces: [shift(70, 58, 0, "left"), shift(77, 59, 0, "left"), ...straights(84, 60, 0, 16)],
    end: { node: node(100, 60), heading: 0 },
    snapped: node(100, 60),
    label: "Shift · 30 km/h · 0.0%",
    lengthMm: 155_664,
  },
  {
    name: "magnetism: a pointer 2 nodes from a port snaps and arrives with the port's heading",
    setup: LINE,
    drag: { from: node(70, 40), fromHeading: 1, to: at(98, 62), dzMm: 0, magnetism: true },
    fit: "one-bend",
    pieces: [...straights(70, 40, 1, 14), curve(84, 54, 1, -1, 180, 0)],
    end: { node: node(100, 60), heading: 0 },
    snapped: node(100, 60),
    label: "R 180 m · 45 km/h · 0.0%",
    lengthMm: 220_988,
  },
  {
    name: "magnetism off: the same pointer ends on its own node, unjoined",
    setup: LINE,
    drag: { from: node(70, 40), fromHeading: 1, to: at(98, 62), dzMm: 0, magnetism: false },
    fit: "one-bend",
    pieces: [...straights(70, 40, 1, 19), curve(89, 59, 1, -1, 90, 0), ...straights(97, 62, 0, 1)],
    end: { node: node(98, 62), heading: 0 },
    label: "R 90 m · 30 km/h · 0.0%",
    lengthMm: 219_414,
  },
  {
    name: `magnetism: a port ${MAGNET_RANGE_NODES + 1} nodes from the pointer is out of reach`,
    setup: LINE,
    drag: { from: node(70, 40), fromHeading: 1, to: at(96, 64), dzMm: 0, magnetism: true },
    fit: "shift",
    pieces: [shift(70, 40, 1, "right"), ...straights(76, 44, 1, 20)],
    end: { node: node(96, 64), heading: 1 },
    label: "Shift · 30 km/h · 0.0%",
    lengthMm: 216_885,
  },
  {
    // 2,000 mm over 14 × 8,660 + 99,748 mm: the curve's remainder is largest (+1 → 903), then the first five straights (79).
    name: "elevation: joining a port takes the port's height (18 m → 20 m)",
    setup: LINE,
    drag: { from: node(70, 40, 18_000), fromHeading: 1, to: at(98, 62), dzMm: 0, magnetism: true },
    fit: "one-bend",
    pieces: [
      ...climbing(70, 40, 1, [
        18_000, 18_079, 18_158, 18_237, 18_316, 18_395, 18_473, 18_551, 18_629, 18_707, 18_785, 18_863, 18_941, 19_019, 19_097,
      ]),
      curve(84, 54, 1, -1, 180, 0, 19_097, 20_000),
    ],
    end: { node: node(100, 60), heading: 0 },
    snapped: node(100, 60),
    label: "R 180 m · 45 km/h · 0.9%",
    lengthMm: 220_988,
  },
  {
    // The shift-first placement passes 2.2 m from the obstacle on row 41; shift-last keeps 4.33 m.
    name: "valid first: an obstacle beside the shift-first placement gives the shift-last one",
    setup: straights(43, 41, 0, 1),
    drag: { from: node(40, 40), fromHeading: 0, to: at(52, 41), dzMm: 0, magnetism: true },
    fit: "shift",
    pieces: [...straights(40, 40, 0, 5), shift(45, 40, 0, "left")],
    end: { node: node(52, 41), heading: 0 },
    label: "Shift · 30 km/h · 0.0%",
    lengthMm: 62_832,
  },
];

describe("planTrack drag cases", () => {
  it.each(CASES)("$name", (c) => {
    const w = world(c.setup);
    const rev = w.network().rev;
    const plan = w.plan(c.drag);
    expect(plan.pieces).toEqual(c.pieces);
    expect(plan.fit).toBe(c.fit);
    expect(plan.end).toEqual(c.end);
    expect(plan.snapped).toEqual(c.snapped ?? null);
    expect(plan.label).toBe(c.label);
    expect(plan.lengthMm).toBe(c.lengthMm);
    expect(plan.note).toBeNull();
    expect(plan.counts).toEqual({ new: c.pieces.length, reused: 0 });
    expect(w.network().rev).toBe(rev);
    // The command carries the resolved pieces, and the sim takes them.
    const result = expectOk(w.run(build(plan.pieces), true));
    expect(result.counts).toEqual(plan.counts);
  });

  it("checks the alternatives the selection-order cases rank below the chosen plan", () => {
    const w = world();
    // 90° at R 90 (158.46 m) is longer than 60° at R 60 through the same node, yet wins on radius.
    const shorter = [...straights(40, 40, 0, 1), curve(41, 40, 0, 2, 60, 0), ...straights(48, 47, 2, 16)];
    expect(w.run(build(shorter), false)).toMatchObject({ ok: true });
    expect(endOf(shorter)).toEqual({ node: node(48, 63), heading: 2 });
    expect(lengthOf(shorter)).toBe(148_550);
    // At equal radius (60 m), 2 straights + 90° (104.87 m) reach (47, 54) too, but 60° is shorter.
    const longer = [...straights(40, 40, 0, 2), curve(42, 40, 0, 3, 60, 0)];
    expect(w.run(build(longer), false)).toMatchObject({ ok: true });
    expect(endOf(longer).node).toEqual(node(47, 54));
    expect(lengthOf(longer)).toBe(104_870);
    // Without the obstacle, the shift goes first.
    expect(w.plan({ from: node(40, 40), fromHeading: 0, to: at(52, 41), dzMm: 0, magnetism: true }).pieces[0]).toEqual(shift(40, 40, 0, "left"));
  });

  it("makes an all-reused plan a no-op: nothing changes and no history entry is recorded", () => {
    const w = world();
    const drag: Drag = { from: node(40, 40), fromHeading: 0, to: at(55, 48), dzMm: 0, magnetism: true };
    const first = w.plan(drag);
    expectOk(w.run(build(first.pieces), true));
    const view = w.network();
    const again = w.plan(drag);
    expect(again.pieces).toEqual(first.pieces);
    expect(again.counts).toEqual({ new: 0, reused: first.pieces.length });
    expect(w.run(build(again.pieces), true)).toEqual({ ok: true, networkRev: 1, diff: { added: [], removed: [] }, counts: again.counts });
    expect(w.network()).toBe(view);
    // One undo removes the first build: the no-op left no entry of its own.
    expectOk(w.run({ type: "undo" }, true));
    expect(w.network().pieces).toHaveLength(0);
    expect(w.run({ type: "undo" }, true)).toMatchObject({ ok: false, reason: { code: "undo-empty" } });
  });

  it("counts a partly reused plan by key lookup", () => {
    const w = world(straights(40, 40, 0, 3));
    const plan = w.plan({ from: node(40, 40), fromHeading: 0, to: at(48, 40), dzMm: 0, magnetism: true });
    expect(plan.counts).toEqual({ new: 5, reused: 3 });
    expect(expectOk(w.run(build(plan.pieces), true)).counts).toEqual(plan.counts);
  });

  it("starts on a buffer end without a heading by continuing the track, or by running back over it", () => {
    const w = world(LINE);
    const onward = w.plan({ from: node(110, 60), to: at(130, 64), dzMm: 0, magnetism: true });
    expect(onward.pieces[0]).toEqual(straights(110, 60, 0, 1)[0]);
    expect(onward.counts.reused).toBe(0);
    expect(w.run(build(onward.pieces), false)).toMatchObject({ ok: true });
    const back = w.plan({ from: node(110, 60), to: at(104, 60), dzMm: 0, magnetism: true });
    expect(back.pieces).toEqual(straights(110, 60, 6, 6));
    expect(back.counts).toEqual({ new: 0, reused: 6 });
  });

  it("never snaps to the start node, and skips a port that no fit reaches", () => {
    const w = world(LINE);
    // From the west buffer end, a pointer beside it: the start's own port is not a target.
    const own = w.plan({ from: node(100, 60), fromHeading: 6, to: at(98, 60), dzMm: 0, magnetism: true });
    expect(own.snapped).toBeNull();
    expect(own.pieces).toEqual(straights(100, 60, 6, 2));
    // An S-bend 12 rows over needs at least 32 q-steps and only 30 remain from (70, 72), so the port is
    // skipped: the free plan ends on the port's node with its own heading, and preview says why.
    const skipped = w.plan({ from: node(70, 72), fromHeading: 0, to: at(100, 60), dzMm: 0, magnetism: true });
    expect(skipped.snapped).toBeNull();
    expect(skipped.end).toEqual({ node: node(100, 60), heading: 11 });
    expect(w.run(build(skipped.pieces), false)).toMatchObject({ ok: false, reason: { code: "kinked-join" } });
  });

  it("returns empty plans with a note for drags nothing fits", () => {
    const w = world();
    const short = w.plan({ from: node(40, 40), to: at(40, 40, 1000, 500), dzMm: 0, magnetism: true });
    expect(short).toMatchObject({ fit: "none", pieces: [], end: null, note: "Drag farther to lay track" });
    const behind = w.plan({ from: node(40, 40), fromHeading: 0, to: at(20, 40), dzMm: 0, magnetism: true });
    expect(behind.fit).toBe("none");
    expect(behind.note).toMatch(/one bend turns at most 90°/);
    const precise = w.plan({ from: node(40, 40), fromHeading: 0, to: at(46, 42), dzMm: 0, magnetism: false, precision: { radiusM: 360, endHeading: 3 } });
    expect(precise.fit).toBe("none");
    expect(precise.note).toBe("No R 360 m fit ending at 90° lies near the pointer; drag farther from the start or change the end heading.");
    expect(precise.label).toBe("Straight · 60 km/h · 0.0%");
  });

  it("treats a malformed drag as a programmer error", () => {
    const w = world();
    const good: Drag = { from: node(40, 40), to: at(48, 40), dzMm: 0, magnetism: true };
    const bad = (patch: Record<string, unknown>) => () => w.plan({ ...good, ...patch } as unknown as Drag);
    expect(bad({ from: { q: 1.5, r: 0, zMm: 0 } })).toThrow(TypeError);
    expect(bad({ fromHeading: 12 })).toThrow(TypeError);
    expect(bad({ to: { xMm: Number.NaN, yMm: 0 } })).toThrow(TypeError);
    expect(bad({ dzMm: 0.5 })).toThrow(TypeError);
    expect(bad({ radiusCapM: 100 })).toThrow(TypeError);
    expect(bad({ precision: { radiusM: 50 } })).toThrow(TypeError);
    expect(bad({ precision: { radiusM: 60, endHeading: -1 } })).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------

function endOf(pieces: readonly PieceSpec[]): { node: NodeRef; heading: Heading } {
  const last = pieces[pieces.length - 1];
  if (!last) throw new Error("no pieces");
  const res = resolvePiece(last);
  if (!res.ok) throw new Error(res.failure.message);
  const [a, b] = res.piece.ends;
  const far = a.node.q === last.from.q && a.node.r === last.from.r && a.node.zMm === last.from.zMm ? b : a;
  return { node: far.node, heading: opposite(far.outward) };
}

function lengthOf(pieces: readonly PieceSpec[]): number {
  return pieces.reduce((sum, p) => {
    const res = resolvePiece(p);
    if (!res.ok) throw new Error(res.failure.message);
    return sum + res.piece.lengthMm;
  }, 0);
}

describe("candidate ranking", () => {
  const base: Candidate = { fit: "one-bend", segs: [], bends: 1, radiusMm: 120_000, lengthMm: 100_000, turnSum: 1, sides: 0, lead: 0, endHeading: 1 };
  const worse = (patch: Partial<Candidate>): Candidate => ({ ...base, ...patch });

  it("orders fewer bends → larger radius → shorter → smaller |turn| → left → earlier bend", () => {
    // Each pair differs from `base` in one key and loses on it, whatever the later keys say.
    const pairs: [string, Candidate][] = [
      ["bends", worse({ bends: 2, radiusMm: 360_000, lengthMm: 1 })],
      ["radius", worse({ radiusMm: 90_000, lengthMm: 1, turnSum: 0 })],
      ["length", worse({ lengthMm: 100_001, turnSum: 0, sides: 0 })],
      ["turn", worse({ turnSum: 2, sides: 0, lead: 0 })],
      ["sides", worse({ sides: 1, lead: 0 })],
      ["lead", worse({ lead: 1 })],
    ];
    for (const [key, other] of pairs) {
      expect(compareCandidates(base, other), key).toBeLessThan(0);
      expect(compareCandidates(other, base), key).toBeGreaterThan(0);
    }
    expect(compareCandidates(base, { ...base })).toBe(0);
  });

  it("gives the same order for any input order", () => {
    const list: Candidate[] = [
      base,
      worse({ bends: 0, radiusMm: Number.MAX_SAFE_INTEGER }),
      worse({ radiusMm: 60_000 }),
      worse({ lengthMm: 90_000 }),
      worse({ turnSum: 3 }),
      worse({ sides: 1 }),
      worse({ lead: 4 }),
      worse({ bends: 2 }),
    ];
    const reference = [...list].sort(compareCandidates);
    forAll(
      { seed: "ranking-order", runs: 20 },
      (prng) => shuffled(prng, list),
      (order) => expect([...order].sort(compareCandidates)).toEqual(reference),
    );
  });
});

describe("elevation apportioning", () => {
  it("splits by largest remainder, ties to the earlier piece, and mirrors descents", () => {
    expect(apportionMm(1000, Array(7).fill(5000))).toEqual([143, 143, 143, 143, 143, 143, 142]);
    expect(apportionMm(-1000, Array(7).fill(5000))).toEqual([-143, -143, -143, -143, -143, -143, -142]);
    expect(apportionMm(1500, [5000, 5000, 5000, 127_100])).toEqual([53, 53, 53, 1341]);
    expect(apportionMm(7, [1, 1, 1])).toEqual([3, 2, 2]);
    expect(apportionMm(0, [5000, 8660])).toEqual([0, 0]);
    expect(() => apportionMm(10, [])).toThrow(RangeError);
  });

  it("sums to the total and keeps every share within 1 mm of its exact quota", () => {
    forAll(
      { seed: "apportion", runs: 300 },
      (prng) => ({
        total: prng.nextInt(40_001) - 20_000,
        weights: Array.from({ length: 1 + prng.nextInt(40) }, () => pick(prng, [5000, 8660, 36_583, 37_832, 43_685, 127_100, 565_487])),
      }),
      ({ total, weights }) => {
        const shares = apportionMm(total, weights);
        const sum = weights.reduce((a, b) => a + b, 0);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
        shares.forEach((s, i) => expect(Math.abs(s * sum - total * (weights[i] ?? 0))).toBeLessThan(sum));
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Properties over random drags

const PROP_SIZE = { columns: 120, rows: 104 } as const;

function randomDrag(prng: Prng, from: NodeRef): Drag {
  const p = at(from.q, from.r);
  const to = { xMm: p.xMm + prng.nextInt(400_001) - 200_000, yMm: p.yMm + prng.nextInt(400_001) - 200_000 };
  const fromHeading = prng.nextInt(3) === 0 ? undefined : pick(prng, HEADINGS);
  const radiusCapM = prng.nextInt(3) === 0 ? pick(prng, RADIUS_CLASSES_M) : undefined;
  const endHeading = prng.nextInt(2) === 0 ? pick(prng, HEADINGS) : undefined;
  const precision = prng.nextInt(4) === 0 ? { radiusM: pick(prng, RADIUS_CLASSES_M), ...(endHeading === undefined ? {} : { endHeading }) } : undefined;
  return {
    from,
    ...(fromHeading === undefined ? {} : { fromHeading }),
    to,
    dzMm: prng.nextInt(351) - 175,
    magnetism: prng.nextInt(4) !== 0,
    ...(radiusCapM === undefined ? {} : { radiusCapM }),
    ...(precision === undefined ? {} : { precision }),
  };
}

/** A random node at least 20 nodes (100 m) inside the property map. */
function innerNode(prng: Prng): NodeRef {
  const n = nodeOfOffset(20 + prng.nextInt(PROP_SIZE.columns - 40), 20 + prng.nextInt(PROP_SIZE.rows - 40));
  return node(n.q, n.r);
}

/** Every piece resolves, both ends sit on dry map nodes and its drawn centreline stays inside the map. */
function staysOnLand(terrain: Terrain, pieces: readonly PieceSpec[]): boolean {
  const m = terrainBoundsM(terrain);
  return pieces.every((spec) => {
    const res = resolvePiece(spec);
    if (!res.ok) return false;
    const { ends, boundsM: b } = res.piece;
    const dry = ends.every((e) => offsetOfNode(terrain, e.node) !== undefined && !isWaterAt(terrain, e.node));
    return dry && b.minX >= m.minX - 1e-6 && b.maxX <= m.maxX + 1e-6 && b.minY >= m.minY - 1e-6 && b.maxY <= m.maxY + 1e-6;
  });
}

/** Structural facts every non-empty plan must satisfy. */
function checkShape(plan: TrackPlan, drag: Drag): void {
  const first = plan.pieces[0];
  expect(first?.from).toEqual(drag.from);
  let at = drag.from;
  let length = 0;
  for (const spec of plan.pieces) {
    expect(spec.from).toEqual(at);
    const res = resolvePiece(spec);
    if (!res.ok) throw new Error(res.failure.message);
    length += res.piece.lengthMm;
    at = endOf([spec]).node;
  }
  // The plan ends where its last piece ends, leaving with the last piece's heading.
  expect(plan.end).toEqual(endOf(plan.pieces));
  expect(plan.lengthMm).toBe(length);
  const endZ = plan.snapped ? plan.snapped.zMm : drag.from.zMm + drag.dzMm;
  expect(plan.end?.node.zMm).toBe(endZ);
  // Heights follow the largest-remainder split of the rise over the piece lengths.
  const lengths = plan.pieces.map((p) => lengthOf([p]));
  expect(plan.pieces.map((p) => p.z1Mm - p.from.zMm)).toEqual(apportionMm(endZ - drag.from.zMm, lengths));
  expect(plan.label).toMatch(/^(Straight|Shift|R (60|90|120|180|240|360) m) · \d+ km\/h · \d+\.\d%$/);
  if (plan.snapped) expect(plan.end?.node).toEqual(plan.snapped);
  if (drag.precision) {
    expect(plan.snapped).toBeNull();
    for (const p of plan.pieces) if (p.kind === "curve") expect(p.radiusM).toBe(drag.precision.radiusM);
  } else {
    const cap = drag.radiusCapM ?? 360;
    for (const p of plan.pieces) if (p.kind === "curve") expect(p.radiusM).toBeLessThanOrEqual(cap);
  }
}

describe("planner properties", () => {
  it("plans deterministically; every non-empty plan on empty track executes, unless it leaves the land", () => {
    const terrain = flatTerrain(PROP_SIZE);
    let nonEmpty = 0;
    let executed = 0;
    forAll(
      { seed: "plan-empty-track", runs: 400 },
      (prng) => randomDrag(prng, innerNode(prng)),
      (drag) => {
        const w = world([], terrain);
        const plan = w.plan(drag);
        expect(w.plan(drag)).toEqual(plan);
        expect(world([], terrain).plan(drag)).toEqual(plan);
        if (plan.fit === "none") {
          expect(plan.pieces).toEqual([]);
          expect(plan.note).not.toBeNull();
          return;
        }
        nonEmpty += 1;
        checkShape(plan, drag);
        const previewed = w.run(build(plan.pieces), false);
        const result = w.run(build(plan.pieces), true);
        expect(previewed).toEqual(result);
        if (staysOnLand(terrain, plan.pieces)) {
          expectOk(result);
          expect(result.ok && result.counts).toEqual(plan.counts);
          executed += 1;
        } else {
          expect(result).toMatchObject({ ok: false, reason: { code: "out-of-bounds" } });
        }
      },
    );
    // Guards against a degenerate generator only (245 and 195 of 400 when written): pointers fall
    // anywhere within ±200 m, so drags behind a fixed start heading are empty, and some plans leave
    // the 600 × 450 m map.
    expect(nonEmpty).toBeGreaterThan(200);
    expect(executed).toBeGreaterThan(150);
  });

  it("on existing track: plans deterministically, preview equals execute, counts match, and all-reused plans are no-ops", () => {
    const terrain = flatTerrain(PROP_SIZE);
    let reusedSome = 0;
    let snappedSome = 0;
    forAll(
      { seed: "plan-existing-track", runs: 150 },
      (prng) => {
        // Level chains (all at Z), so a retrace reuses their keys.
        const chains = Array.from({ length: 1 + prng.nextInt(6) }, () =>
          randomChain(prng, PROP_SIZE, 8).map((s) => ({ ...s, from: { ...s.from, zMm: Z }, z1Mm: Z })),
        );
        const chain = pick(prng, chains);
        const head = chain[0];
        const last = chain[chain.length - 1];
        if (!head || !last) throw new Error("empty chain");
        const mode = prng.nextInt(4);
        if (mode === 0 && head.kind === "straight") {
          // Retrace the chain's leading straights, sometimes a little beyond them.
          let k = 1;
          while (chain[k]?.kind === "straight" && chain[k]?.heading === head.heading) k += 1;
          const s = stepOf(head.heading);
          const e = k + prng.nextInt(3);
          return { chains, drag: { from: head.from, fromHeading: head.heading, to: at(head.from.q + s.q * e, head.from.r + s.r * e), dzMm: 0, magnetism: prng.nextInt(2) === 0 } };
        }
        if (mode === 1) {
          // Come back towards the chain's open end from in front of it, pointer within a node of it.
          const end = endOf([last]);
          const ahead = stepOf(end.heading);
          const side = stepOf(rotateHeading(end.heading, 2));
          const m = 15 + prng.nextInt(30);
          const j = prng.nextInt(21) - 10;
          const from = node(end.node.q + ahead.q * m + side.q * j, end.node.r + ahead.r * m + side.r * j);
          const to = at(end.node.q + prng.nextInt(3) - 1, end.node.r + prng.nextInt(3) - 1);
          return { chains, drag: { from, fromHeading: opposite(end.heading), to, dzMm: 0, magnetism: true } };
        }
        // Otherwise start on an existing node (a buffer end or a through node) or a free one.
        const start = mode === 2 ? pick(prng, chain).from : randomNode(prng, PROP_SIZE, Z);
        return { chains, drag: randomDrag(prng, start) };
      },
      ({ chains, drag }) => {
        const a = world([], terrain);
        const b = world([], terrain);
        for (const chain of chains) {
          const ra = a.run(build(chain), true);
          expect(b.run(build(chain), true)).toEqual(ra);
        }
        const plan = a.plan(drag);
        expect(a.plan(drag)).toEqual(plan);
        expect(b.plan(drag)).toEqual(plan);
        if (plan.fit === "none") return;
        checkShape(plan, drag);
        if (plan.counts.reused > 0) reusedSome += 1;
        if (plan.snapped) snappedSome += 1;
        const view = a.network();
        const previewed = a.run(build(plan.pieces), false);
        expect(a.network()).toBe(view);
        const executed = b.run(build(plan.pieces), true);
        expect(previewed).toEqual(executed);
        if (executed.ok) {
          expect(executed.counts).toEqual(plan.counts);
          if (plan.counts.new === 0) {
            expect(executed.diff).toEqual({ added: [], removed: [] });
            expect(executed.networkRev).toBe(view.rev);
          }
        }
      },
    );
    // Guards that the generator reaches reuse and magnetism (13 and 16 of 150 runs when written).
    expect(reusedSome).toBeGreaterThanOrEqual(5);
    expect(snappedSome).toBeGreaterThanOrEqual(5);
  });

  it("follows the pointer in the forward cone (a dev measurement, not a gate)", async ({ annotate }) => {
    // Pointers within ±60° of the start heading (of the drag direction for a free start), 40–200 m
    // out: 25 directions × 17 distances per start mode.
    const w = world();
    for (const fromHeading of [0, 1, undefined] as const) {
      let onNode = 0;
      const offsets: number[] = [];
      for (let deg = -60; deg <= 60; deg += 5) {
        for (let distM = 40; distM <= 200; distM += 10) {
          const a = (((fromHeading === 1 ? 30 : 0) + deg) * Math.PI) / 180;
          const to = at(60, 60, Math.round(distM * 1000 * Math.cos(a)), Math.round(distM * 1000 * Math.sin(a)));
          const plan = w.plan({ from: node(60, 60), ...(fromHeading === undefined ? {} : { fromHeading }), to, dzMm: 0, magnetism: true });
          if (!plan.end) throw new Error(`no plan at ${deg}°, ${distM} m`);
          const n = nearestNode({ x: to.xMm / 1000, y: to.yMm / 1000 });
          if (plan.end.node.q === n.q && plan.end.node.r === n.r) onNode += 1;
          const e = at(plan.end.node.q, plan.end.node.r);
          offsets.push(Math.hypot(e.xMm - to.xMm, e.yMm - to.yMm) / 1000);
        }
      }
      offsets.sort((x, y) => x - y);
      const q = (f: number) => (offsets[Math.min(offsets.length - 1, Math.floor(f * offsets.length))] ?? Number.NaN).toFixed(2);
      await annotate(
        `start heading ${fromHeading ?? "free"}: end on the pointer's node ${((100 * onNode) / offsets.length).toFixed(1)}% of ${offsets.length}; end to pointer median ${q(0.5)} m, p95 ${q(0.95)} m, max ${q(1)} m`,
      );
      // A plan ends within one node cell (2.887 m) of the pointer at least half the time.
      expect(Number(q(0.5))).toBeLessThanOrEqual(2.887);
      if (fromHeading === undefined) expect(onNode / offsets.length).toBeGreaterThan(0.8);
    }
  });
});
