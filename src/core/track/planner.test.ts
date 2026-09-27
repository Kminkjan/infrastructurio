import { describe, expect, it } from "vitest";
import { forAll, pick, shuffled } from "../../../tests/support/forall";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { randomChain, randomNode } from "../../../tests/support/trackGen";
import { MIN_HEIGHT_SEPARATION_MM } from "../geometry/clearance";
import { type NodeRef, type PieceSpec, resolvePiece } from "../geometry/piece";
import { CURVE_TEMPLATES, type RadiusClassM, SHIFT_SIDES, type ShiftSide, type Turn, RADIUS_CLASSES_M, shiftTemplate } from "../geometry/templates";
import { type Axial, type Heading, HEADINGS, SQRT3, isPrimary, nearestNode, opposite, rotateHeading, stepOf } from "../lattice";
import { createSim } from "../sim/api";
import { type Command, type Result, type World, createWorld } from "../sim/world";
import { DEFAULT_TERRAIN_SIZE, type Terrain, generateTerrain, groundMmAt, isWaterAt, nodeOfOffset, offsetOfNode, terrainBoundsM } from "../terrain";
import { hashCanonical } from "../util/hash";
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
  twoBendFits,
  twoBendOrder,
} from "./planner";

const TERRAIN = { seed: "d3-planner", columns: 60, rows: 52 } as const;

/**
 * D3 contract tests: the shape of a plan and that the command carries it,
 * through the public `Sim`.
 */
describe("planTrack contract", () => {
  it("plans straights along the drag, counts new and reused by key, and leaves the track unchanged", () => {
    const sim = createSim({ terrain: TERRAIN });
    const terrain = generateTerrain(TERRAIN);
    const ground = (q: number, r: number) => groundMmAt(terrain, { q, r }) ?? Number.NaN;
    // Both ends on the ground, as the tool sets them with no height steps.
    const drag = { from: { q: 5, r: 5, zMm: ground(5, 5) }, to: { xMm: 5000 * (9 + 2.5), yMm: 2500 * 1.7320508075688772 * 5 }, dzMm: ground(9, 5) - ground(5, 5), magnetism: true };
    const plan = sim.planTrack(drag);
    expect(plan.fit).toBe("straight");
    expect(plan.pieces.length).toBe(4);
    expect(plan.counts).toEqual({ new: 4, reused: 0 });
    expect(plan.end).toEqual({ node: { q: 9, r: 5, zMm: ground(9, 5) }, heading: 0 });
    // Every node lies on the ground, and the label's grade is the steepest piece's (round half up, in 0.1 %).
    expect(plan.pieces.map((p) => [p.from.zMm, p.z1Mm])).toEqual([5, 6, 7, 8].map((q) => [ground(q, 5), ground(q + 1, 5)]));
    const tenths = Math.round(Math.max(...plan.pieces.map((p) => Math.abs(p.z1Mm - p.from.zMm))) / 5);
    expect(plan.label).toBe(`Straight · 60 km/h · ${Math.floor(tenths / 10)}.${tenths % 10}%`);
    // This small seeded map is steep: 500 mm in one 5 m piece, which D4's 35‰ rule will reject.
    expect(plan.label).toBe("Straight · 60 km/h · 10.0%");
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

/** A level track at 27 m crossing LINE at (108, 60), 7 m above it (clear of it by the 6.5 m rule): two nodes there. */
const OVER = straights(108, 56, 2, 8, 27_000);

/**
 * A sloped run on row 40, q 40–48, as two drags of different grade (+100 mm, then +170 mm per 5 m), so no
 * single largest-remainder split reproduces its inner heights. Buffer ends (40, 40) at 20 m and (48, 40) at 21.08 m.
 */
const SLOPE_Z = [20_000, 20_100, 20_200, 20_300, 20_400, 20_570, 20_740, 20_910, 21_080] as const;
const SLOPE = climbing(40, 40, 0, SLOPE_Z);

/** Existing node heights by lattice position "q,r", from the network view. */
function heightsOf(w: World): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const n of w.network().nodes) {
    const k = `${n.q},${n.r}`;
    out.set(k, [...(out.get(k) ?? []), n.zMm]);
  }
  return out;
}

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
  // Two bends in one drag (owner decision 2026-09-27): only when no single bend reaches the pointer's node.
  {
    // Nothing reaches within 120 m of the line behind the start: the U-turn end nearest the pointer lies level
    // with it (x 200 m, like the pointer), 28 rows (121.2 m) to the left, the side ties go to.
    name: "two-bend free: a pointer 100 m directly behind a fixed heading gives a U-turn toward it (two R 60 bends)",
    drag: { from: node(40, 40), fromHeading: 0, to: at(20, 40), dzMm: 0, magnetism: true },
    fit: "two-bend",
    pieces: [curve(40, 40, 0, 3, 60, 0), curve(45, 54, 3, 3, 60, 0), ...straights(26, 68, 6, 20)],
    end: { node: node(6, 68), heading: 6 },
    label: "R 60 m · 25 km/h · 0.0%",
    lengthMm: 289_740,
  },
  {
    name: "two-bend free: 87 m behind a secondary heading, a U-turn too",
    drag: { from: node(40, 40), fromHeading: 1, to: at(30, 30), dzMm: 0, magnetism: true },
    fit: "two-bend",
    pieces: [curve(40, 40, 1, 3, 60, 0), curve(35, 59, 4, 3, 60, 0), ...straights(16, 64, 7, 10)],
    end: { node: node(6, 54), heading: 7 },
    label: "R 60 m · 25 km/h · 0.0%",
    lengthMm: 276_340,
  },
  {
    // 50 m behind and 150 m to the left: a U-turn reaches the pointer's node itself.
    name: "two-bend free: a U-turn onto the pointer's node, 150 m over (R 60, three straights between the bends)",
    drag: { from: node(40, 40), fromHeading: 0, to: at(40, 40, -50_000, 150_000), dzMm: 0, magnetism: true },
    fit: "two-bend",
    pieces: [curve(40, 40, 0, 3, 60, 0), ...straights(45, 54, 3, 3), curve(42, 60, 3, 3, 60, 0), ...straights(23, 74, 6, 10)],
    end: { node: node(13, 74), heading: 6 },
    label: "R 60 m · 25 km/h · 0.0%",
    lengthMm: 265_720,
  },
  {
    name: "two-bend free: a 120° turn onto the pointer's node (90° + 30°, R 60)",
    drag: { from: node(40, 40), fromHeading: 0, to: at(36, 65), dzMm: 0, magnetism: true },
    fit: "two-bend",
    pieces: [curve(40, 40, 0, 3, 60, 0), curve(45, 54, 3, 1, 60, 0), ...straights(39, 62, 4, 3)],
    end: { node: node(36, 65), heading: 4 },
    label: "R 60 m · 25 km/h · 0.0%",
    lengthMm: 146_453,
  },
  {
    name: "two-bend free: a 150° turn onto the pointer's node (90° + 60°, R 90)",
    drag: { from: node(40, 40), fromHeading: 0, to: at(24, 83), dzMm: 0, magnetism: true },
    fit: "two-bend",
    pieces: [curve(40, 40, 0, 3, 90, 1), curve(47, 62, 3, 2, 90, 1), ...straights(28, 81, 5, 2)],
    end: { node: node(24, 83), heading: 5 },
    label: "R 90 m · 30 km/h · 0.0%",
    lengthMm: 263_975,
  },
  // One bend a node off (owner decision 2026-09-27): before two bends onto the pointer's node.
  {
    // A forward-cone kink (a free start, 25°, 100 m): no single bend reaches the pointer's node (73, 70), two
    // bends do (30° right, then 60° left, R 60); a single bend reaches its neighbour (74, 69), 3.78 m off.
    name: "one bend a node off: where only two bends reach the pointer's node, one bend to a neighbour wins",
    drag: { from: node(60, 60), to: at(60, 60, 90_631, 42_262), dzMm: 0, magnetism: true },
    fit: "one-bend",
    pieces: [...straights(60, 60, 1, 6), curve(66, 66, 1, -1, 90, 0)],
    end: { node: node(74, 69), heading: 0 },
    label: "R 90 m · 30 km/h · 0.0%",
    lengthMm: 101_834,
  },
  {
    // The pointer's node (87, 66) takes two R 60 bends onto heading 2; one reaches its neighbour (86, 67).
    name: "precision: an end heading that one bend reaches only a node off gives that bend, not two onto the node",
    drag: { from: node(60, 60), fromHeading: 0, to: at(60, 60, 147_721, 26_047), dzMm: 0, magnetism: false, precision: { radiusM: 60, endHeading: 2 } },
    fit: "one-bend",
    pieces: [...straights(60, 60, 0, 19), curve(79, 60, 0, 2, 60, 0)],
    end: { node: node(86, 67), heading: 2 },
    label: "R 60 m · 25 km/h · 0.0%",
    lengthMm: 158_550,
  },
  {
    // 30 m ahead, 60 m left: inside the 60 m turning circle, where no fit of one or two bends reaches.
    name: "fallback: a pointer inside the turning circle to the side gets the tightest bend toward it (90°, 30 m off)",
    drag: { from: node(40, 40), fromHeading: 0, to: at(40, 40, 30_000, 60_000), dzMm: 0, magnetism: true },
    fit: "one-bend",
    pieces: [curve(40, 40, 0, 3, 60, 0)],
    end: { node: node(45, 54), heading: 3 },
    label: "R 60 m · 25 km/h · 0.0%",
    lengthMm: 94_870,
  },
  {
    // 3 m ahead, 50 m left: the straights ahead lie nearest but stop short of halfway to the pointer.
    name: "fallback: a pointer abeam inside the turning circle gets a bend toward it, not a stub ahead",
    drag: { from: node(40, 40), fromHeading: 0, to: at(40, 40, 3_000, 50_000), dzMm: 0, magnetism: true },
    fit: "one-bend",
    pieces: [curve(40, 40, 0, 2, 60, 0)],
    end: { node: node(47, 47), heading: 2 },
    label: "R 60 m · 25 km/h · 0.0%",
    lengthMm: 63_550,
  },
  {
    name: "precision: a radius class alone makes both bends of the U-turn that radius (R 90, 180 m over)",
    drag: { from: node(40, 40), fromHeading: 0, to: at(20, 40), dzMm: 0, magnetism: false, precision: { radiusM: 90 } },
    fit: "two-bend",
    pieces: [curve(40, 40, 0, 3, 90, 0), curve(48, 61, 3, 3, 90, 0), ...straights(19, 82, 6, 20)],
    end: { node: node(-1, 82), heading: 6 },
    label: "R 90 m · 30 km/h · 0.0%",
    lengthMm: 389_608,
  },
  {
    // Only a straight or a shift ends on heading 0 in one bend, and neither reaches 30 m to the side.
    name: "precision: an end heading no single bend reaches gives an S-curve onto it (R 120)",
    drag: { from: node(40, 40), fromHeading: 0, to: at(40, 40, 150_000, 30_000), dzMm: 0, magnetism: false, precision: { radiusM: 120, endHeading: 0 } },
    fit: "two-bend",
    pieces: [curve(40, 40, 0, 1, 120, 0), curve(51, 44, 1, -1, 120, 0), ...straights(62, 48, 0, 4)],
    end: { node: node(66, 48), heading: 0 },
    label: "R 120 m · 35 km/h · 0.0%",
    lengthMm: 156_330,
  },
  {
    name: "precision: the end heading opposite the start gives a U-turn onto the pointer's node",
    drag: { from: node(40, 40), fromHeading: 0, to: at(40, 40, -30_000, 150_000), dzMm: 0, magnetism: false, precision: { radiusM: 60, endHeading: 6 } },
    fit: "two-bend",
    pieces: [curve(40, 40, 0, 3, 60, 0), ...straights(45, 54, 3, 3), curve(42, 60, 3, 3, 60, 0), ...straights(23, 74, 6, 6)],
    end: { node: node(17, 74), heading: 6 },
    label: "R 60 m · 25 km/h · 0.0%",
    lengthMm: 245_720,
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
    // Behind a fixed heading a free end always has a U-turn (see the drag cases); a precision end heading of
    // 150° has only fits that end over 112 m to the side, out of the 12-ring search around a pointer behind.
    const behind = w.plan({ from: node(40, 40), fromHeading: 0, to: at(30, 40), dzMm: 0, magnetism: false, precision: { radiusM: 60, endHeading: 5 } });
    expect(behind).toMatchObject({ fit: "none", pieces: [], end: null });
    expect(behind.note).toBe("No R 60 m fit ending at 150° lies near the pointer; drag farther from the start or change the end heading.");
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

describe("planTrack on sloped track: heights pinned to existing nodes", () => {
  it("extends a sloped run: the overlap takes the run's heights and is reused, only the extension is new", () => {
    const w = world(SLOPE);
    const drag: Drag = { from: node(40, 40), fromHeading: 0, to: at(51, 40), dzMm: 1580, magnetism: true };
    const plan = w.plan(drag);
    // Pinned at q 41–48; the last 500 mm spread over the three new pieces: 167, 167, 166.
    expect(plan.pieces).toEqual([...SLOPE, ...climbing(48, 40, 0, [21_080, 21_247, 21_414, 21_580])]);
    expect(plan.counts).toEqual({ new: 3, reused: 8 });
    expect(plan.end).toEqual({ node: node(51, 40, 21_580), heading: 0 });
    expect(expectOk(w.run(build(plan.pieces), true)).counts).toEqual(plan.counts);
    // One split over the whole drag (the old rule) puts (41, 40) at 20,144 mm, not 20,100: every overlapping
    // piece misses its key, and the first one leaves the run's start node beside the existing piece.
    const rises = apportionMm(1580, Array<number>(11).fill(5000));
    const unpinned = climbing(40, 40, 0, rises.reduce((zs, dz) => [...zs, (zs[zs.length - 1] ?? 0) + dz], [Z]));
    expect(unpinned[0]?.z1Mm).toBe(20_144);
    expect(world(SLOPE).run(build(unpinned), false)).toMatchObject({ ok: false, reason: { code: "kinked-join" } });
  });

  it("retraces part of a sloped run from outside it: the approach is new, the overlap reused", () => {
    const w = world(SLOPE);
    // It ends on the run's through node (46, 40) at that node's height, as the tool's vertical magnetism gives it.
    const plan = w.plan({ from: node(36, 40, 19_450), fromHeading: 0, to: at(46, 40), dzMm: 20_740 - 19_450, magnetism: true });
    // 550 mm up to the pin at (40, 40): 137.5 per piece, so 138, 138, 137, 137 (ties to the earlier piece).
    expect(plan.pieces).toEqual(climbing(36, 40, 0, [19_450, 19_588, 19_726, 19_863, ...SLOPE_Z.slice(0, 7)]));
    expect(plan.counts).toEqual({ new: 4, reused: 6 });
    expect(expectOk(w.run(build(plan.pieces), true)).counts).toEqual(plan.counts);
  });

  it("spreads the rise between consecutive pins by largest remainder, by length", () => {
    // Two sloped stubs on row 44 with a five-piece gap: q 40–42 (20.0 → 20.2 m) and q 47–49 (20.903 → 21.103 m).
    const w = world([...climbing(40, 44, 0, [20_000, 20_100, 20_200]), ...climbing(47, 44, 0, [20_903, 21_003, 21_103])]);
    const plan = w.plan({ from: node(40, 44), fromHeading: 0, to: at(52, 44), dzMm: 1404, magnetism: true });
    const rises = plan.pieces.map((p) => p.z1Mm - p.from.zMm);
    expect(rises.slice(0, 2)).toEqual([100, 100]);
    // 703 mm over five 5 m pieces between the pins at q 42 and 47: 140.6 each, so three get 141.
    expect(rises.slice(2, 7)).toEqual(apportionMm(703, Array<number>(5).fill(5000)));
    expect(rises.slice(2, 7)).toEqual([141, 141, 141, 140, 140]);
    expect(rises.slice(7, 9)).toEqual([100, 100]);
    // 301 mm from the last pin to the end: 101, 100, 100.
    expect(rises.slice(9)).toEqual([101, 100, 100]);
    expect(plan.counts).toEqual({ new: 8, reused: 4 });
    expect(expectOk(w.run(build(plan.pieces), true)).counts).toEqual(plan.counts);
  });

  it("passes 6.5 m or more over track without pinning (a grade separation), and pins nearer", () => {
    const w = world(LINE);
    const across = (zMm: number) => w.plan({ from: node(105, 55, zMm), fromHeading: 2, to: at(105, 65), dzMm: 0, magnetism: true });
    // Exactly 6.5 m above the line's node (105, 60): clear of it, so the level plan builds over it.
    const clear = across(26_500);
    expect(clear.pieces).toEqual(straights(105, 55, 2, 10, 26_500));
    expect(expectOk(w.run(build(clear.pieces), false)).counts).toEqual({ new: 10, reused: 0 });
    // 6 m above would clash anyway, so the plan meets the node; a crossing at a node is not buildable yet.
    const low = across(26_000);
    expect(low.pieces[4]?.z1Mm).toBe(20_000);
    expect(low.pieces[5]?.from.zMm).toBe(20_000);
    expect(w.run(build(low.pieces), false)).toMatchObject({ ok: false, reason: { code: "kinked-join" } });
  });

  it("with a bridge over the track at a node, a retrace keeps the track's height there (its piece exists)", () => {
    const w = world([...LINE, ...OVER]);
    // A contrived 8 m climb puts the reference at (108, 60) at 24 m: nearer the bridge (27 m) than the track
    // (20 m) and within 6.5 m of both, so only the existing piece (107, 60) → (108, 60) decides.
    const plan = w.plan({ from: node(100, 60), fromHeading: 0, to: at(109, 60), dzMm: 8000, magnetism: true });
    expect(plan.pieces).toEqual([...straights(100, 60, 0, 8), { kind: "straight", from: node(108, 60), heading: 0, z1Mm: 28_000 }]);
    expect(plan.counts).toEqual({ new: 1, reused: 8 });
  });

  it("where no piece matches, takes the nearest of several heights, ties to the lower", () => {
    const w = world([...LINE, ...OVER]);
    // A level diagonal (heading 1) through (108, 60), where the line (20 m) and the bridge (27 m) both have nodes.
    const heightAt108 = (zMm: number) => w.plan({ from: node(104, 56, zMm), fromHeading: 1, to: at(112, 64), dzMm: 0, magnetism: true }).pieces[3]?.z1Mm;
    expect(heightAt108(24_000)).toBe(27_000);
    expect(heightAt108(23_000)).toBe(20_000);
    expect(heightAt108(23_500)).toBe(20_000);
    // Beyond 6.5 m of both (13.5 m is 6.5 m under the line), the plan keeps its own height.
    expect(heightAt108(13_500)).toBe(13_500);
  });

  it("pins the same heights whatever order the track was built in, and after undo and redo", () => {
    const setup = [...SLOPE, ...LINE, ...OVER];
    const drags: readonly Drag[] = [
      { from: node(40, 40), fromHeading: 0, to: at(51, 40), dzMm: 1580, magnetism: true },
      { from: node(36, 40, 19_450), fromHeading: 0, to: at(46, 40), dzMm: 1290, magnetism: true },
      { from: node(100, 60), fromHeading: 0, to: at(109, 60), dzMm: 8000, magnetism: true },
      { from: node(104, 56, 24_000), fromHeading: 1, to: at(112, 64), dzMm: 0, magnetism: true },
    ];
    const reference = world(setup);
    const expected = drags.map((d) => reference.plan(d));
    expect(drags.map((d) => reference.plan(d))).toEqual(expected);
    forAll(
      { seed: "pin-build-order", runs: 20 },
      (prng) => shuffled(prng, setup),
      (order) => {
        const w = world();
        for (const spec of order) expectOk(w.run(build([spec]), true));
        expect(drags.map((d) => w.plan(d))).toEqual(expected);
      },
    );
    // Undoing the run's last piece unpins (48, 40); redoing it restores the plan.
    const w = world();
    for (const spec of setup) expectOk(w.run(build([spec]), true));
    const last = SLOPE.length - 1;
    for (let i = setup.length - 1; i >= last; i--) expectOk(w.run({ type: "undo" }, true));
    expect(w.plan(drags[0] as Drag).counts).toEqual({ new: 4, reused: 7 });
    for (let i = setup.length - 1; i >= last; i--) expectOk(w.run({ type: "redo" }, true));
    expect(drags.map((d) => w.plan(d))).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Ground following (owner decision 2026-09-27, for D3): each node is the ground plus an offset, and the
// offset, not the absolute height, is split between pins.

/**
 * A north–south ridge on the flat 20 m map: 4 m high at col 100, its flanks rising 0.4 m per 5 m column
 * (80‰) from col 90 and 110. On row 60 (col = q + 30) a heading-0 drag from q 50 to q 90 crosses it.
 */
const HILL = makeTerrain(SIZE.columns, SIZE.rows, (_q, _r, col) => 200 + Math.max(0, 40 - 4 * Math.abs(col - 100)));

function hillGround(q: number, r: number): number {
  return groundMmAt(HILL, { q, r }) ?? Number.NaN;
}

/** The plan's nodes, start first. */
function nodesOfPlan(from: NodeRef, plan: TrackPlan): NodeRef[] {
  return [from, ...plan.pieces.map((p) => endOf([p]).node)];
}

/** Running sums from `start`: [start, start + d0, start + d0 + d1, …]. */
function cumulative(start: number, deltas: readonly number[]): number[] {
  return deltas.reduce((acc, d) => [...acc, (acc[acc.length - 1] ?? 0) + d], [start]);
}

describe("planTrack on the ground: track follows the terrain", () => {
  it("lays a drag over a hill on the ground at every node when both ends are on the ground", () => {
    const w = world([], HILL);
    const from = node(50, 60);
    const plan = w.plan({ from, fromHeading: 0, to: at(90, 60), dzMm: 0, magnetism: true });
    expect(plan.fit).toBe("straight");
    expect(plan.pieces).toHaveLength(40);
    const nodes = nodesOfPlan(from, plan);
    expect(nodes.map((n) => n.zMm)).toEqual(nodes.map((n) => hillGround(n.q, n.r)));
    // The ridge top sits 4 m up; the old split of the (zero) height change kept every node at 20 m, 4 m under it.
    expect(nodes[20]?.zMm).toBe(24_000);
    // The flanks climb 400 mm per 5 m piece: 80‰, over the 35‰ that D4 will enforce. Nothing rejects it in D3.
    expect(plan.maxGradePermille).toBe(80);
    expect(plan.label).toBe("Straight · 60 km/h · 8.0%");
    expect(expectOk(w.run(build(plan.pieces), true)).counts).toEqual({ new: 40, reused: 0 });
  });

  it("ramps the offset above the ground towards a raised end, and down from a raised start", () => {
    const w = world([], HILL);
    const offsets = (from: NodeRef, plan: TrackPlan) => nodesOfPlan(from, plan).map((n) => n.zMm - hillGround(n.q, n.r));
    // Three 1 m steps up at the end: 3000 mm over forty 5 m pieces, 75 mm each, on top of the ridge's shape.
    const up = w.plan({ from: node(50, 60), fromHeading: 0, to: at(90, 60), dzMm: 3000, magnetism: true });
    expect(offsets(node(50, 60), up)).toEqual(cumulative(0, apportionMm(3000, Array<number>(40).fill(5000))));
    expect(up.end?.node.zMm).toBe(23_000);
    expect(up.pieces[19]?.z1Mm).toBe(24_000 + 1500);
    // From track 2 m up back down to the ground: the offset falls by 50 mm a piece; descents mirror climbs.
    const down = w.plan({ from: node(50, 60, 22_000), fromHeading: 0, to: at(90, 60), dzMm: -2000, magnetism: true });
    expect(offsets(node(50, 60, 22_000), down)).toEqual(cumulative(2000, apportionMm(-2000, Array<number>(40).fill(5000))));
    expect(down.end?.node.zMm).toBe(20_000);
  });

  it("still pins existing nodes on hilly ground, ramping the offset between the pins", () => {
    // Level track at 21 m through the ridge's flank and top (q 65–75 = col 95–105, ground 22–24 m).
    const level = straights(65, 60, 0, 10, 21_000);
    const w = world(level, HILL);
    const from = node(50, 60);
    const plan = w.plan({ from, fromHeading: 0, to: at(90, 60), dzMm: 0, magnetism: true });
    // The overlap takes the existing heights and reuses the pieces, although they lie 1–3 m under the ground.
    expect(plan.pieces.slice(15, 25)).toEqual(level);
    expect(plan.counts).toEqual({ new: 30, reused: 10 });
    const offsets = nodesOfPlan(from, plan).map((n) => n.zMm - hillGround(n.q, n.r));
    // Offset 0 at the start to −1000 mm at the pin (col 95: ground 22 m, track 21 m), 15 pieces: 67 × 10, 66 × 5.
    expect(offsets.slice(0, 16)).toEqual(cumulative(0, apportionMm(-1000, Array<number>(15).fill(5000))));
    // From the last pin (col 105, again −1000 mm) back up to the ground at the end.
    expect(offsets.slice(25)).toEqual(cumulative(-1000, apportionMm(1000, Array<number>(15).fill(5000))));
    expect(expectOk(w.run(build(plan.pieces), true)).counts).toEqual(plan.counts);
  });

  it("on hilly ground: plans deterministically, and every node is the ground plus the offset split between pins", () => {
    // Rolling hills of ±6 m around 20 m on the property map, with no water.
    const hills = makeTerrain(PROP_SIZE.columns, PROP_SIZE.rows, (_q, _r, col, row) => 200 + 60 * Math.sin(col / 9) * Math.cos(row / 7), -100);
    const ground = (q: number, r: number) => groundMmAt(hills, { q, r });
    let pinned = 0;
    forAll(
      { seed: "plan-hilly-ground", runs: 150 },
      (prng) => {
        // Chains lifted by the ground at their start, so they lie near the surface and can pin a plan.
        const chains = Array.from({ length: 1 + prng.nextInt(4) }, () => {
          const chain = randomChain(prng, PROP_SIZE, 8);
          const lift = ground(chain[0]?.from.q ?? 0, chain[0]?.from.r ?? 0) ?? Z;
          return chain.map((s) => ({ ...s, from: { ...s.from, zMm: s.from.zMm + lift }, z1Mm: s.z1Mm + lift }));
        });
        const chain = pick(prng, chains);
        const head = chain[0];
        if (!head) throw new Error("empty chain");
        const mode = prng.nextInt(3);
        if (mode === 0 && head.kind === "straight") {
          // Along the chain's leading straights and up to two nodes beyond, any end height nearby.
          let k = 1;
          while (chain[k]?.kind === "straight" && chain[k]?.heading === head.heading) k += 1;
          const s = stepOf(head.heading);
          const e = k + prng.nextInt(3);
          const to = at(head.from.q + s.q * e, head.from.r + s.r * e);
          return { chains, drag: { from: head.from, fromHeading: head.heading, to, dzMm: prng.nextInt(2001) - 1000, magnetism: prng.nextInt(2) === 0 } };
        }
        if (mode === 1) return { chains, drag: randomDrag(prng, pick(prng, chain).from) };
        const start = innerNode(prng);
        const from = node(start.q, start.r, (ground(start.q, start.r) ?? Z) + 1000 * prng.nextInt(3));
        return { chains, drag: randomDrag(prng, from) };
      },
      ({ chains, drag }) => {
        const a = world([], hills);
        const b = world([], hills);
        for (const chain of chains) expect(b.run(build(chain), true)).toEqual(a.run(build(chain), true));
        const plan = a.plan(drag);
        expect(a.plan(drag)).toEqual(plan);
        expect(b.plan(drag)).toEqual(plan);
        if (plan.fit === "none") return;
        const existing = heightsOf(a);
        checkShape(plan, drag, existing, ground);
        if (nodesOfPlan(drag.from, plan).slice(1, -1).some((n) => existing.get(`${n.q},${n.r}`)?.includes(n.zMm))) pinned += 1;
        expect(b.run(build(plan.pieces), true)).toEqual(a.run(build(plan.pieces), false));
      },
    );
    // Guards that the generator reaches pinning on hills (15 of 150 runs when written).
    expect(pinned).toBeGreaterThanOrEqual(5);
  });

  it("on the diorama map, lays random drags with both ends on the ground on the ground at every node (a probe)", async ({ annotate }) => {
    const terrain = generateTerrain({ seed: "baltic-diorama", ...DEFAULT_TERRAIN_SIZE });
    const w = createWorld(terrain);
    const ground = (n: { q: number; r: number }) => {
      const g = groundMmAt(terrain, n);
      if (g === undefined) throw new Error(`(${n.q}, ${n.r}) is off the map`);
      return g;
    };
    let nodes = 0;
    let pieces = 0;
    let steep = 0;
    let curved = 0;
    forAll(
      { seed: "ground-diorama", runs: 400 },
      (prng) => {
        // Starts at least 300 m inside the map; half straight drags of 10–40 steps, half free drags within ±150 m.
        const s = nodeOfOffset(60 + prng.nextInt(280), 80 + prng.nextInt(186));
        const heading = pick(prng, HEADINGS);
        if (prng.nextInt(2) === 0) {
          const k = 10 + prng.nextInt(31);
          const d = stepOf(heading);
          return { s, fromHeading: heading, to: at(s.q + d.q * k, s.r + d.r * k) };
        }
        const p = at(s.q, s.r);
        return { s, fromHeading: prng.nextInt(2) === 0 ? heading : undefined, to: { xMm: p.xMm + prng.nextInt(300_001) - 150_000, yMm: p.yMm + prng.nextInt(300_001) - 150_000 } };
      },
      ({ s, fromHeading, to }) => {
        const from = node(s.q, s.r, ground(s));
        const dragTo = (end: { q: number; r: number }): Drag => ({ from, ...(fromHeading === undefined ? {} : { fromHeading }), to, dzMm: ground(end) - from.zMm, magnetism: true });
        // As the track tool does with no height steps: the end on the ground under the pointer's node, re-planned
        // once with the ground at the plan's actual end when that differs.
        let plan = w.plan(dragTo(nearestNode({ x: to.xMm / 1000, y: to.yMm / 1000 })));
        if (plan.end && plan.end.node.zMm !== ground(plan.end.node)) plan = w.plan(dragTo(plan.end.node));
        if (plan.fit === "none") return;
        const all = nodesOfPlan(from, plan);
        for (const n of all) expect(n.zMm - ground(n)).toBe(0);
        nodes += all.length;
        if (plan.pieces.some((p) => p.kind !== "straight")) curved += 1;
        for (const p of plan.pieces) {
          pieces += 1;
          if (Math.abs(p.z1Mm - p.from.zMm) * 1000 > 35 * lengthOf([p])) steep += 1;
        }
      },
    );
    await annotate(`${nodes} nodes, none below or above the ground; ${curved} plans with curves or shifts; ${((100 * steep) / pieces).toFixed(1)}% of ${pieces} pieces over 35‰`);
    // Guards against a degenerate generator (when written: 6,882 nodes, 137 plans with curves or shifts;
    // 7,486 and 187 since the two-bend fallback, whose U-turns follow the ground like every plan; 7,511 and
    // 186 since one bend a node off beats two bends).
    expect(nodes).toBeGreaterThan(4000);
    expect(curved).toBeGreaterThan(50);
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
  const base: Candidate = { fit: "one-bend", segs: [], bends: 1, radiusMm: 120_000, lengthMm: 100_000, turnSum: 1, turn: 1, sides: 0, lead: 0, endHeading: 1 };
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

  it("orders free two-bend fits larger radius → total turn nearer the arc turn → shorter → |turn| → left → earlier bend", () => {
    const two: Candidate = { ...base, fit: "two-bend", bends: 2, turnSum: 6, turn: 6, sides: 0, endHeading: 6 };
    const other = (patch: Partial<Candidate>): Candidate => ({ ...two, ...patch });
    // With τ = 6 (a pointer behind), a U-turn beats a 150° fit of the same radius even when it is longer.
    const order = twoBendOrder(6);
    const pairs: [string, Candidate][] = [
      ["radius", other({ radiusMm: 90_000, turn: 6, lengthMm: 1 })],
      ["arc turn", other({ turn: 5, turnSum: 5, lengthMm: 1 })],
      ["arc turn, other side", other({ turn: -6, sides: 3, lengthMm: 1 })],
      ["length", other({ lengthMm: 100_001, turnSum: 0, sides: 0 })],
      ["turn", other({ turnSum: 7, sides: 0, lead: 0 })],
      ["sides", other({ sides: 1, lead: 0 })],
      ["lead", other({ lead: 1 })],
    ];
    for (const [key, worse2] of pairs) {
      expect(order(two, worse2), key).toBeLessThan(0);
      expect(order(worse2, two), key).toBeGreaterThan(0);
    }
    // With τ = 4 (a pointer at 60° bearing) the 120° fit wins at equal radius.
    expect(twoBendOrder(4)(other({ turn: 4, turnSum: 4 }), two)).toBeLessThan(0);
    expect(order(two, { ...two })).toBe(0);
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

/**
 * The ground under each node as the planner reads it: `ground` where it is defined, else the last defined
 * value before, else the first after, else the start's height (off-map nodes).
 */
function groundUnder(nodes: readonly NodeRef[], ground: (q: number, r: number) => number | undefined): number[] {
  const known = nodes.map((n) => ground(n.q, n.r));
  let last = known.find((g) => g !== undefined) ?? nodes[0]?.zMm ?? 0;
  return known.map((g) => {
    last = g ?? last;
    return last;
  });
}

/**
 * Structural facts every non-empty plan must satisfy, given the existing node heights by "q,r" and the
 * ground (the flat maps' 20 m by default, where following the ground is the plain split of the height change).
 */
function checkShape(
  plan: TrackPlan,
  drag: Drag,
  existing: ReadonlyMap<string, readonly number[]> = new Map(),
  ground: (q: number, r: number) => number | undefined = () => Z,
): void {
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
  // Heights: each node is the ground plus an offset. The start, the end and every node the plan shares with
  // existing track are pins, and the offset's change between consecutive pins follows the largest-remainder
  // split by length. Every other node keeps 6.5 m or more from the existing heights at its (q, r), measured
  // from the ground plus the offset on the line by length from the last pin to the end.
  const nodes = [drag.from, ...plan.pieces.map((p) => endOf([p]).node)];
  const g = groundUnder(nodes, ground);
  const lengths = plan.pieces.map((p) => lengthOf([p]));
  const cum = lengths.reduce((acc, l) => [...acc, (acc[acc.length - 1] ?? 0) + l], [0]);
  const last = nodes.length - 1;
  const zOf = (i: number) => nodes[i]?.zMm ?? Number.NaN;
  const offsetOf = (i: number) => zOf(i) - (g[i] ?? Number.NaN);
  const steps = plan.pieces.map((_, i) => offsetOf(i + 1) - offsetOf(i));
  const pins = [0];
  for (let i = 1; i < last; i++) {
    const n = nodes[i];
    const heights = n ? (existing.get(`${n.q},${n.r}`) ?? []) : [];
    if (heights.includes(zOf(i))) {
      pins.push(i);
      continue;
    }
    const p = pins[pins.length - 1] ?? 0;
    const span = (cum[last] ?? 0) - (cum[p] ?? 0);
    const ref = ((g[i] ?? 0) + offsetOf(p)) * span + (offsetOf(last) - offsetOf(p)) * ((cum[i] ?? 0) - (cum[p] ?? 0));
    for (const h of heights) expect(Math.abs(h * span - ref)).toBeGreaterThanOrEqual(MIN_HEIGHT_SEPARATION_MM * span);
  }
  pins.push(last);
  for (let k = 1; k < pins.length; k++) {
    const a = pins[k - 1] ?? 0;
    const b = pins[k] ?? 0;
    expect(steps.slice(a, b)).toEqual(apportionMm(offsetOf(b) - offsetOf(a), lengths.slice(a, b)));
  }
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
    // Guards against a degenerate generator only (245 and 195 of 400 when written; 361 and 279 since the
    // two-bend fallback, which turns drags behind a fixed start heading into U-turns): pointers fall
    // anywhere within ±200 m, some precision end headings fit nothing near, and some plans leave the
    // 600 × 450 m map.
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
        checkShape(plan, drag, heightsOf(a));
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
    // Guards that the generator reaches reuse and magnetism (13 and 16 of 150 runs when written; 17 and 16
    // since the two-bend fallback; 16 and 16 since one bend a node off beats two bends).
    expect(reusedSome).toBeGreaterThanOrEqual(5);
    expect(snappedSome).toBeGreaterThanOrEqual(5);
  });

  it("on sloped track: retracing or extending a chain's leading straights reuses them at the chain's heights", () => {
    const terrain = flatTerrain(PROP_SIZE);
    let retraced = 0;
    let extended = 0;
    forAll(
      { seed: "plan-sloped-track", runs: 150 },
      (prng) => {
        // Chains as generated: mostly level with some 100–175 mm steps per piece, some 7 m up.
        const chains = Array.from({ length: 1 + prng.nextInt(6) }, () => randomChain(prng, PROP_SIZE, 8));
        const chain = pick(prng, chains);
        const head = chain[0];
        if (!head) throw new Error("empty chain");
        let k = 0;
        while (chain[k]?.kind === "straight" && chain[k]?.heading === head.heading) k += 1;
        if (k === 0) return { chains, chain, k, drag: randomDrag(prng, pick(prng, chain).from) };
        // Along the leading straights and 0–3 nodes beyond; the end on the chain's height there, plus a climb
        // or descent of up to 175 mm per extra piece.
        const e = prng.nextInt(4);
        const s = stepOf(head.heading);
        const zK = chain[k - 1]?.z1Mm ?? head.from.zMm;
        const dzMm = zK - head.from.zMm + e * (prng.nextInt(351) - 175);
        const to = at(head.from.q + s.q * (k + e), head.from.r + s.r * (k + e));
        return { chains, chain, k, drag: { from: head.from, fromHeading: head.heading, to, dzMm, magnetism: prng.nextInt(2) === 0 } };
      },
      ({ chains, chain, k, drag }) => {
        const a = world([], terrain);
        const b = world([], terrain);
        const built = chains.map((c) => {
          const ra = a.run(build(c), true);
          expect(b.run(build(c), true)).toEqual(ra);
          return ra.ok;
        });
        const plan = a.plan(drag);
        expect(a.plan(drag)).toEqual(plan);
        expect(b.plan(drag)).toEqual(plan);
        if (plan.fit === "none") return;
        checkShape(plan, drag, heightsOf(a));
        const previewed = a.run(build(plan.pieces), false);
        expect(b.run(build(plan.pieces), true)).toEqual(previewed);
        if (previewed.ok) expect(previewed.counts).toEqual(plan.counts);
        // Where the plan runs over the built chain's leading straights (magnetism or validity may pick another
        // shape), it takes their heights, so it reuses them.
        const overlap = plan.pieces.slice(0, k);
        const lead = chain.slice(0, k);
        const sameShape = overlap.length === k && overlap.every((p, i) => p.kind === lead[i]?.kind && p.heading === lead[i]?.heading && p.from.q === lead[i]?.from.q && p.from.r === lead[i]?.from.r);
        if (k === 0 || !built[chains.indexOf(chain)] || !sameShape) return;
        expect(overlap).toEqual(lead);
        expect(plan.counts.reused).toBeGreaterThanOrEqual(k);
        retraced += 1;
        if (plan.pieces.length > k) extended += 1;
      },
    );
    // Guards that the generator reaches the case (65 retraces, 52 of them extending, of 150 runs when written).
    expect(retraced).toBeGreaterThanOrEqual(20);
    expect(extended).toBeGreaterThanOrEqual(10);
  });

  it("follows the pointer in the forward cone (a dev measurement, not a gate)", async ({ annotate }) => {
    // Pointers within ±60° of the start heading (of the drag direction for a free start), 40–200 m
    // out: 25 directions × 17 distances per start mode.
    const w = world();
    for (const fromHeading of [0, 1, undefined] as const) {
      let onNode = 0;
      let twoBend = 0;
      let twoOnNode = 0;
      const offsets: number[] = [];
      for (let deg = -60; deg <= 60; deg += 5) {
        for (let distM = 40; distM <= 200; distM += 10) {
          const to = conePointer(fromHeading, deg, distM);
          const plan = w.plan({ from: node(60, 60), ...(fromHeading === undefined ? {} : { fromHeading }), to, dzMm: 0, magnetism: true });
          if (!plan.end) throw new Error(`no plan at ${deg}°, ${distM} m`);
          const n = nearestNode({ x: to.xMm / 1000, y: to.yMm / 1000 });
          const hit = plan.end.node.q === n.q && plan.end.node.r === n.r;
          if (hit) onNode += 1;
          if (plan.fit === "two-bend") {
            twoBend += 1;
            if (hit) twoOnNode += 1;
          }
          const e = at(plan.end.node.q, plan.end.node.r);
          offsets.push(Math.hypot(e.xMm - to.xMm, e.yMm - to.yMm) / 1000);
        }
      }
      offsets.sort((x, y) => x - y);
      const q = (f: number) => (offsets[Math.min(offsets.length - 1, Math.floor(f * offsets.length))] ?? Number.NaN).toFixed(2);
      await annotate(
        `start heading ${fromHeading ?? "free"}: end on the pointer's node ${((100 * onNode) / offsets.length).toFixed(1)}% of ${offsets.length}; end to pointer median ${q(0.5)} m, p95 ${q(0.95)} m, max ${q(1)} m; ${twoBend} two-bend plans, ${twoOnNode} on the pointer's node`,
      );
      // A plan ends within one node cell (2.887 m) of the pointer at least half the time.
      expect(Number(q(0.5))).toBeLessThanOrEqual(2.887);
      if (fromHeading === undefined) expect(onNode / offsets.length).toBeGreaterThan(0.8);
      // One bend a node off beats two bends onto the node (owner decision 2026-09-27): two bends landed on the
      // pointer's node 12, 2 and 8 times here before (free, 0, 1; the KINKS list). The two-bend plans left in
      // this cone (2 and 4 with a fixed heading) are 120° turns toward a pointer inside the turning circle.
      expect(twoOnNode).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Two bends in one drag (owner decision 2026-09-27): the fallback when no single bend reaches the pointer.

describe("planTrack: two bends in one drag", () => {
  /**
   * 5,760 drags from (60, 60): headings 0, 1, free, and precision R 120 on heading 2, pointers every 5°
   * all around at 10–200 m. Where one bend reaches the pointer's node the plan must be the pre-fallback
   * one, byte for byte: recorded at 211526f (before the fallback) as 2,131 such plans.
   */
  it("keeps every plan that one bend reaches exactly as it was before the fallback (golden hash)", () => {
    const w = world();
    const kept: unknown[] = [];
    let i = 0;
    for (const mode of ["h0", "h1", "free", "precise"] as const) {
      for (let deg = -175; deg <= 180; deg += 5) {
        for (let distM = 10; distM <= 200; distM += 10) {
          const a = (deg * Math.PI) / 180;
          const to = at(60, 60, Math.round(distM * 1000 * Math.cos(a)), Math.round(distM * 1000 * Math.sin(a)));
          const drag: Drag = {
            from: node(60, 60),
            ...(mode === "h0" ? { fromHeading: 0 } : mode === "h1" ? { fromHeading: 1 } : mode === "precise" ? { fromHeading: 2 } : {}),
            to,
            dzMm: 0,
            magnetism: mode !== "precise",
            ...(mode === "precise" ? { precision: { radiusM: 120 } } : {}),
          };
          const plan = w.plan(drag);
          const p = nearestNode({ x: to.xMm / 1000, y: to.yMm / 1000 });
          if (plan.fit !== "two-bend" && plan.end && plan.end.node.q === p.q && plan.end.node.r === p.r) kept.push([i, plan]);
          i += 1;
        }
      }
    }
    expect(i).toBe(5760);
    expect(kept).toHaveLength(2131);
    expect(hashCanonical(kept)).toBe("3e3fbde4");
  });

  it("plans two-bend drags deterministically, whatever order the track was built in", () => {
    // Existing track: the line and the bridge over it, and a stub beside the first case's U-turn (its top fit clashes).
    const setup = [...LINE, ...OVER, ...straights(30, 66, 0, 2)];
    const drags: Drag[] = CASES.filter((c) => c.fit === "two-bend" && !c.setup).map((c) => c.drag);
    for (const h of [0, 1, 5] as const) {
      for (let deg = 95; deg <= 265; deg += 34) {
        const a = ((h * 30 + deg) * Math.PI) / 180;
        drags.push({ from: node(60, 60), fromHeading: h, to: at(60, 60, Math.round(90_000 * Math.cos(a)), Math.round(90_000 * Math.sin(a))), dzMm: 0, magnetism: true });
      }
    }
    const reference = world(setup);
    const expected = drags.map((d) => reference.plan(d));
    expect(drags.map((d) => reference.plan(d))).toEqual(expected);
    expect(expected.filter((p) => p.fit === "two-bend").length).toBeGreaterThanOrEqual(drags.length - 2);
    // The stub makes the 100 m U-turn's top fit invalid; it is still the one shown, for preview to explain.
    expect(reference.run(build(expected[0]?.pieces ?? []), false)).toMatchObject({ ok: false, reason: { code: "tracks-too-close" } });
    forAll(
      { seed: "two-bend-build-order", runs: 10 },
      (prng) => shuffled(prng, setup),
      (order) => {
        const w = world();
        for (const spec of order) expectOk(w.run(build([spec]), true));
        expect(drags.map((d) => w.plan(d))).toEqual(expected);
      },
    );
  });

  it("follows the pointer all around the start (a dev measurement, not a gate)", async ({ annotate }) => {
    // Pointers every 5° all around, 40–200 m out: 72 directions × 17 distances per start mode.
    const w = world();
    for (const fromHeading of [0, 1, undefined] as const) {
      let onNode = 0;
      let twoBend = 0;
      let behind = 0;
      let uTurns = 0;
      const offsets: number[] = [];
      for (let deg = -175; deg <= 180; deg += 5) {
        for (let distM = 40; distM <= 200; distM += 10) {
          const to = conePointer(fromHeading, deg, distM);
          const plan = w.plan({ from: node(60, 60), ...(fromHeading === undefined ? {} : { fromHeading }), to, dzMm: 0, magnetism: true });
          if (!plan.end) throw new Error(`no plan at ${deg}°, ${distM} m`);
          const n = nearestNode({ x: to.xMm / 1000, y: to.yMm / 1000 });
          if (plan.end.node.q === n.q && plan.end.node.r === n.r) onNode += 1;
          if (plan.fit === "two-bend") twoBend += 1;
          const e = at(plan.end.node.q, plan.end.node.r);
          offsets.push(Math.hypot(e.xMm - to.xMm, e.yMm - to.yMm) / 1000);
          if (fromHeading !== undefined && Math.abs(deg) > 90) {
            behind += 1;
            if (plan.end.heading === opposite(fromHeading)) uTurns += 1;
          }
        }
      }
      offsets.sort((x, y) => x - y);
      const q = (f: number) => (offsets[Math.min(offsets.length - 1, Math.floor(f * offsets.length))] ?? Number.NaN).toFixed(2);
      await annotate(
        `start heading ${fromHeading ?? "free"}: end on the pointer's node ${((100 * onNode) / offsets.length).toFixed(1)}% of ${offsets.length}; end to pointer median ${q(0.5)} m, p95 ${q(0.95)} m, max ${q(1)} m; ${twoBend} two-bend plans` +
          (fromHeading === undefined ? "" : `; ${uTurns} of ${behind} pointers behind end on a U-turn`),
      );
      // Every drag gives a plan (no pointer is out of reach any more), and every pointer behind a fixed heading turns back.
      expect(offsets).toHaveLength(72 * 17);
      if (fromHeading !== undefined) expect(uTurns).toBe(behind);
    }
  });
});

// ---------------------------------------------------------------------------
// One bend a node off (owner decision 2026-09-27, "prefer one bend, a node off"): where no single bend reaches
// the pointer's node, a single bend ending on one of its six neighbours beats two bends onto the node.

/** The follow sweeps' pointer from (60, 60): `deg` from the start heading (from heading 0 for a free start), `distM` out. */
function conePointer(fromHeading: Heading | undefined, deg: number, distM: number): PlanPointMm {
  const a = (((fromHeading === 1 ? 30 : 0) + deg) * Math.PI) / 180;
  return at(60, 60, Math.round(distM * 1000 * Math.cos(a)), Math.round(distM * 1000 * Math.sin(a)));
}

/**
 * The 22 drags of the forward-cone sweep that ended with two bends on the pointer's node before this rule
 * (12 free, 2 on heading 0, 8 on heading 1; a probe at c699393): [start heading, bearing °, distance m].
 */
const KINKS: readonly (readonly [Heading | undefined, number, number])[] = [
  [0, -60, 110],
  [0, 60, 110],
  [1, -60, 110],
  [1, -5, 100],
  [1, -5, 110],
  [1, 0, 160],
  [1, 0, 170],
  [1, 5, 100],
  [1, 5, 110],
  [1, 60, 110],
  ...([-35, -30, -25, 25, 30, 35] as const).flatMap((deg) => (Math.abs(deg) === 30 ? [160, 170] : [100, 110]).map((distM) => [undefined, deg, distM] as const)),
];

/** The six neighbours of a node, 5 m away (ring 1). */
function ring1(n: Axial): Axial[] {
  return HEADINGS.filter((h) => isPrimary(h)).map((h) => ({ q: n.q + stepOf(h).q, r: n.r + stepOf(h).r }));
}

const CAP_360 = (radiusM: RadiusClassM): boolean => radiusM <= 360;

/** k with (q, r) = k·s, or undefined. */
function multipleOfStep(q: number, r: number, s: Axial): number | undefined {
  const k = s.q !== 0 ? q / s.q : r / s.r;
  return Number.isInteger(k) && k * s.q === q && k * s.r === r ? k + 0 : undefined;
}

/**
 * Whether one bend from `from` on heading d0 ends exactly on `to`, by enumerating the straights before the
 * bend (up to 80): a run of straights, a shift, or a curve template, with straights before and after. An
 * oracle apart from the planner's 2 × 2 solve.
 */
function singleBendReaches(from: Axial, d0: Heading, to: Axial, allow: (radiusM: RadiusClassM) => boolean, endHeading?: Heading): boolean {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  const s0 = stepOf(d0);
  if (endHeading === undefined || endHeading === d0) {
    if ((multipleOfStep(dq, dr, s0) ?? 0) >= 1) return true;
    for (const side of SHIFT_SIDES) {
      const t = shiftTemplate(d0, side);
      if ((multipleOfStep(dq - t.dq, dr - t.dr, s0) ?? -1) >= 0) return true;
    }
  }
  for (const t of CURVE_TEMPLATES) {
    if (t.heading !== d0 || !allow(t.radiusM) || (endHeading !== undefined && t.endHeading !== endHeading)) continue;
    const s1 = stepOf(t.endHeading);
    for (let n = 0; n <= 80; n++) if ((multipleOfStep(dq - t.dq - n * s0.q, dr - t.dr - n * s0.r, s1) ?? -1) >= 0) return true;
  }
  return false;
}

/** Plan distance from the pointer to a node, mm. */
function offsetMm(to: PlanPointMm, n: Axial): number {
  const e = at(n.q, n.r);
  return Math.hypot(e.xMm - to.xMm, e.yMm - to.yMm);
}

describe("planTrack: one bend a node off before two bends", () => {
  it("ends each forward-cone kink with one bend on the nearest neighbour one bend reaches, not two onto the node", async ({ annotate }) => {
    const w = world();
    const from = node(60, 60);
    const offsets: number[] = [];
    for (const [fromHeading, deg, distM] of KINKS) {
      const name = `start heading ${fromHeading ?? "free"}, ${deg}°, ${distM} m`;
      const to = conePointer(fromHeading, deg, distM);
      const n = nearestNode({ x: to.xMm / 1000, y: to.yMm / 1000 });
      const plan = w.plan({ from, ...(fromHeading === undefined ? {} : { fromHeading }), to, dzMm: 0, magnetism: true });
      const d0 = plan.pieces[0]?.heading;
      if (d0 === undefined || !plan.end) throw new Error(`no plan: ${name}`);
      // The case the rule is for: no single bend reaches the pointer's node, and two bends do (the plan until now).
      expect(singleBendReaches(from, d0, n, CAP_360), name).toBe(false);
      expect(twoBendFits(d0, { q: n.q - from.q, r: n.r - from.r }, undefined, { allowRadius: CAP_360 }).length, name).toBeGreaterThan(0);
      // Now one bend, ending on the neighbour nearest the pointer among those one bend reaches.
      expect(plan.fit, name).not.toBe("two-bend");
      const reached = ring1(n).filter((m) => singleBendReaches(from, d0, m, CAP_360));
      expect(reached, name).toContainEqual({ q: plan.end.node.q, r: plan.end.node.r });
      const nearest = Math.min(...reached.map((m) => offsetMm(to, m)));
      expect(Math.abs(offsetMm(to, plan.end.node) - nearest), name).toBeLessThan(1e-6);
      expect(w.run(build(plan.pieces), false), name).toMatchObject({ ok: true });
      offsets.push(nearest / 1000);
    }
    offsets.sort((x, y) => x - y);
    await annotate(`${KINKS.length} kinks, now one bend each: end to pointer median ${(offsets[Math.floor(offsets.length / 2)] ?? Number.NaN).toFixed(2)} m, max ${(offsets[offsets.length - 1] ?? Number.NaN).toFixed(2)} m`);
    // Ring 1 lies within 7.64 m of any pointer (5 m plus a node cell's corner); these end 3.03–5.63 m off.
    expect(offsets[offsets.length - 1]).toBeLessThan(7640);
    expect(offsets).toHaveLength(22);
  });

  it("keeps two bends on the pointer's node when one bend reaches none of its neighbours", () => {
    const w = world();
    const cases: readonly { name: string; drag: Drag; allow: (radiusM: RadiusClassM) => boolean; endHeading?: Heading }[] = [
      { name: "a 120° turn (a drag-table case)", drag: { from: node(40, 40), fromHeading: 0, to: at(36, 65), dzMm: 0, magnetism: true }, allow: CAP_360 },
      {
        // The drag-table S-curve ends here, a node from its own pointer; this pointer sits on that end node.
        name: "precision R 120 onto heading 0, 30 m to the side (an S-curve)",
        drag: { from: node(40, 40), fromHeading: 0, to: at(66, 48), dzMm: 0, magnetism: false, precision: { radiusM: 120, endHeading: 0 } },
        allow: (r) => r === 120,
        endHeading: 0,
      },
    ];
    for (const c of cases) {
      const n = nearestNode({ x: c.drag.to.xMm / 1000, y: c.drag.to.yMm / 1000 });
      for (const m of [n, ...ring1(n)]) expect(singleBendReaches(c.drag.from, 0, m, c.allow, c.endHeading), `${c.name}: (${m.q}, ${m.r})`).toBe(false);
      const plan = w.plan(c.drag);
      expect(plan.fit, c.name).toBe("two-bend");
      expect(plan.end?.node, c.name).toMatchObject(n);
    }
  });

  it("keeps the nearest reached neighbour when its fits are invalid: validity never moves the end", () => {
    // A piece arriving at the first drag-table kink's end (74, 69) on heading 4 makes every plan ending there a
    // kinked join. Magnetism off, so the drag does not snap to that piece's buffer end.
    const w = world(straights(75, 68, 4, 1));
    const drag: Drag = { from: node(60, 60), to: at(60, 60, 90_631, 42_262), dzMm: 0, magnetism: false };
    const plan = w.plan(drag);
    expect(plan.pieces).toEqual(world().plan(drag).pieces);
    expect(plan.end?.node).toEqual(node(74, 69));
    expect(w.run(build(plan.pieces), false)).toMatchObject({ ok: false, reason: { code: "kinked-join" } });
    // One bend to another neighbour of the pointer's node (73, 70) would be valid: the plan still shows the nearest.
    const other = w.plan({ from: node(60, 60), fromHeading: 1, to: at(74, 70), dzMm: 0, magnetism: false });
    expect(other.fit).toBe("one-bend");
    expect(other.end?.node).toEqual(node(74, 70));
    expect(w.run(build(other.pieces), false)).toMatchObject({ ok: true });
  });

  it("plans node-off drags deterministically, whatever order the track was built in", () => {
    // Existing track: the line and the bridge over it, and a run the heading-1 plans retrace from the start.
    const setup = [...LINE, ...OVER, ...straights(60, 60, 1, 6)];
    const drags: Drag[] = KINKS.map(([fromHeading, deg, distM]) => ({
      from: node(60, 60),
      ...(fromHeading === undefined ? {} : { fromHeading }),
      to: conePointer(fromHeading, deg, distM),
      dzMm: 0,
      magnetism: true,
    }));
    drags.push(...CASES.filter((c) => c.name.includes("a node off")).map((c) => c.drag));
    const reference = world(setup);
    const expected = drags.map((d) => reference.plan(d));
    expect(drags.map((d) => reference.plan(d))).toEqual(expected);
    expect(drags.map((d) => world(setup).plan(d))).toEqual(expected);
    // Guards that the drags still end a node off with one bend and retrace the run (19 and 15 of 24 when
    // written). The run makes the start a buffer end, so free drags leave on heading 1 or 7 there; the two at
    // −35° then lie 65° right of heading 1 and take two bends: at 100 m inside the turning circle (the ring
    // search), at 110 m on the pointer's node, since one bend reaches none of its neighbours.
    const nodeOff = expected.filter((p, i) => {
      const to = drags[i]?.to;
      const n = to && nearestNode({ x: to.xMm / 1000, y: to.yMm / 1000 });
      return n && p.end && p.fit !== "two-bend" && ring1(n).some((m) => m.q === p.end?.node.q && m.r === p.end.node.r);
    });
    const reused = expected.filter((p) => p.counts.reused > 0);
    expect(nodeOff.length).toBeGreaterThan(10);
    expect(reused.length).toBeGreaterThan(5);
    forAll(
      { seed: "node-off-build-order", runs: 10 },
      (prng) => shuffled(prng, setup),
      (order) => {
        const w = world();
        for (const spec of order) expectOk(w.run(build([spec]), true));
        expect(drags.map((d) => w.plan(d))).toEqual(expected);
      },
    );
  });
});
