import { describe, expect, it } from "vitest";
import {
  EMPTY_DIFF,
  applyDiff,
  authoredFromRecords,
  authoredRecords,
  emptyAuthored,
  invertDiff,
  makeDiff,
} from "./authored";

const A = { key: "S:0,0,0:0:0", structure: "ground" } as const;
const B = { key: "S:1,0,0:0:0", structure: "bridge" } as const;
const C = { key: "C:2,0,0:0:1:60:0:0", structure: "ground" } as const;

describe("authored state", () => {
  it("applies a diff purely, bumping the revision and leaving the input untouched", () => {
    const s0 = emptyAuthored();
    const s1 = applyDiff(s0, makeDiff([B, A], []));
    expect(s0.pieces.size).toBe(0);
    expect(s0.rev).toBe(0);
    expect(s1.rev).toBe(1);
    expect(authoredRecords(s1)).toEqual([A, B]);
    expect(s1.pieces.get(B.key)?.structure).toBe("bridge");
    expect(applyDiff(s1, EMPTY_DIFF)).toBe(s1);
  });

  it("undoes a diff exactly with its inverse", () => {
    const s1 = applyDiff(emptyAuthored(), makeDiff([A, B], []));
    const d = makeDiff([C], [A]);
    const s2 = applyDiff(s1, d);
    expect(authoredRecords(s2)).toEqual([C, B].sort((x, y) => (x.key < y.key ? -1 : 1)));
    expect(authoredRecords(applyDiff(s2, invertDiff(d)))).toEqual(authoredRecords(s1));
  });

  it("sorts diff lists by key and freezes them", () => {
    const d = makeDiff([C, B, A], []);
    expect(d.added.map((r) => r.key)).toEqual([A.key, B.key, C.key].sort());
    expect(Object.isFrozen(d) && Object.isFrozen(d.added)).toBe(true);
    expect(makeDiff([], [])).toBe(EMPTY_DIFF);
  });

  it("throws when a diff does not fit the state (only a bypassed validator can do that)", () => {
    const s1 = applyDiff(emptyAuthored(), makeDiff([A], []));
    expect(() => applyDiff(s1, makeDiff([A], []))).toThrow(/already present/);
    expect(() => applyDiff(s1, makeDiff([], [B]))).toThrow(/not present/);
  });

  it("rebuilds from records without re-validating, rejecting only malformed keys", () => {
    const s = authoredFromRecords([B, A], 7);
    expect(s.rev).toBe(7);
    expect(authoredRecords(s)).toEqual([A, B]);
    expect(() => authoredFromRecords([{ key: "S:1,0,0:6:0", structure: "ground" }])).toThrow(/canonical/);
    expect(() => authoredFromRecords([A, A])).toThrow(/repeat/);
  });
});
