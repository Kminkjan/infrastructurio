import { describe, expect, it } from "vitest";
import { forAll, shuffled } from "../../../tests/support/forall";
import { type PieceSpec, resolvePiece } from "../geometry/piece";
import { type AuthoredState, applyDiff, authoredRecords, emptyAuthored, makeDiff, recordOf } from "../track/authored";
import { hashCanonical } from "../util/hash";
import { derive } from "./derive";

function stateOf(specs: readonly PieceSpec[]): AuthoredState {
  const records = specs.map((s) => {
    const res = resolvePiece(s);
    if (!res.ok) throw new Error(res.failure.message);
    return recordOf(res.piece);
  });
  return applyDiff(emptyAuthored(), makeDiff(records, []));
}

const straight = (q: number, r: number, zMm = 0): PieceSpec => ({ kind: "straight", from: { q, r, zMm }, heading: 0, z1Mm: zMm });

/** Six 60° curves close a hexagonal loop by the lattice's 60° symmetry. */
function hexagon(): PieceSpec[] {
  const out: PieceSpec[] = [];
  let from = { q: 20, r: 0, zMm: 0 };
  for (let k = 0; k < 6; k++) {
    const spec: PieceSpec = { kind: "curve", from, heading: (2 * k) as 0, turn: 2, radiusM: 60, variant: 0, z1Mm: 0 };
    out.push(spec);
    const res = resolvePiece(spec);
    if (!res.ok) throw new Error(res.failure.message);
    const far = res.piece.ends.find((e) => !(e.node.q === from.q && e.node.r === from.r));
    if (!far) throw new Error("no far end");
    from = far.node;
  }
  return out;
}

describe("derived network", () => {
  it("turns a chain into through and buffer nodes and one section in travel order", () => {
    const net = derive(stateOf([straight(2, 0), straight(0, 0), straight(1, 0)]));
    expect(net.pieces.map((p) => p.key)).toEqual(["S:0,0,0:0:0", "S:1,0,0:0:0", "S:2,0,0:0:0"]);
    expect(net.nodes.map((n) => [n.q, n.kind])).toEqual([
      [0, "buffer"],
      [1, "through"],
      [2, "through"],
      [3, "buffer"],
    ]);
    expect(net.nodes[1]?.ports).toEqual({ a: [{ piece: 1, end: 0 }], b: [{ piece: 0, end: 1 }] });
    expect(net.sections).toEqual([{ id: 0, pieces: [0, 1, 2], forward: [true, true, true], nodes: [0, 3], lengthMm: 15_000, closed: false }]);
    expect(net.pieces.every((p) => p.section === 0)).toBe(true);
  });

  it("makes a closed loop one section with no buffers", () => {
    const net = derive(stateOf(hexagon()));
    expect(net.nodes).toHaveLength(6);
    expect(net.nodes.every((n) => n.kind === "through")).toBe(true);
    expect(net.sections).toHaveLength(1);
    expect(net.sections[0]?.closed).toBe(true);
    expect(net.sections[0]?.pieces).toHaveLength(6);
    expect(net.sections[0]?.nodes[0]).toBe(net.sections[0]?.nodes[1]);
  });

  it("never connects nodes at the same (q, r) but different heights", () => {
    const net = derive(stateOf([straight(0, 0, 0), straight(1, 0, 7000)]));
    expect(net.nodes).toHaveLength(4);
    expect(net.nodes.every((n) => n.kind === "buffer")).toBe(true);
    expect(net.sections).toHaveLength(2);
  });

  it("is independent of insertion order (deep-equal network, same canonical hash)", () => {
    const pieces = [...hexagon(), straight(40, 10), straight(41, 10), straight(42, 10), straight(0, 20, 7000), straight(1, 20, 7000)];
    const records = authoredRecords(stateOf(pieces));
    const reference = derive(stateOf(pieces));
    forAll(
      { seed: "derive-order", runs: 30 },
      (prng) => shuffled(prng, records),
      (order) => {
        let s = emptyAuthored();
        for (const r of order) s = applyDiff(s, makeDiff([r], []));
        const net = derive(s);
        expect(net).toEqual(reference);
        expect(hashCanonical(net)).toBe(hashCanonical(reference));
      },
    );
  });
});
