import { describe, expect, it } from "vitest";
import { flatTerrain, simOn } from "../../../tests/support/simOn";
import type { PieceSpec } from "../geometry/piece";
import type { Heading } from "../lattice";
import { type Command, HISTORY_DEPTH, type Result, createSim } from "./api";

// Flat dry ground at 0 m, so track at z = 0 lies on it (until D4, the seeded map "d2-api", whose ground at
// 10–40 m the D4 terrain rules now judge: track at z = 0 lay under it).
const TERRAIN = flatTerrain(60, 52);
const sim = () => simOn(TERRAIN);

function straight(q: number, r: number, heading: Heading = 0, zMm = 0, z1Mm = zMm): PieceSpec {
  return { kind: "straight", from: { q, r, zMm }, heading, z1Mm };
}

function build(pieces: PieceSpec[], structure: "ground" | "bridge" | "tunnel" | "auto" = "ground"): Command {
  return { type: "build-track", pieces, structure };
}

function ok(result: Result): Extract<Result, { ok: true }> {
  if (!result.ok) throw new Error(`${result.reason.code}: ${result.reason.message}`);
  return result;
}

describe("createSim construction commands", () => {
  it("builds pieces, counts new and reused by key, and bumps the network revision", () => {
    const s = sim();
    expect(s.tick).toBe(0);
    const first = ok(s.execute(build([straight(5, 5), straight(6, 5)])));
    expect(first).toEqual({
      ok: true,
      networkRev: 1,
      diff: { added: [{ key: "S:5,5,0:0:0", structure: "ground" }, { key: "S:6,5,0:0:0", structure: "ground" }], removed: [] },
      counts: { new: 2, reused: 0 },
    });
    const second = ok(s.execute(build([straight(6, 5), straight(7, 5)])));
    expect(second.counts).toEqual({ new: 1, reused: 1 });
    expect(second.networkRev).toBe(2);
    const view = s.network();
    expect(view.rev).toBe(2);
    expect(view.pieces.map((p) => [p.key, p.kind, p.structure, p.lengthMm, p.z0Mm, p.z1Mm, p.speedLimitMms])).toEqual([
      ["S:5,5,0:0:0", "straight", "ground", 5000, 0, 0, 16_666],
      ["S:6,5,0:0:0", "straight", "ground", 5000, 0, 0, 16_666],
      ["S:7,5,0:0:0", "straight", "ground", 5000, 0, 0, 16_666],
    ]);
    expect(view.nodes.map((n) => n.kind)).toEqual(["buffer", "through", "through", "buffer"]);
    expect(view.sections).toHaveLength(1);
    expect(view.pieces[0]?.prims[0]?.kind).toBe("line");
  });

  it("treats an all-reused build as a no-op with no history entry", () => {
    const s = sim();
    ok(s.execute(build([straight(5, 5)])));
    const view = s.network();
    const again = ok(s.execute(build([straight(5, 5)])));
    expect(again).toEqual({ ok: true, networkRev: 1, diff: { added: [], removed: [] }, counts: { new: 0, reused: 1 } });
    expect(s.network()).toBe(view);
    ok(s.execute({ type: "undo" }));
    expect(s.network().pieces).toHaveLength(0);
    expect(s.execute({ type: "undo" })).toMatchObject({ ok: false, reason: { code: "undo-empty" } });
  });

  it("recognises a piece described from its other end as reused", () => {
    const s = sim();
    ok(s.execute(build([{ kind: "curve", from: { q: 10, r: 10, zMm: 0 }, heading: 0, turn: 1, radiusM: 60, variant: 0, z1Mm: 500 }])));
    const key = s.network().pieces[0]?.key ?? "";
    const view = s.network();
    const p = view.pieces[0];
    const endNode = view.nodes[p?.nodes[1] ?? -1];
    if (!endNode) throw new Error("no end node");
    const back = ok(
      s.execute(build([{ kind: "curve", from: { q: endNode.q, r: endNode.r, zMm: 500 }, heading: 7, turn: -1, radiusM: 60, variant: 0, z1Mm: 0 }])),
    );
    expect(back.counts).toEqual({ new: 0, reused: 1 });
    expect(key).toBe("C:10,10,0:0:1:60:0:500");
  });

  it("counts a piece named twice in one command once", () => {
    const r = ok(sim().execute(build([straight(5, 5), straight(5, 5), straight(6, 5, 6)])));
    expect(r.counts).toEqual({ new: 1, reused: 0 });
  });

  it("demolishes by key (from either end) and restores with undo, then redoes", () => {
    const s = sim();
    // A forced bridge on flat ground: its deck is not below the terrain, so it builds.
    ok(s.execute(build([straight(5, 5), straight(6, 5)], "bridge")));
    const gone = ok(s.execute({ type: "demolish", pieces: ["S:7,5,0:6:0"] }));
    expect(gone.diff).toEqual({ added: [], removed: [{ key: "S:6,5,0:0:0", structure: "bridge" }] });
    expect(s.network().pieces.map((p) => p.key)).toEqual(["S:5,5,0:0:0"]);
    const back = ok(s.execute({ type: "undo" }));
    expect(back.diff.added).toEqual([{ key: "S:6,5,0:0:0", structure: "bridge" }]);
    expect(s.network().pieces.map((p) => p.structure)).toEqual(["bridge", "bridge"]);
    ok(s.execute({ type: "redo" }));
    expect(s.network().pieces).toHaveLength(1);
    expect(s.execute({ type: "redo" })).toMatchObject({ ok: false, reason: { code: "redo-empty" } });
  });

  it("clears redo on a new edit", () => {
    const s = sim();
    ok(s.execute(build([straight(5, 5)])));
    ok(s.execute({ type: "undo" }));
    ok(s.execute(build([straight(20, 20)])));
    expect(s.execute({ type: "redo" })).toMatchObject({ ok: false, reason: { code: "redo-empty" } });
  });

  it(`keeps ${HISTORY_DEPTH} undo steps`, () => {
    const s = sim();
    for (let i = 0; i <= HISTORY_DEPTH; i++) ok(s.execute(build([straight(i % 50, 2 * Math.floor(i / 50))])));
    for (let i = 0; i < HISTORY_DEPTH; i++) ok(s.execute({ type: "undo" }));
    expect(s.network().pieces).toHaveLength(1);
    expect(s.execute({ type: "undo" })).toMatchObject({ ok: false, reason: { code: "undo-empty" } });
  });

  it("infers structure auto from the terrain and keeps an existing piece's structure on reuse", () => {
    // Until D4 auto resolved to ground and a forced tunnel on flat ground built; D4 infers the structure and
    // rejects a tunnel that is nowhere deeper than a cutting, so the forced structure here is a bridge.
    const s = sim();
    ok(s.execute(build([straight(5, 5)], "auto")));
    ok(s.execute(build([straight(5, 5), straight(6, 5)], "bridge")));
    expect(s.network().pieces.map((p) => p.structure)).toEqual(["ground", "bridge"]);
    ok(s.execute(build([straight(10, 5, 0, 4500), straight(20, 5, 0, -6000)], "auto")));
    expect(s.network().pieces.map((p) => [p.key, p.structure])).toEqual([
      ["S:10,5,4500:0:4500", "bridge"],
      ["S:20,5,-6000:0:-6000", "tunnel"],
      ["S:5,5,0:0:0", "ground"],
      ["S:6,5,0:0:0", "bridge"],
    ]);
  });

  it("never connects nodes at the same (q, r) but different heights", () => {
    const s = sim();
    ok(s.execute(build([straight(5, 5)])));
    // 7 m over the ground: a bridge (auto) since D4; ground there would need one.
    ok(s.execute(build([straight(6, 5, 0, 7000)], "auto")));
    const view = s.network();
    expect(view.nodes.filter((n) => n.q === 6 && n.r === 5).map((n) => n.zMm)).toEqual([0, 7000]);
    expect(view.nodes.every((n) => n.kind === "buffer")).toBe(true);
    expect(view.sections).toHaveLength(2);
  });

  it("previews exactly what execute would return, without changing anything", () => {
    const s = sim();
    ok(s.execute(build([straight(5, 5)])));
    const view = s.network();
    const cmd = build([straight(6, 5), straight(7, 5)]);
    const preview = s.preview(cmd);
    expect(s.network()).toBe(view);
    expect(s.preview({ type: "undo" })).toMatchObject({ ok: true, networkRev: 2 });
    expect(s.network()).toBe(view);
    expect(s.execute(cmd)).toEqual(preview);
  });

  it("freezes results and caches the network view per revision", () => {
    const s = sim();
    const r = s.execute(build([straight(5, 5)]));
    expect(Object.isFrozen(r) && r.ok && Object.isFrozen(r.diff.added[0])).toBe(true);
    const v1 = s.network();
    expect(s.network()).toBe(v1);
    expect(Object.isFrozen(v1) && Object.isFrozen(v1.pieces[0]) && Object.isFrozen(v1.nodes[0]?.ports.a)).toBe(true);
    s.execute(build([straight(6, 5)]));
    expect(s.network()).not.toBe(v1);
    s.execute({ type: "demolish", pieces: ["S:9,9,0:0:0"] });
    expect(s.network().rev).toBe(2);
  });

  it("treats a malformed command shape as a programmer error, in preview and execute alike", () => {
    const s = createSim({ terrain: { seed: "d2-api", columns: 60, rows: 52 } });
    const bad: [unknown, RegExp][] = [
      [{ type: "spawn-train" }, /unknown command type spawn-train/],
      [{ type: "build-track", pieces: [straight(5, 5)], structure: "viaduct" }, /unknown structure viaduct/],
      [{ type: "build-track", structure: "ground" }, /build-track needs a pieces array/],
      [{ type: "demolish" }, /demolish needs a pieces array/],
      [null, /a command must be an object/],
    ];
    for (const [cmd, message] of bad) {
      expect(() => s.preview(cmd as Command)).toThrow(message);
      expect(() => s.execute(cmd as Command)).toThrow(TypeError);
    }
    expect(s.network().rev).toBe(0);
    expect(s.execute({ type: "undo" })).toMatchObject({ ok: false, reason: { code: "undo-empty" } });
  });

  it("rejects bad command contents with a reason instead of throwing", () => {
    const s = sim();
    const spiral = { kind: "spiral", from: { q: 5, r: 5, zMm: 0 }, heading: 0, z1Mm: 0 } as unknown as PieceSpec;
    expect(s.execute(build([spiral]))).toMatchObject({ ok: false, reason: { code: "no-fit" } });
    expect(s.execute({ type: "demolish", pieces: [42 as unknown as string] })).toMatchObject({ ok: false, reason: { code: "unknown-target" } });
    // Found in review: a height past 2^53 used to commit with an inexact grade.
    expect(s.execute(build([straight(5, 5, 0, 0, Number.MAX_SAFE_INTEGER)]))).toMatchObject({ ok: false, reason: { code: "out-of-bounds" } });
    expect(s.network().pieces).toHaveLength(0);
  });
});
