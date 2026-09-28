import { describe, expect, it } from "vitest";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { flatTerrain, simOn } from "../../../tests/support/simOn";
import type { PieceSpec, Structure } from "../geometry/piece";
import type { RadiusClassM, Turn } from "../geometry/templates";
import type { Heading } from "../lattice";
import { makeDiff } from "../track/authored";
import { type ReasonCode, MAX_PIECES, REASON_CODES } from "../track/validate";
import type { Command, Result } from "./api";
import { createWorld } from "./world";

/**
 * One negative fixture per reason code, each minimal enough that no earlier
 * rule fires. All but `undo-blocked` are built through commands on a fresh
 * sim. In D2 every track change goes through history, so sequential
 * undo/redo always restores a state that was valid; that fixture therefore
 * starts from a loaded world whose redo diff no longer fits its track (the
 * path D12 saves take, since loads never re-validate), then triggers it with
 * the `redo` command.
 *
 * Since D4 the terrain decides structures and rejections, so the fixtures run
 * on a hand-made 60 × 52 map (it was the seeded map "d2-fixtures" until D4,
 * where track at z = 0 lay 10–40 m under the ground): flat dry land at 0 m
 * (the water level at −2 m) where the D2 fixtures stand, rows 0–30; a
 * flat-topped hill 5 m high (rows 36–51, columns 2–28) and a lake with its bed
 * at −6 m (rows 36–51, columns 34–58) for the D4 fixtures.
 */

const COLUMNS = 60;
const ROWS = 52;
const WATER_DM = -20;
const TERRAIN = makeTerrain(
  COLUMNS,
  ROWS,
  (_q, _r, col, row) => (row >= 36 && col >= 2 && col <= 28 ? 50 : row >= 36 && col >= 34 && col <= 58 ? -60 : 0),
  WATER_DM,
);
const sim = () => simOn(TERRAIN);

function straight(q: number, r: number, heading: Heading = 0, zMm = 0, z1Mm = zMm): PieceSpec {
  return { kind: "straight", from: { q, r, zMm }, heading, z1Mm };
}

function curve(q: number, r: number, turn: number, radiusM: number, variant: number): PieceSpec {
  return { kind: "curve", from: { q, r, zMm: 0 }, heading: 0, turn: turn as Turn, radiusM: radiusM as RadiusClassM, variant, z1Mm: 0 };
}

function build(...pieces: PieceSpec[]): Command {
  return { type: "build-track", pieces, structure: "ground" };
}

function buildAs(structure: Structure | "auto", ...pieces: PieceSpec[]): Command {
  return { type: "build-track", pieces, structure };
}

/** `count` level straights heading east along row r from q. */
function run(q: number, r: number, count: number, zMm = 0): PieceSpec[] {
  return Array.from({ length: count }, (_, i) => straight(q + i, r, 0, zMm));
}

/** A row of `count` primary straights heading east along row r, from its west edge. */
function row(r: number, count: number): PieceSpec[] {
  const q0 = 0 - Math.floor(r / 2);
  return Array.from({ length: count }, (_, i) => straight(q0 + i, r));
}

function expectOk(result: Result): void {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason.code}: ${result.reason.message}`);
}

/** Row 44 runs through the hill (q −20…6) and the lake (q 12…36): col = q + 22. */
const HILL_ROW = 44;

const FIXTURES: Record<ReasonCode, () => Result> = {
  // Column 59 is the east edge of a 60-column map: one more step leaves it.
  "out-of-bounds": () => sim().execute(build(straight(59, 0))),
  "limit-reached": () => {
    const s = simOn(flatTerrain(400, 14));
    let built = 0;
    for (let r = 0; built < MAX_PIECES; r++) {
      const count = Math.min(399, MAX_PIECES - built);
      expectOk(s.execute(build(...row(r, count))));
      built += count;
    }
    expect(s.network().pieces).toHaveLength(MAX_PIECES);
    return s.execute(build(straight(0, 13)));
  },
  "unknown-target": () => sim().execute({ type: "demolish", pieces: ["S:3,3,0:0:0"] }),
  "radius-too-tight": () => sim().execute(build(curve(10, 10, 1, 50, 0))),
  "turn-too-sharp": () => sim().execute(build(curve(10, 10, 4, 60, 0))),
  "no-fit": () => sim().execute(build(curve(10, 10, 1, 60, 1))),
  "kinked-join": () => {
    const s = sim();
    expectOk(s.execute(build(straight(10, 10))));
    return s.execute(build(straight(11, 10, 2)));
  },
  // Parallel secondary lines are only 2.5 m apart.
  "tracks-too-close": () => {
    const s = sim();
    expectOk(s.execute(build(straight(10, 10, 1))));
    return s.execute(build(straight(11, 10, 1)));
  },
  "undo-empty": () => sim().execute({ type: "undo" }),
  "redo-empty": () => sim().execute({ type: "redo" }),
  "undo-blocked": () => {
    const world = createWorld(TERRAIN, {
      records: [{ key: "S:11,10,0:1:0", structure: "ground" }],
      history: { undo: [], redo: [makeDiff([{ key: "S:10,10,0:1:0", structure: "ground" }], [])] },
    });
    return world.run({ type: "redo" }, true);
  },
  // 176 mm over a 5 m straight is 35.2‰; 175 mm (35‰ exactly) builds.
  "grade-too-steep": () => sim().execute(build(straight(10, 10, 0, 0, 176))),
  "needs-bridge": () => sim().execute(build(straight(10, 10, 0, 4500))),
  "needs-tunnel": () => sim().execute(build(straight(10, 10, 0, -4500))),
  "bridge-below-ground": () => sim().execute(buildAs("bridge", straight(10, 10, 0, -500))),
  // Over the lake (water level −2 m): a deck at 1.999 m is 1 mm under the water level + 4.0 m. Auto infers the bridge.
  "bridge-too-low-over-water": () => sim().execute(buildAs("auto", ...run(20, HILL_ROW, 4, 1999))),
  // Under the 5 m hill at ground level: 5 m of cover everywhere, more than 10 m from any portal. Auto infers the tunnel.
  "tunnel-too-shallow": () => sim().execute(buildAs("auto", ...run(-12, HILL_ROW, 6))),
  // A bridge 6 m over a level line, crossing it at node (8, 20): 0.5 m short of 6.5 m.
  "vertical-clearance": () => {
    const s = sim();
    expectOk(s.execute(build(...run(5, 20, 6))));
    return s.execute(buildAs("auto", ...Array.from({ length: 6 }, (_, i) => straight(8, 17 + i, 2, 6000))));
  },
};

describe("negative fixtures, one per reason code", () => {
  it.each(REASON_CODES.map((c) => [c]))("rejects with %s and a message that suggests a fix", (code) => {
    const result = FIXTURES[code]();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.code).toBe(code);
    // Convention: "<what is wrong>; <how to fix it>."
    expect(result.reason.message).toMatch(/^[A-Z0-9].*; [a-z].*\.$/);
    expect(Object.isFrozen(result) && Object.isFrozen(result.reason)).toBe(true);
  });

  it("covers every listed code, and every fixture returns a listed code", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...REASON_CODES].sort());
    for (const make of Object.values(FIXTURES)) {
      const r = make();
      expect(!r.ok && (REASON_CODES as readonly string[]).includes(r.reason.code)).toBe(true);
    }
  });

  it("names the pieces involved in refs and highlights", () => {
    const close = FIXTURES["tracks-too-close"]();
    expect(!close.ok && close.highlight).toEqual(["S:11,10,0:1:0", "S:10,10,0:1:0"]);
    const kink = FIXTURES["kinked-join"]();
    expect(!kink.ok && kink.reason.refs[0]).toEqual({ kind: "node", node: { q: 11, r: 10, zMm: 0 } });
    expect(!kink.ok && kink.reason.message).toContain("60° kink");
    const blocked = FIXTURES["undo-blocked"]();
    expect(!blocked.ok && blocked.reason.cause?.code).toBe("tracks-too-close");
  });

  it("names the D4 pieces and quotes the numbers that fix them", () => {
    const steep = FIXTURES["grade-too-steep"]();
    expect(!steep.ok && steep.reason.refs).toEqual([{ kind: "spec", index: 0 }, { kind: "piece", key: "S:10,10,0:0:176" }]);
    expect(!steep.ok && steep.highlight).toEqual(["S:10,10,0:0:176"]);
    expect(!steep.ok && steep.reason.message).toBe(
      "Piece 1 climbs 0.2 m over 5 m (3.52 %), steeper than the 3.5 % maximum; it needs 5.1 m to climb 0.2 m, so lengthen the drag or change the end height.",
    );
    const high = FIXTURES["needs-bridge"]();
    expect(!high.ok && high.reason.message).toContain("runs 4.5 m above the terrain, more than the 4 m an embankment takes");
    const water = FIXTURES["bridge-too-low-over-water"]();
    expect(!water.ok && water.reason.message).toContain("raise the deck by 0.1 m");
    const shallow = FIXTURES["tunnel-too-shallow"]();
    expect(!shallow.ok && shallow.reason.message).toContain("5 m of cover with no portal within 10 m");
    const cross = FIXTURES["vertical-clearance"]();
    expect(!cross.ok && cross.reason.message).toContain("cross with 6 m of height between them, but need 6.5 m; raise or lower one by 0.5 m");
    expect(!cross.ok && cross.highlight).toEqual(["S:8,19,6000:2:6000", "S:7,20,0:0:0"]);
  });
});

describe("D4 positive cases beside each negative fixture", () => {
  it("builds 35‰ exactly, 4 m of fill or cutting as ground, and the matching structures", () => {
    expect(sim().execute(build(straight(10, 10, 0, 0, 175))).ok).toBe(true);
    expect(sim().execute(build(straight(10, 10, 0, 4000))).ok).toBe(true);
    expect(sim().execute(build(straight(10, 10, 0, -4000))).ok).toBe(true);
    // Auto: more than 4 m up is a bridge, more than 4 m down with 6 m of cover a tunnel.
    const up = sim();
    expectOk(up.execute(buildAs("auto", straight(10, 10, 0, 4001))));
    expect(up.network().pieces.map((p) => p.structure)).toEqual(["bridge"]);
    const down = sim();
    expectOk(down.execute(buildAs("auto", straight(10, 10, 0, -6000))));
    expect(down.network().pieces.map((p) => p.structure)).toEqual(["tunnel"]);
    // Over the lake at the water level + 4.0 m exactly.
    const water = sim();
    expectOk(water.execute(buildAs("auto", ...run(20, HILL_ROW, 4, 2000))));
    expect(water.network().pieces.every((p) => p.structure === "bridge")).toBe(true);
    // Under the hill with 6 m of cover: 1 m under the ground.
    const tunnel = sim();
    expectOk(tunnel.execute(buildAs("auto", ...run(-12, HILL_ROW, 6, -1000))));
    expect(tunnel.network().pieces.every((p) => p.structure === "tunnel")).toBe(true);
  });

  it("passes a grade-separated crossing at 6.5 m, and never joins the two tracks in the network", () => {
    const s = sim();
    expectOk(s.execute(build(...run(5, 20, 6))));
    expectOk(s.execute(buildAs("auto", ...Array.from({ length: 6 }, (_, i) => straight(8, 17 + i, 2, 6500)))));
    const view = s.network();
    expect(view.pieces.filter((p) => p.structure === "bridge")).toHaveLength(6);
    // Two nodes at (8, 20), one per height, each plain through track: no shared node, no junction.
    expect(view.nodes.filter((n) => n.q === 8 && n.r === 20).map((n) => [n.zMm, n.kind])).toEqual([
      [0, "through"],
      [6500, "through"],
    ]);
    expect(view.nodes.every((n) => n.kind === "through" || n.kind === "buffer")).toBe(true);
    expect(view.sections).toHaveLength(2);
  });

  it("checks vertical clearance between stacked pieces, not only crossings", () => {
    const s = sim();
    expectOk(s.execute(build(...run(5, 20, 6))));
    // Directly above the line, along it: 6 m up clashes as vertical clearance, 6.5 m clears.
    const stacked = s.preview(buildAs("auto", ...run(6, 20, 3, 6000)));
    expect(!stacked.ok && stacked.reason.code).toBe("vertical-clearance");
    expect(s.preview(buildAs("auto", ...run(6, 20, 3, 6500))).ok).toBe(true);
  });
});

describe("fixed rule order", () => {
  it("reports geometry before grade, grade before terrain and structure, and those before topology", () => {
    const s = sim();
    expectOk(s.execute(build(straight(10, 10))));
    // 5 m up, climbing 400 mm in 5 m: too steep and in need of a bridge. Geometry wins when a bad curve joins it.
    const steepAndHigh = straight(20, 10, 0, 5000, 5400);
    const geometryFirst = s.preview(build(steepAndHigh, curve(30, 5, 1, 50, 0)));
    expect(!geometryFirst.ok && geometryFirst.reason.code).toBe("radius-too-tight");
    const gradeFirst = s.preview(build(steepAndHigh));
    expect(!gradeFirst.ok && gradeFirst.reason.code).toBe("grade-too-steep");
    // A kink at (11, 10) beside a piece that needs a bridge: the structure rule reports first.
    const structureFirst = s.preview(build(straight(11, 10, 2), straight(30, 10, 0, 5000)));
    expect(!structureFirst.ok && structureFirst.reason.code).toBe("needs-bridge");
  });

  it("reports structural before geometry", () => {
    const r = sim().execute(build(curve(10, 10, 1, 50, 0), straight(59, 0)));
    expect(!r.ok && r.reason.code).toBe("out-of-bounds");
  });

  it("reports geometry codes in catalogue order whatever the piece order", () => {
    const r = sim().execute(build(curve(10, 10, 1, 60, 1), curve(20, 20, 4, 60, 0), curve(30, 30, 1, 50, 0)));
    expect(!r.ok && r.reason.code).toBe("radius-too-tight");
    expect(!r.ok && r.reason.refs).toEqual([{ kind: "spec", index: 2 }]);
  });

  it("reports geometry before node topology, and topology before clearance", () => {
    const s = sim();
    expectOk(s.execute(build(straight(10, 10), straight(30, 30, 1))));
    const geometryFirst = s.preview(build(straight(11, 10, 2), curve(40, 5, 1, 50, 0)));
    expect(!geometryFirst.ok && geometryFirst.reason.code).toBe("radius-too-tight");
    // The first piece is too close to (30, 30); the second kinks at (11, 10).
    const topologyFirst = s.preview(build(straight(31, 30, 1), straight(11, 10, 2)));
    expect(!topologyFirst.ok && topologyFirst.reason.code).toBe("kinked-join");
  });

  it("rejects a second piece on the same side of a node until turnouts exist", () => {
    const s = sim();
    expectOk(s.execute(build(straight(10, 10))));
    const r = s.execute(build({ kind: "curve", from: { q: 10, r: 10, zMm: 0 }, heading: 0, turn: 1, radiusM: 60, variant: 0, z1Mm: 0 }));
    expect(!r.ok && r.reason.code).toBe("kinked-join");
    expect(!r.ok && r.reason.message).toContain("same direction");
  });
});
