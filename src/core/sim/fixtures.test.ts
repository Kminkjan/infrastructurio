import { describe, expect, it } from "vitest";
import type { PieceSpec } from "../geometry/piece";
import type { RadiusClassM, Turn } from "../geometry/templates";
import type { Heading } from "../lattice";
import { generateTerrain } from "../terrain";
import { makeDiff } from "../track/authored";
import { type ReasonCode, MAX_PIECES, REASON_CODES } from "../track/validate";
import { type Command, type Result, createSim } from "./api";
import { createWorld } from "./world";

/**
 * One negative fixture per D2 reason code, each minimal enough that no
 * earlier rule fires. All but `undo-blocked` are built through commands on a
 * fresh sim. In D2 every track change goes through history, so sequential
 * undo/redo always restores a state that was valid; that fixture therefore
 * starts from a loaded world whose redo diff no longer fits its track (the
 * path D12 saves take, since loads never re-validate), then triggers it with
 * the `redo` command.
 */

const TERRAIN = { seed: "d2-fixtures", columns: 60, rows: 52 } as const;
const sim = () => createSim({ terrain: TERRAIN });

function straight(q: number, r: number, heading: Heading = 0, zMm = 0, z1Mm = zMm): PieceSpec {
  return { kind: "straight", from: { q, r, zMm }, heading, z1Mm };
}

function curve(q: number, r: number, turn: number, radiusM: number, variant: number): PieceSpec {
  return { kind: "curve", from: { q, r, zMm: 0 }, heading: 0, turn: turn as Turn, radiusM: radiusM as RadiusClassM, variant, z1Mm: 0 };
}

function build(...pieces: PieceSpec[]): Command {
  return { type: "build-track", pieces, structure: "ground" };
}

/** A row of `count` primary straights heading east along row r, from its west edge. */
function row(r: number, count: number): PieceSpec[] {
  const q0 = 0 - Math.floor(r / 2);
  return Array.from({ length: count }, (_, i) => straight(q0 + i, r));
}

function expectOk(result: Result): void {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason.code}: ${result.reason.message}`);
}

const FIXTURES: Record<ReasonCode, () => Result> = {
  // Column 59 is the east edge of a 60-column map: one more step leaves it.
  "out-of-bounds": () => sim().execute(build(straight(59, 0))),
  "limit-reached": () => {
    const s = createSim({ terrain: { seed: "d2-limit", columns: 400, rows: 14 } });
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
    const world = createWorld(generateTerrain(TERRAIN), {
      records: [{ key: "S:11,10,0:1:0", structure: "ground" }],
      history: { undo: [], redo: [makeDiff([{ key: "S:10,10,0:1:0", structure: "ground" }], [])] },
    });
    return world.run({ type: "redo" }, true);
  },
};

describe("negative fixtures, one per D2 reason code", () => {
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
});

describe("fixed rule order", () => {
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
